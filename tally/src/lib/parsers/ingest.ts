import type { Db } from "@/lib/db-client";
import { decideReview } from "@/lib/review/rules";
import { shortHash } from "@/lib/text";
import { formatMoney } from "@/lib/money";
import { dayStart, formatInZone } from "@/lib/time";
import { isBalanceLine, isTopUpLine, parseNotification, type ParsedNotification } from "./notification";
import type { Channel } from "@/lib/domain";
import { classifyMerchant } from "@/lib/reference/classify";

export type IngestResult = {
  ok: boolean;
  message: string;
  isDuplicate?: boolean;
  transactionId?: string;
  merchant?: string;
  amountFormatted?: string;
  categoryName?: string;
  purposeStatus?: string;
};

/**
 * Ingests a notification record into the Tally database.
 * Detects duplicates by timestamp + payment source + amount (and balance/merchant),
 * ignores top-ups and remaining balances, and applies categorization rules.
 */
export async function ingestNotificationRecord(
  db: Db,
  input: {
    text?: string;
    parsed?: ParsedNotification;
    channel?: Channel;
    occurredAt?: Date;
    batchId?: string;
  },
): Promise<IngestResult> {
  const parsed = input.parsed ?? (input.text ? parseNotification(input.text) : null);

  if (!parsed) {
    return {
      ok: false,
      message: "No expense transaction found in text.",
    };
  }

  // Never import top-ups or balance lines so totals are never doubled
  if (parsed.type === "top_up" || isTopUpLine(parsed.merchant) || isBalanceLine(parsed.merchant)) {
    return {
      ok: true,
      isDuplicate: true,
      message: "Skipped top-up or balance line.",
    };
  }

  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const occurredAt = input.occurredAt ?? parsed.occurredAt ?? new Date();
  const channel = input.channel ?? "shortcut";

  // 1. Resolve payment source
  let source = await db.paymentSource.findFirst({
    where: {
      OR: [{ name: parsed.sourceName }, { kind: parsed.sourceKind }],
    },
  });

  if (!source) {
    source = await db.paymentSource.findFirst({ where: { kind: "credit_card" } });
  }
  if (!source) {
    source = await db.paymentSource.create({
      data: {
        name: parsed.sourceName,
        kind: parsed.sourceKind,
        color: "gray",
      },
    });
  }

  // 2. Strict Duplicate Detection:
  //    Prevent duplicates when uploading the same screenshot, overlapping scrolled screenshots,
  //    or both an email notification and an app history screenshot for the same payment.
  const dayStr = formatInZone(occurredAt, "yyyy-MM-dd", settings.timezone);
  const minuteStr = formatInZone(occurredAt, "yyyy-MM-dd'T'HH:mm", settings.timezone);
  const fingerprint = `auto:${shortHash(`${source.id}|${dayStr}|${parsed.amountMinor}|${parsed.merchantNormalized}|${parsed.balanceAfterMinor ?? ""}`)}`;

  const startOfDay = dayStart(occurredAt, settings.timezone);
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
  const minuteStart = new Date(Math.floor(occurredAt.getTime() / 60_000) * 60_000);
  const minuteEnd = new Date(minuteStart.getTime() + 59_999);

  const existing = await db.transaction.findFirst({
    where: {
      sourceId: source.id,
      amountMinor: parsed.amountMinor,
      isDemo: false,
      OR: [
        // A. Exact same payment source + same minute timestamp + same amount
        {
          occurredAt: { gte: minuteStart, lte: minuteEnd },
        },
        // B. Same payment source + same day + same amount + same remaining balance
        ...(parsed.balanceAfterMinor !== undefined
          ? [
              {
                occurredAt: { gte: startOfDay, lt: endOfDay },
                balanceAfterMinor: parsed.balanceAfterMinor,
              },
            ]
          : []),
        // C. Same payment source + same day + same amount + same normalized merchant across uploads
        {
          merchantNormalized: parsed.merchantNormalized,
          occurredAt: { gte: startOfDay, lt: endOfDay },
          ...(input.batchId ? { NOT: { importBatchId: input.batchId } } : {}),
        },
        // D. Same deterministic fingerprint on the same day across uploads
        {
          fingerprint,
          occurredAt: { gte: startOfDay, lt: endOfDay },
          ...(input.batchId ? { NOT: { importBatchId: input.batchId } } : {}),
        },
      ],
    },
  });

  if (existing) {
    return {
      ok: true,
      isDuplicate: true,
      transactionId: existing.id,
      merchant: existing.merchant,
      amountFormatted: formatMoney(existing.amountMinor, settings.currency),
      message: `Duplicate skipped (${minuteStr}): ${formatMoney(existing.amountMinor, settings.currency)} at ${existing.merchant} was already recorded.`,
    };
  }

  // 3. Check for matching MerchantRule (auto-categorization without AI cost)
  const rules = await db.merchantRule.findMany({
    orderBy: { hits: "desc" },
    include: { category: true, purpose: true },
  });

  const matchedRule = rules.find((r) =>
    parsed.merchantNormalized.includes(r.pattern.toLowerCase().trim()),
  );

  let categoryId: string | null = matchedRule?.category?.parentId ?? matchedRule?.categoryId ?? null;
  let subcategoryId: string | null = matchedRule?.category?.parentId ? matchedRule.categoryId : null;
  const purposeId: string | null = matchedRule?.purposeId ?? null;

  const hint = classifyMerchant(parsed.merchantNormalized);
  if (!categoryId) {
    const categories = await db.category.findMany({ where: { archived: false } });
    if (parsed.isPersonToPerson) {
      const transferCat = categories.find(
        (c) => c.name === (parsed.type === "income" ? "Money Received" : "Transfers to People"),
      );
      if (transferCat) categoryId = transferCat.id;
    } else {
      const parent = hint && categories.find((c) => c.name === hint.category && !c.parentId);
      if (parent) categoryId = parent.id;
    }
  }

  const category = categoryId ? await db.category.findUnique({ where: { id: categoryId } }) : null;

  if (!subcategoryId && hint?.category === category?.name && hint?.subcategory) {
    const child = await db.category.findFirst({
      where: { parentId: categoryId, name: hint.subcategory, archived: false },
    });
    subcategoryId = child?.id ?? null;
  }

  // 4. Decide review status
  const review = decideReview({
    amountMinor: parsed.amountMinor,
    type: parsed.type,
    categoryAmbiguous: category ? category.ambiguous : null,
    hasRulePurpose: !!(matchedRule?.categoryId || matchedRule?.purposeId),
    isPersonToPerson: parsed.isPersonToPerson,
    reviewThresholdMinor: settings.reviewThresholdMinor,
  });

  // 5. Ensure batch exists
  let batchId = input.batchId;
  if (!batchId) {
    const batch = await db.importBatch.create({
      data: {
        channel,
        sourceHint: `iPhone 14 Pro (${source.name})`,
        capturedAt: new Date(),
        added: 1,
        needsReview: review.status === "needs_review" ? 1 : 0,
      },
    });
    batchId = batch.id;
  }

  // 6. Create Transaction
  const created = await db.transaction.create({
    data: {
      occurredAt,
      datePrecision: parsed.datePrecision,
      amountMinor: parsed.amountMinor,
      currency: settings.currency,
      merchant: parsed.merchant,
      merchantNormalized: parsed.merchantNormalized,
      counterparty: parsed.counterparty ?? null,
      description: parsed.description ?? null,
      location: parsed.location ?? null,
      categoryId,
      subcategoryId,
      sourceId: source.id,
      channel,
      type: parsed.type,
      purposeId,
      purposeStatus: review.status,
      reviewReasons: JSON.stringify(review.reasons),
      balanceAfterMinor: parsed.balanceAfterMinor ?? null,
      rawText: parsed.rawText,
      fingerprint,
      parseConfidence: parsed.confidence,
      importBatchId: batchId,
      isDemo: false,
    },
  });

  if (matchedRule) {
    await db.merchantRule.update({
      where: { id: matchedRule.id },
      data: { hits: { increment: 1 }, lastUsedAt: new Date() },
    });
  }

  if (parsed.rawText) {
    await db.rawCapture.create({
      data: {
        importBatchId: batchId,
        kind: "text",
        text: parsed.rawText,
        ocrConfidence: parsed.confidence,
        capturedAt: occurredAt,
      },
    });
  }

  await db.settings.update({
    where: { id: 1 },
    data: { lastImportAt: new Date() },
  });

  const formattedAmount = formatMoney(parsed.amountMinor, settings.currency);

  return {
    ok: true,
    isDuplicate: false,
    transactionId: created.id,
    merchant: created.merchant,
    amountFormatted: formattedAmount,
    categoryName: category?.name ?? "Uncategorised",
    purposeStatus: created.purposeStatus,
    message: `Logged ${formattedAmount} at ${created.merchant}`,
  };
}
