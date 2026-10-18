import type { Db } from "@/lib/db-client";
import { decideReview } from "@/lib/review/rules";
import { shortHash } from "@/lib/text";
import { formatMoney } from "@/lib/money";
import { dayStart, formatInZone } from "@/lib/time";
import {
  isBalanceLine,
  isGenericWalletMerchant,
  isTopUpLine,
  parseNotification,
  type ParsedNotification,
} from "./notification";
import type { Channel } from "@/lib/domain";
import { classifyMerchant } from "@/lib/reference/classify";

export type IngestResult = {
  ok: boolean;
  message: string;
  isDuplicate?: boolean;
  updated?: boolean;
  transactionId?: string;
  merchant?: string;
  amountFormatted?: string;
  categoryName?: string;
  purposeStatus?: string;
};

const GENERIC_WALLET_MERCHANTS = [
  "octopus purchase",
  "octopus",
  "purchase",
  "bus",
  "train",
  "transit",
  "minibus",
  "ferry",
  "tram",
  "light rail",
  "public transport",
  "八達通",
  "零售",
  "消費",
  "付款",
];

/**
 * Ingests a notification record into the Tally database.
 * - Treats Octopus App screenshots (`isAuthoritativeSource: true`) as the Source of Truth for Octopus,
 *   automatically matching and upgrading any generic Apple Wallet entries on the same day + amount
 *   with the Octopus App's exact merchant name, minute timestamp, and category.
 * - Preserves distinct same-day trips that have different minute timestamps (e.g. two $13.20 MTR trips at 15:50 and 18:29).
 * - Ignores top-ups and remaining balances so totals are never doubled.
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

  // 2. Resolve MerchantRule & Category classification first so we can also apply it when upgrading Wallet rows
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

  const review = decideReview({
    amountMinor: parsed.amountMinor,
    type: parsed.type,
    categoryAmbiguous: category ? category.ambiguous : null,
    hasRulePurpose: !!(matchedRule?.categoryId || matchedRule?.purposeId),
    isPersonToPerson: parsed.isPersonToPerson,
    reviewThresholdMinor: settings.reviewThresholdMinor,
  });

  // 3. Smart Deduplication & Octopus App Source-of-Truth Reconciliation
  const dayStr = formatInZone(occurredAt, "yyyy-MM-dd", settings.timezone);
  const minuteStr = formatInZone(occurredAt, "yyyy-MM-dd'T'HH:mm", settings.timezone);
  const fingerprint = `auto:${shortHash(`${source.id}|${minuteStr}|${parsed.amountMinor}|${parsed.merchantNormalized}`)}`;

  const startOfDay = dayStart(occurredAt, settings.timezone);
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
  const minuteStart = new Date(Math.floor(occurredAt.getTime() / 60_000) * 60_000);
  const minuteEnd = new Date(minuteStart.getTime() + 59_999);

  // 3A. Check for an exact-minute match (same source + same minute + same amount)
  const exactMinuteMatch = await db.transaction.findFirst({
    where: {
      sourceId: source.id,
      amountMinor: parsed.amountMinor,
      isDemo: false,
      occurredAt: { gte: minuteStart, lte: minuteEnd },
    },
  });

  if (exactMinuteMatch) {
    // If incoming is from the Octopus App (Source of Truth) and the existing row has a generic Wallet name,
    // upgrade the existing row's merchant name and category in-place!
    if (
      parsed.isAuthoritativeSource &&
      !isGenericWalletMerchant(parsed.merchant) &&
      (isGenericWalletMerchant(exactMinuteMatch.merchant) ||
        exactMinuteMatch.merchantNormalized !== parsed.merchantNormalized ||
        !exactMinuteMatch.categoryId)
    ) {
      const updated = await db.transaction.update({
        where: { id: exactMinuteMatch.id },
        data: {
          merchant: parsed.merchant,
          merchantNormalized: parsed.merchantNormalized,
          categoryId: categoryId ?? exactMinuteMatch.categoryId,
          subcategoryId: subcategoryId ?? exactMinuteMatch.subcategoryId,
          datePrecision: "minute",
          purposeStatus:
            exactMinuteMatch.purposeStatus === "confirmed" ? "confirmed" : review.status,
          rawText: parsed.rawText,
          fingerprint,
          ...(input.batchId ? { importBatchId: input.batchId } : {}),
        },
      });
      return {
        ok: true,
        isDuplicate: false,
        updated: true,
        transactionId: updated.id,
        merchant: updated.merchant,
        amountFormatted: formatMoney(updated.amountMinor, settings.currency),
        categoryName: category?.name ?? "Uncategorized",
        purposeStatus: updated.purposeStatus,
        message: `Updated to Octopus App merchant (${minuteStr}): ${formatMoney(updated.amountMinor, settings.currency)} at ${updated.merchant}`,
      };
    }

    return {
      ok: true,
      isDuplicate: true,
      transactionId: exactMinuteMatch.id,
      merchant: exactMinuteMatch.merchant,
      amountFormatted: formatMoney(exactMinuteMatch.amountMinor, settings.currency),
      message: `Duplicate skipped (${minuteStr}): ${formatMoney(exactMinuteMatch.amountMinor, settings.currency)} at ${exactMinuteMatch.merchant} was already recorded.`,
    };
  }

  // 3B. If incoming is from the Octopus App (Source of Truth), check if there is an existing Apple Wallet
  //     entry on the same calendar day with the same amount (e.g. generic "Octopus Purchase", "Train", "Bus",
  //     or date-only precision) and upgrade it in-place so the Octopus App is the single Source of Truth!
  if (parsed.isAuthoritativeSource && parsed.sourceKind === "octopus") {
    const existingWalletRow = await db.transaction.findFirst({
      where: {
        sourceId: source.id,
        amountMinor: parsed.amountMinor,
        isDemo: false,
        occurredAt: { gte: startOfDay, lt: endOfDay },
        ...(input.batchId ? { NOT: { importBatchId: input.batchId } } : {}),
        OR: [
          { datePrecision: { not: "minute" } },
          { merchantNormalized: { in: GENERIC_WALLET_MERCHANTS } },
        ],
      },
      orderBy: { occurredAt: "asc" },
    });

    if (existingWalletRow) {
      const updated = await db.transaction.update({
        where: { id: existingWalletRow.id },
        data: {
          occurredAt,
          datePrecision: "minute",
          merchant: parsed.merchant,
          merchantNormalized: parsed.merchantNormalized,
          categoryId: categoryId ?? existingWalletRow.categoryId,
          subcategoryId: subcategoryId ?? existingWalletRow.subcategoryId,
          purposeStatus:
            existingWalletRow.purposeStatus === "confirmed" ? "confirmed" : review.status,
          reviewReasons: JSON.stringify(review.reasons),
          rawText: parsed.rawText,
          fingerprint,
          parseConfidence: parsed.confidence,
          ...(input.batchId ? { importBatchId: input.batchId } : {}),
        },
      });
      return {
        ok: true,
        isDuplicate: false,
        updated: true,
        transactionId: updated.id,
        merchant: updated.merchant,
        amountFormatted: formatMoney(updated.amountMinor, settings.currency),
        categoryName: category?.name ?? "Uncategorized",
        purposeStatus: updated.purposeStatus,
        message: `Matched & upgraded Wallet transaction to Octopus App (${minuteStr}): ${formatMoney(updated.amountMinor, settings.currency)} at ${updated.merchant}`,
      };
    }
  }

  // 3C. For non-authoritative or date-only records (Apple Wallet, PayMe App history, Hang Seng Card history),
  //     check for same-day duplicates so Apple Wallet never duplicates an existing Octopus App transaction
  //     and overlapping scrolled screenshots never duplicate.
  if (!parsed.isAuthoritativeSource || parsed.datePrecision !== "minute") {
    const sameDayExisting = await db.transaction.findFirst({
      where: {
        sourceId: source.id,
        amountMinor: parsed.amountMinor,
        isDemo: false,
        occurredAt: { gte: startOfDay, lt: endOfDay },
        ...(input.batchId ? { NOT: { importBatchId: input.batchId } } : {}),
        OR: [
          // Same remaining balance on the same day
          ...(parsed.balanceAfterMinor !== undefined
            ? [{ balanceAfterMinor: parsed.balanceAfterMinor }]
            : []),
          // Same normalized merchant on the same day
          { merchantNormalized: parsed.merchantNormalized },
          // If incoming is a generic Apple Wallet Octopus entry (or date-only), any existing Octopus record
          // of the same amount on the same day from the Octopus App takes precedence
          ...(parsed.sourceKind === "octopus" &&
          (isGenericWalletMerchant(parsed.merchant) || parsed.datePrecision !== "minute")
            ? [{ sourceId: source.id }]
            : []),
        ],
      },
    });

    if (sameDayExisting) {
      return {
        ok: true,
        isDuplicate: true,
        transactionId: sameDayExisting.id,
        merchant: sameDayExisting.merchant,
        amountFormatted: formatMoney(sameDayExisting.amountMinor, settings.currency),
        message: `Duplicate skipped (${dayStr}): ${formatMoney(sameDayExisting.amountMinor, settings.currency)} at ${sameDayExisting.merchant} was already recorded.`,
      };
    }
  }

  // 4. Ensure batch exists
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

  // 5. Create Transaction
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

  const amountFormatted = formatMoney(created.amountMinor, settings.currency);
  const categoryName = category?.name ?? "Uncategorized";

  return {
    ok: true,
    isDuplicate: false,
    transactionId: created.id,
    merchant: created.merchant,
    amountFormatted,
    categoryName,
    purposeStatus: created.purposeStatus,
    message:
      created.purposeStatus === "needs_review"
        ? `Logged ${amountFormatted} at ${created.merchant} (Added to To Confirm)`
        : `Logged ${amountFormatted} at ${created.merchant} (${categoryName})`,
  };
}
