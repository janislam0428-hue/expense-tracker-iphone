import "server-only";
import { createClient } from "@libsql/client";
import { db } from "./db";
import { cleanEnv } from "./db-client";
import { ensureReferenceData } from "./reference/ensure";
import { LEGACY_CATEGORIES, migrateTaxonomy } from "./reference/migrate-taxonomy";
import { loadDemoData } from "./demo/apply";
import {
  isBalanceLine,
  isDateOrTimestampLabel,
  isGenericWalletMerchant,
  isTopUpLine,
  resolveRelativeDay,
} from "./parsers/notification";
import { classifyMerchant } from "./reference/classify";
import { normalizeMerchant, shortHash } from "./text";
import { formatInZone } from "./time";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurredAt" DATETIME NOT NULL,
    "datePrecision" TEXT NOT NULL DEFAULT 'minute',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "merchant" TEXT NOT NULL,
    "merchantNormalized" TEXT NOT NULL,
    "counterparty" TEXT,
    "description" TEXT,
    "location" TEXT,
    "categoryId" TEXT,
    "subcategoryId" TEXT,
    "sourceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'expense',
    "purposeId" TEXT,
    "purposeStatus" TEXT NOT NULL DEFAULT 'auto',
    "reviewReasons" TEXT NOT NULL DEFAULT '[]',
    "balanceAfterMinor" INTEGER,
    "externalRef" TEXT,
    "notes" TEXT,
    "rawText" TEXT,
    "fingerprint" TEXT NOT NULL,
    "parseConfidence" REAL,
    "duplicateOfId" TEXT,
    "importBatchId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PaymentSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "Purpose" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "color" TEXT NOT NULL DEFAULT 'gray',
    "icon" TEXT,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,
    "monthlyAlertMinor" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Purpose" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "shortcutKey" TEXT,
    "color" TEXT NOT NULL DEFAULT 'gray',
    "isSystem" BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "PaymentSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last4" TEXT,
    "color" TEXT NOT NULL DEFAULT 'gray',
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "MerchantRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'contains',
    "categoryId" TEXT,
    "purposeId" TEXT,
    "sourceKind" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "MerchantRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MerchantRule_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "Purpose" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "sourceHint" TEXT,
    "capturedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added" INTEGER NOT NULL DEFAULT 0,
    "skippedDuplicates" INTEGER NOT NULL DEFAULT 0,
    "needsReview" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "rawPayloadHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'committed',
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "RawCapture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importBatchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ocrConfidence" REAL,
    "capturedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RawCapture_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "categoryId" TEXT,
    "strategy" TEXT NOT NULL DEFAULT 'fixed',
    "params" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "AlertRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Budget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'month',
    "amountMinor" INTEGER NOT NULL,
    CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SavedView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "filters" TEXT NOT NULL DEFAULT '{}',
    "groupBy" TEXT,
    "sort" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Hong_Kong',
    "weekStart" INTEGER NOT NULL DEFAULT 1,
    "reviewThresholdMinor" INTEGER NOT NULL DEFAULT 50000,
    "alertThresholdMinor" INTEGER NOT NULL DEFAULT 200000,
    "demoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "apiTokenHash" TEXT,
    "passwordHash" TEXT,
    "lastImportAt" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Transaction_occurredAt_idx" ON "Transaction"("occurredAt");
CREATE INDEX IF NOT EXISTS "Transaction_fingerprint_idx" ON "Transaction"("fingerprint");
CREATE INDEX IF NOT EXISTS "Transaction_sourceId_occurredAt_idx" ON "Transaction"("sourceId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Transaction_purposeStatus_idx" ON "Transaction"("purposeStatus");
CREATE INDEX IF NOT EXISTS "Transaction_categoryId_occurredAt_idx" ON "Transaction"("categoryId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Transaction_isDemo_idx" ON "Transaction"("isDemo");
CREATE INDEX IF NOT EXISTS "Transaction_externalRef_idx" ON "Transaction"("externalRef");
CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_parentId_key" ON "Category"("name", "parentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Purpose_name_key" ON "Purpose"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentSource_name_key" ON "PaymentSource"("name");
CREATE INDEX IF NOT EXISTS "MerchantRule_pattern_idx" ON "MerchantRule"("pattern");
CREATE INDEX IF NOT EXISTS "ImportBatch_rawPayloadHash_idx" ON "ImportBatch"("rawPayloadHash");
CREATE UNIQUE INDEX IF NOT EXISTS "Budget_categoryId_period_key" ON "Budget"("categoryId", "period");
`;

const globalForInit = globalThis as unknown as { __tallyDbReadyV4?: Promise<void> };

function cleanOcrMerchantName(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(
      /(?:^|\s)[<‹＜«←⬅️⌃^]*\s*(?:octopus|八達通)(?:\s+\d+)?\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/gi,
      " ",
    )
    .replace(
      /^[<‹＜«←⬅️]+\s*(?:octopus|八達通)(?:\s+\d+)?(?:\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/i,
      "",
    )
    .replace(
      /^(?:octopus|八達通)\s+\d+(?:\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?(?:\s+|$)/i,
      "",
    )
    .replace(/(?:^|\s)[<‹＜«←⬅️]*\s*\b\d{7,12}\s*[\(\[\{]\d+[\)\]\}]?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/g, " ")
    .replace(/^[<‹＜«←⬅️•·▪▫◦●○■□▲△▼▽◆◇★☆⊕⊗⊙⊚⊛⊜⊝⊞⊟⊠⊡]+\s*/u, "")
    .replace(
      /^(?:[印日目甲由申田口回囚四皿且貝見頁車凸凹尚向同团因固國圖片币巾中内肉門間問開関]\s+|[印日目甲由申田口回囚四皿且貝見頁凸凹](?=[A-Za-z]))/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeMerchantKey(input: string): string {
  return normalizeMerchant(cleanOcrMerchantName(input))
    .replace(/^(?:octopus|八達通)(?:\s+\d+)?(?:\s+\d{6,12}(?:\s+\d+)?)?\s*/i, "")
    .replace(/\b\d{7,12}\b/g, " ")
    .replace(/^(?:cup|visa|master|mastercard|amex|unionpay)\s+/i, "")
    .replace(/^(?:kpay|bbmsl|qfpay|yedpay|stripe|sq|paypal|alipay|wechat|shopify|adyen)\s+/i, "")
    .replace(/\b(?:group\s+limited|holdings?\s+limited|company\s+limited|co\s+ltd|limited|ltd|inc|corp|corporation)\b/g, " ")
    .replace(/\bwel+come\b/g, "wellcome")
    .replace(/\bminibuses\b/g, "minibus")
    .replace(/\bbuses\b/g, "bus")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_RULE_BLACKLIST = new Set([
  "octopus",
  "octopus 1",
  "octopus 2",
  "octopus purchase",
  "purchase",
  "payme",
  "hang seng",
  "hang seng card",
  "visa",
  "mastercard",
  "八達通",
]);

/**
 * Authoritative Octopus App records from the user's Octopus 1 (192116091(2)) history screenshots.
 * Used to reconcile existing generic Apple Wallet rows ("Octopus Purchase", "Train", "Bus", etc.)
 * so current Octopus transactions match the Octopus App Source of Truth.
 */
const VERIFIED_OCTOPUS_APP_RECORDS: Array<{
  ts: string;
  day: string;
  amountMinor: number;
  merchant: string;
}> = [
  { ts: "2026-09-27 17:12", day: "2026-09-27", amountMinor: 740, merchant: "MTR Corporation Limited" },
  { ts: "2026-09-27 16:53", day: "2026-09-27", amountMinor: 14250, merchant: "Sa Sa Cosmetic" },
  { ts: "2026-09-27 13:25", day: "2026-09-27", amountMinor: 24200, merchant: "Neway Karaoke Box" },
  { ts: "2026-09-27 11:46", day: "2026-09-27", amountMinor: 850, merchant: "MTR Corporation Limited" },
  { ts: "2026-09-27 11:18", day: "2026-09-27", amountMinor: 870, merchant: "Green Minibuses" },
  { ts: "2026-09-25 18:36", day: "2026-09-25", amountMinor: 820, merchant: "Green Minibuses" },
  { ts: "2026-09-25 18:29", day: "2026-09-25", amountMinor: 1320, merchant: "MTR Corporation Limited" },
  { ts: "2026-09-25 15:50", day: "2026-09-25", amountMinor: 1320, merchant: "MTR Corporation Limited" },
  {
    ts: "2026-09-25 15:29",
    day: "2026-09-25",
    amountMinor: 2400,
    merchant: "Lung Fung Pharmaceutical (Group) Limited",
  },
  { ts: "2026-09-25 15:14", day: "2026-09-25", amountMinor: 58000, merchant: "OPTICAL CENTRE" },
  { ts: "2026-09-25 14:20", day: "2026-09-25", amountMinor: 540, merchant: "MTR Corporation Limited" },
  { ts: "2026-09-25 13:55", day: "2026-09-25", amountMinor: 870, merchant: "Green Minibuses" },
  { ts: "2026-09-21 19:45", day: "2026-09-21", amountMinor: 820, merchant: "Green Minibuses" },
  { ts: "2026-09-21 19:38", day: "2026-09-21", amountMinor: 740, merchant: "MTR Corporation Limited" },
  { ts: "2026-09-21 16:00", day: "2026-09-21", amountMinor: 900, merchant: "MTR Corporation Limited" },
  { ts: "2026-09-21 02:06", day: "2026-09-21", amountMinor: 18500, merchant: "Taxi" },
  { ts: "2026-09-20 19:24", day: "2026-09-20", amountMinor: 1530, merchant: "MTR Corporation Limited" },
  { ts: "2026-09-20 18:51", day: "2026-09-20", amountMinor: 870, merchant: "Green Minibuses" },
  { ts: "2026-09-19 14:14", day: "2026-09-19", amountMinor: 820, merchant: "Green Minibuses" },
];

/**
 * Repairs, reconciles, and deduplicates existing non-demo rows:
 * 0. Cleans or deletes any corrupted MerchantRule whose pattern contains "< Octopus 1 192116091(2)" / "192116091"
 *    (which caused unrelated Octopus transactions to be falsely routed to Gym Membership).
 * 1. Deletes any balance-statement or top-up rows, and deletes any row whose merchant name is purely "< Octopus 1 192116091(2)".
 * 2. Strips "< Octopus 1 192116091(2)" (and any OCR icon prefixes) from all transaction merchant names,
 *    re-identifying their categories (e.g. Lung Fung -> Personal Expense / Daily essentials, Hong Yip -> Subscription / Gym Membership)
 *    or placing unknown/ambiguous ones (e.g. SUP RETAIL (HONG KONG) LIMITED) into To Confirm ("needs_review").
 * 3. Reconciles existing Apple Wallet Octopus rows against the Octopus App Source of Truth.
 * 4. Deduplicates transactions with the exact same sourceId, amountMinor, and minute timestamp.
 */
async function cleanupAndRepairExistingRows(): Promise<void> {
  try {
    const [rows, allCategories, octopusSource, allRules, settings] = await Promise.all([
      db.transaction.findMany({
        where: { isDemo: false },
        include: { category: true, subcategory: true, source: true },
        orderBy: { createdAt: "asc" },
      }),
      db.category.findMany({ where: { archived: false } }),
      db.paymentSource.findFirst({ where: { kind: "octopus" } }),
      db.merchantRule.findMany({ include: { category: true } }),
      db.settings.findUnique({ where: { id: 1 } }),
    ]);

    const reviewThresholdMinor = settings?.reviewThresholdMinor ?? 50000;

    // 0. Clean or remove false MerchantRules containing Octopus card header numbers ("< Octopus 1 192116091(2)")
    for (const rule of allRules) {
      const cleanedPattern = canonicalizeMerchantKey(rule.pattern);
      const hadOctopusHeader = /octopus|八達通|192116091|\d{7,12}|[<‹＜«]/i.test(rule.pattern);
      const isGymRule = rule.category?.name === "Gym Membership";
      const isValidGymMerchant = /hong yip|pure fitness|fitness first|anytime fitness|24 7 fitness|24\/7 fitness|efx|go24|snap fitness|classpass|gym|fitness/i.test(
        cleanedPattern,
      );

      if (
        !cleanedPattern ||
        cleanedPattern.length < 2 ||
        GENERIC_RULE_BLACKLIST.has(cleanedPattern) ||
        (hadOctopusHeader && isGymRule && !isValidGymMerchant)
      ) {
        await db.merchantRule.delete({ where: { id: rule.id } }).catch(() => null);
      } else if (hadOctopusHeader && cleanedPattern !== rule.pattern) {
        await db.merchantRule
          .update({
            where: { id: rule.id },
            data: { pattern: cleanedPattern },
          })
          .catch(() => null);
      }
    }

    const resolveCategoryIds = (merchantName: string) => {
      const hint = classifyMerchant(merchantName) as {
        category: string;
        subcategory?: string;
        isKeywordFallback?: boolean;
      } | null;
      if (!hint) return { categoryId: null, subcategoryId: null, isKeywordFallback: false };
      const parent = allCategories.find((c) => c.name === hint.category && !c.parentId) ?? null;
      const child =
        parent && hint.subcategory
          ? allCategories.find((c) => c.parentId === parent.id && c.name === hint.subcategory) ?? null
          : null;
      return {
        categoryId: parent?.id ?? null,
        subcategoryId: child?.id ?? null,
        isKeywordFallback: !!hint.isKeywordFallback,
      };
    };

    const toDeleteIds: string[] = [];
    const survivingRows: typeof rows = [];

    for (const r of rows) {
      // 1. Remove balance lines and top-ups
      if (
        r.type === "top_up" ||
        isBalanceLine(r.merchant) ||
        isTopUpLine(r.merchant) ||
        (r.rawText && isTopUpLine(r.rawText) && r.amountMinor === 60000)
      ) {
        toDeleteIds.push(r.id);
        continue;
      }

      // 2. Check if merchant had "< Octopus 1 192116091(2)" (or OCR icon prefix) or was falsely routed to Gym Membership
      const cleanedName = cleanOcrMerchantName(r.merchant);
      const hadOctopusHeaderPrefix =
        cleanedName !== r.merchant || /[<‹＜«]|octopus\s+\d|192116091|\b\d{7,12}\s*\(\d+\)/i.test(r.merchant);

      if (!cleanedName) {
        // Row was purely "< Octopus 1 192116091(2)" with no actual merchant name
        toDeleteIds.push(r.id);
        continue;
      }

      const isFalselyRoutedToGym =
        (r.subcategory?.name === "Gym Membership" ||
          (r.category?.name === "Subscription" && r.source?.kind === "octopus")) &&
        !/hong yip|pure fitness|fitness first|anytime fitness|24 7 fitness|24\/7 fitness|efx|go24|snap fitness|classpass|gym|fitness/i.test(
          cleanedName,
        );

      if (hadOctopusHeaderPrefix || isFalselyRoutedToGym) {
        const { categoryId: newCatId, subcategoryId: newSubId, isKeywordFallback } = resolveCategoryIds(cleanedName);
        const normName = normalizeMerchant(cleanedName);

        if (newCatId && !isKeywordFallback) {
          // Confidently re-identified (e.g. "Lung Fung Pharmaceutical..." -> Personal Expense / Daily essentials,
          // or "HONG YIP SERVICES CO LTD." -> Subscription / Gym Membership)
          const nextStatus = r.amountMinor > reviewThresholdMinor ? "needs_review" : "confirmed";
          await db.transaction.update({
            where: { id: r.id },
            data: {
              merchant: cleanedName,
              merchantNormalized: normName,
              categoryId: newCatId,
              subcategoryId: newSubId,
              purposeStatus: nextStatus,
              reviewReasons: nextStatus === "confirmed" ? "[]" : JSON.stringify(["above_threshold"]),
            },
          });
          r.merchant = cleanedName;
          r.merchantNormalized = normName;
          r.categoryId = newCatId;
          r.subcategoryId = newSubId;
          r.purposeStatus = nextStatus;
        } else {
          // Unknown or keyword-fallback merchant (e.g. "SUP RETAIL (HONG KONG) LIMITED") -> clear false Gym Membership and put in To confirm
          await db.transaction.update({
            where: { id: r.id },
            data: {
              merchant: cleanedName,
              merchantNormalized: normName,
              categoryId: newCatId,
              subcategoryId: newSubId,
              purposeStatus: "needs_review",
              reviewReasons: JSON.stringify(
                newCatId ? ["Suggested from keyword — please confirm or change"] : ["uncategorised"],
              ),
            },
          });
          r.merchant = cleanedName;
          r.merchantNormalized = normName;
          r.categoryId = newCatId;
          r.subcategoryId = newSubId;
          r.purposeStatus = "needs_review";
        }
      }

      let effectiveOccurredAt = r.occurredAt;
      let effectiveMerchant = r.merchant;
      let effectivePrecision = r.datePrecision;

      // 3. If merchant is a timestamp/date label (like "Thu 18:56", "Wed 22:34", "1h ago", "2026-10-07"), repair it
      if (isDateOrTimestampLabel(r.merchant)) {
        const resolved = resolveRelativeDay(r.merchant, r.occurredAt);
        effectiveOccurredAt = resolved.date;
        effectivePrecision = resolved.precision;
        effectiveMerchant = r.subcategory?.name || (r.category?.name === "Transport" ? "MTR Corporation Limited" : "Octopus");

        await db.transaction.update({
          where: { id: r.id },
          data: {
            occurredAt: effectiveOccurredAt,
            datePrecision: effectivePrecision,
            merchant: effectiveMerchant,
            merchantNormalized: normalizeMerchant(effectiveMerchant),
          },
        });
        r.occurredAt = effectiveOccurredAt;
        r.datePrecision = effectivePrecision;
        r.merchant = effectiveMerchant;
        r.merchantNormalized = normalizeMerchant(effectiveMerchant);
      }

      survivingRows.push(r);
    }

    // 4. Reconcile Octopus rows against VERIFIED_OCTOPUS_APP_RECORDS (Octopus App Source of Truth)
    if (octopusSource) {
      const usedVerifiedIdx = new Set<number>();
      const matchedRowIds = new Set<string>();

      for (const r of survivingRows) {
        if (r.sourceId !== octopusSource.id) continue;
        const rMin = formatInZone(r.occurredAt, "yyyy-MM-dd HH:mm", "Asia/Hong_Kong");
        const vIdx = VERIFIED_OCTOPUS_APP_RECORDS.findIndex(
          (v, idx) => !usedVerifiedIdx.has(idx) && v.ts === rMin && v.amountMinor === r.amountMinor,
        );
        if (vIdx !== -1) {
          usedVerifiedIdx.add(vIdx);
          matchedRowIds.add(r.id);
          const v = VERIFIED_OCTOPUS_APP_RECORDS[vIdx];
          if (r.merchant !== v.merchant || !r.categoryId) {
            const { categoryId, subcategoryId } = resolveCategoryIds(v.merchant);
            await db.transaction.update({
              where: { id: r.id },
              data: {
                merchant: v.merchant,
                merchantNormalized: normalizeMerchant(v.merchant),
                datePrecision: "minute",
                categoryId: categoryId ?? r.categoryId,
                subcategoryId: subcategoryId ?? r.subcategoryId,
              },
            });
            r.merchant = v.merchant;
            r.merchantNormalized = normalizeMerchant(v.merchant);
            r.datePrecision = "minute";
          }
        }
      }

      for (const r of survivingRows) {
        if (r.sourceId !== octopusSource.id || matchedRowIds.has(r.id)) continue;
        const rDay = formatInZone(r.occurredAt, "yyyy-MM-dd", "Asia/Hong_Kong");
        const vIdx = VERIFIED_OCTOPUS_APP_RECORDS.findIndex(
          (v, idx) =>
            !usedVerifiedIdx.has(idx) &&
            v.amountMinor === r.amountMinor &&
            (v.day === rDay || (r.rawText && r.rawText.includes(v.day))),
        );
        if (vIdx !== -1) {
          usedVerifiedIdx.add(vIdx);
          matchedRowIds.add(r.id);
          const v = VERIFIED_OCTOPUS_APP_RECORDS[vIdx];
          const resolvedDate = resolveRelativeDay(v.ts).date;
          const { categoryId, subcategoryId } = resolveCategoryIds(v.merchant);
          const minuteStr = formatInZone(resolvedDate, "yyyy-MM-dd'T'HH:mm", "Asia/Hong_Kong");
          const fingerprint = `auto:${shortHash(`${octopusSource.id}|${minuteStr}|${v.amountMinor}|${normalizeMerchant(v.merchant)}`)}`;

          await db.transaction.update({
            where: { id: r.id },
            data: {
              occurredAt: resolvedDate,
              datePrecision: "minute",
              merchant: v.merchant,
              merchantNormalized: normalizeMerchant(v.merchant),
              categoryId: categoryId ?? r.categoryId,
              subcategoryId: subcategoryId ?? r.subcategoryId,
              fingerprint,
            },
          });
          r.occurredAt = resolvedDate;
          r.datePrecision = "minute";
          r.merchant = v.merchant;
          r.merchantNormalized = normalizeMerchant(v.merchant);
        }
      }

      for (const r of survivingRows) {
        if (r.sourceId !== octopusSource.id || matchedRowIds.has(r.id)) continue;
        if (!isGenericWalletMerchant(r.merchant) && r.datePrecision === "minute") continue;

        const vIdx = VERIFIED_OCTOPUS_APP_RECORDS.findIndex(
          (v, idx) => !usedVerifiedIdx.has(idx) && v.amountMinor === r.amountMinor,
        );
        if (vIdx !== -1) {
          usedVerifiedIdx.add(vIdx);
          matchedRowIds.add(r.id);
          const v = VERIFIED_OCTOPUS_APP_RECORDS[vIdx];
          const resolvedDate = resolveRelativeDay(v.ts).date;
          const { categoryId, subcategoryId } = resolveCategoryIds(v.merchant);
          const minuteStr = formatInZone(resolvedDate, "yyyy-MM-dd'T'HH:mm", "Asia/Hong_Kong");
          const fingerprint = `auto:${shortHash(`${octopusSource.id}|${minuteStr}|${v.amountMinor}|${normalizeMerchant(v.merchant)}`)}`;

          await db.transaction.update({
            where: { id: r.id },
            data: {
              occurredAt: resolvedDate,
              datePrecision: "minute",
              merchant: v.merchant,
              merchantNormalized: normalizeMerchant(v.merchant),
              categoryId: categoryId ?? r.categoryId,
              subcategoryId: subcategoryId ?? r.subcategoryId,
              fingerprint,
            },
          });
          r.occurredAt = resolvedDate;
          r.datePrecision = "minute";
          r.merchant = v.merchant;
          r.merchantNormalized = normalizeMerchant(v.merchant);
        }
      }
    }

    // 5. Re-classify any row that has a known merchant (e.g. "Green Minibuses") but is missing category/subcategory
    for (const r of survivingRows) {
      if (!r.categoryId || !r.subcategoryId) {
        const { categoryId, subcategoryId, isKeywordFallback } = resolveCategoryIds(r.merchant);
        if (categoryId && !isKeywordFallback && (categoryId !== r.categoryId || subcategoryId !== r.subcategoryId)) {
          await db.transaction.update({
            where: { id: r.id },
            data: {
              categoryId,
              subcategoryId: subcategoryId ?? r.subcategoryId,
            },
          });
        }
      }
    }

    // 6. Deduplicate by same sourceId + same minute + same amount
    const seenKey = new Set<string>();
    for (const r of survivingRows) {
      const minuteBucket = Math.floor(r.occurredAt.getTime() / 60_000);
      const dedupKey = `${r.sourceId}|${minuteBucket}|${r.amountMinor}`;
      if (seenKey.has(dedupKey)) {
        toDeleteIds.push(r.id);
      } else {
        seenKey.add(dedupKey);
      }
    }

    if (toDeleteIds.length > 0) {
      await db.transaction.deleteMany({ where: { id: { in: toDeleteIds } } });
    }
  } catch (err) {
    console.error("Cleanup/repair non-fatal error:", err);
  }
}

async function runInit(): Promise<void> {
  let existing = null;
  try {
    existing = await db.settings.findUnique({ where: { id: 1 } });
  } catch {
    const url = cleanEnv(process.env.DATABASE_URL) ?? "file:./data/tally.db";
    const authToken = cleanEnv(process.env.DATABASE_AUTH_TOKEN);
    const client = createClient({ url, authToken });
    await client.executeMultiple(SCHEMA_SQL);
  }

  if (existing) {
    // Always ensure any newly added categories/subcategories (like Food -> Dessert) exist
    await ensureReferenceData(db);
    await cleanupAndRepairExistingRows();

    const [legacyFound, newFoodFound] = await Promise.all([
      db.category.findFirst({
        where: {
          OR: [
            { name: { in: Object.keys(LEGACY_CATEGORIES) }, parentId: null, archived: false },
            { name: { in: ["MTR", "Bus", "Minibus", "Taxi"] }, archived: false },
          ],
        },
      }),
      db.category.findFirst({
        where: { name: "Food", parentId: null, archived: false },
      }),
    ]);

    if (legacyFound || !newFoodFound) {
      await migrateTaxonomy(db);
    }
    return;
  }

  await ensureReferenceData(db);
  const settings = await db.settings.findUnique({ where: { id: 1 } });
  if (settings?.demoEnabled) {
    const count = await db.transaction.count();
    if (count === 0) {
      await loadDemoData(db);
    }
  }
}

/**
 * Automatically creates tables, reference data, repairs misdetected rows, reconciles Octopus App names,
 * and applies taxonomy migrations on first run.
 */
export async function ensureDatabaseInitialized(): Promise<void> {
  if (!globalForInit.__tallyDbReadyV4) {
    globalForInit.__tallyDbReadyV4 = runInit().catch((err) => {
      globalForInit.__tallyDbReadyV4 = undefined;
      throw err;
    });
  }
  return globalForInit.__tallyDbReadyV4;
}
