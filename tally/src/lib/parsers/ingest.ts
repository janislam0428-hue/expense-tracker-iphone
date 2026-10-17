import type { Db } from "@/lib/db-client";
import { decideReview } from "@/lib/review/rules";
import { shortHash } from "@/lib/text";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import { parseNotification, type ParsedNotification } from "./notification";
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
 * Detects duplicates, applies categorization rules, and assigns review status.
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
      message: "No transaction details found in text. Check format.",
    };
  }

  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const occurredAt = input.occurredAt ?? parsed.occurredAt ?? new Date();
  const channel = input.channel ?? "shortcut";

  // 1. Resolve payment source
  let source = await db.paymentSource.findFirst({
    where: {
      OR: [
        { name: parsed.sourceName },
        { kind: parsed.sourceKind },
      ],
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

  // 2. Check for matching MerchantRule (auto-categorization without AI cost)
  const rules = await db.merchantRule.findMany({
    orderBy: { hits: "desc" },
    include: { category: true, purpose: true },
  });

  const matchedRule = rules.find((r) =>
    parsed.merchantNormalized.includes(r.pattern.toLowerCase().trim()),
  );

  // A remembered rule may point to a child category; expand it into the pair.
  let categoryId: string | null = matchedRule?.category?.parentId ?? matchedRule?.categoryId ?? null;
  let subcategoryId: string | null = matchedRule?.category?.parentId ? matchedRule.categoryId : null;
  let purposeId: string | null = matchedRule?.purposeId ?? null;

  const hint = classifyMerchant(parsed.merchantNormalized);
  // If no rule matched, attempt keyword category match
  if (!categoryId) {
    const categories = await db.category.findMany({ where: { archived: false } });
    if (parsed.type === "top_up") {
      const topUpCat = categories.find((c) => c.name === "Top ups & Transfers");
      if (topUpCat) categoryId = topUpCat.id;
    } else if (parsed.isPersonToPerson) {
      const transferCat = categories.find(
        (c) => c.name === (parsed.type === "income" ? "Money Received" : "Transfers to People"),
      );
      if (transferCat) categoryId = transferCat.id;
    } else {
      const parent = hint && categories.find((c) => c.name === hint.category && !c.parentId);
      if (parent) categoryId = parent.id;
    }
  }

  const category = categoryId
    ? await db.category.findUnique({ where: { id: categoryId } })
    : null;

  // Fill a subcategory only when the hint agrees with the chosen category.
  if (!subcategoryId && hint?.category === category?.name && hint?.subcategory) {
    const child = await db.category.findFirst({
      where: { parentId: categoryId, name: hint.subcategory, archived: false },
    });
    subcategoryId = child?.id ?? null;
  }

  // 3. Decide review status (a saved merchant rule with a category or purpose skips review)
  const review = decideReview({
    amountMinor: parsed.amountMinor,
    type: parsed.type,
    categoryAmbiguous: category ? category.ambiguous : null,
    hasRulePurpose: !!(matchedRule?.categoryId || matchedRule?.purposeId),
    isPersonToPerson: parsed.isPersonToPerson,
    reviewThresholdMinor: settings.reviewThresholdMinor,
  });

  // 4. Deterministic fingerprint for duplicate detection
  const dayStr = formatInZone(occurredAt, "yyyy-MM-dd", settings.timezone);
  const fingerprint = `auto:${shortHash(`${source.name}|${dayStr}|${parsed.amountMinor}|${parsed.merchantNormalized}|${parsed.location ?? ""}`)}`;

  // Look for duplicate on the same day from previous import batches
  const windowStart = new Date(occurredAt.getTime() - 24 * 3600 * 1000);
  const windowEnd = new Date(occurredAt.getTime() + 24 * 3600 * 1000);

  const existing = await db.transaction.findFirst({
    where: {
      fingerprint,
      occurredAt: { gte: windowStart, lte: windowEnd },
      ...(input.batchId ? { NOT: { importBatchId: input.batchId } } : {}),
    },
  });

  if (existing) {
    return {
      ok: true,
      isDuplicate: true,
      transactionId: existing.id,
      merchant: existing.merchant,
      amountFormatted: formatMoney(existing.amountMinor, settings.currency),
      message: `Duplicate skipped: ${formatMoney(existing.amountMinor, settings.currency)} at ${existing.merchant} was already recorded.`,
    };
  }

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

  // Update rule stats if matched
  if (matchedRule) {
    await db.merchantRule.update({
      where: { id: matchedRule.id },
      data: { hits: { increment: 1 }, lastUsedAt: new Date() },
    });
  }

  // Save raw capture text
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

  // Update last import time in settings
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
