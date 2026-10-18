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
import { decideReview } from "./review/rules";
import { normalizeMerchant, shortHash } from "./text";
import { formatInZone } from "./time";

function cleanOcrMerchantName(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/^[•·▪▫◦●○■□▲△▼▽◆◇★☆⊕⊗⊙⊚⊛⊜⊝⊞⊟⊠⊡]+\s*/u, "")
    .replace(
      /^(?:[印日目甲由申田口回囚四皿且貝見頁車凸凹尚向同团因固國圖片币巾中内肉門間問開関]\s+|[印日目甲由申田口回囚四皿且貝見頁凸凹](?=[A-Za-z]))/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeMerchantKey(input: string): string {
  return normalizeMerchant(cleanOcrMerchantName(input))
    .replace(/^(?:cup|visa|master|mastercard|amex|unionpay)\s+/i, "")
    .replace(/^(?:kpay|bbmsl|qfpay|yedpay|stripe|sq|paypal|alipay|wechat|shopify|adyen)\s+/i, "")
    .replace(/\b(?:group\s+limited|holdings?\s+limited|company\s+limited|co\s+ltd|limited|ltd|inc|corp|corporation)\b/g, " ")
    .replace(/\bwel+come\b/g, "wellcome")
    .replace(/\bminibuses\b/g, "minibus")
    .replace(/\bbuses\b/g, "bus")
    .replace(/\s+/g, " ")
    .trim();
}

function doesMerchantMatchRule(merchant: string, rulePattern: string): boolean {
  const normMerchant = normalizeMerchant(cleanOcrMerchantName(merchant));
  const normRule = normalizeMerchant(cleanOcrMerchantName(rulePattern));
  if (!normMerchant || !normRule) return false;
  if (normMerchant.includes(normRule) || (normRule.length >= 3 && normRule.includes(normMerchant))) {
    return true;
  }
  const canonMerchant = canonicalizeMerchantKey(merchant);
  const canonRule = canonicalizeMerchantKey(rulePattern);
  if (!canonMerchant || !canonRule) return false;
  return canonMerchant.includes(canonRule) || (canonRule.length >= 3 && canonRule.includes(canonMerchant));
}

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

const globalForInit = globalThis as unknown as {
  __tallySchemaReady?: Promise<void>;
  __tallyLastRepairAt?: number;
};

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

export async function cleanupAndRepairExistingRows(): Promise<void> {
  try {
    const [rows, allCategories, rules, octopusSource, settings] = await Promise.all([
      db.transaction.findMany({
        where: { isDemo: false },
        include: { category: true, subcategory: true, source: true },
        orderBy: { createdAt: "asc" },
      }),
      db.category.findMany({ where: { archived: false } }),
      db.merchantRule.findMany({
        orderBy: { hits: "desc" },
        include: { category: true, purpose: true },
      }),
      db.paymentSource.findFirst({ where: { kind: "octopus" } }),
      db.settings.findUnique({ where: { id: 1 } }),
    ]);

    const reviewThresholdMinor = settings?.reviewThresholdMinor ?? 50000;

    const resolveCategoryIds = (merchantName: string) => {
      const matchedRule = rules.find((rule) => doesMerchantMatchRule(merchantName, rule.pattern));
      if (matchedRule && matchedRule.category) {
        const isChild = !!matchedRule.category.parentId;
        const parentId = isChild ? matchedRule.category.parentId! : matchedRule.category.id;
        const subId = isChild ? matchedRule.category.id : null;
        return {
          categoryId: parentId,
          subcategoryId: subId,
          fromSavedRule: true,
          isKeywordFallback: false,
        };
      }

      const hint = classifyMerchant(merchantName) as {
        category: string;
        subcategory?: string;
        isKeywordFallback?: boolean;
      } | null;
      if (!hint) return { categoryId: null, subcategoryId: null, fromSavedRule: false, isKeywordFallback: false };
      const parent = allCategories.find((c) => c.name === hint.category && !c.parentId) ?? null;
      const child =
        parent && hint.subcategory
          ? allCategories.find((c) => c.parentId === parent.id && c.name === hint.subcategory) ?? null
          : null;
      return {
        categoryId: parent?.id ?? null,
        subcategoryId: child?.id ?? null,
        fromSavedRule: false,
        isKeywordFallback: !!hint.isKeywordFallback,
      };
    };

    const toDeleteIds: string[] = [];
    const survivingRows: typeof rows = [];

    for (const r of rows) {
      if (
        r.type === "top_up" ||
        isBalanceLine(r.merchant) ||
        isTopUpLine(r.merchant) ||
        (r.rawText && isTopUpLine(r.rawText) && r.amountMinor === 60000)
      ) {
        toDeleteIds.push(r.id);
        continue;
      }

      let effectiveOccurredAt = r.occurredAt;
      let effectiveMerchant = cleanOcrMerchantName(r.merchant) || r.merchant;
      let effectivePrecision = r.datePrecision;

      if (isDateOrTimestampLabel(effectiveMerchant)) {
        const resolved = resolveRelativeDay(effectiveMerchant, r.occurredAt);
        effectiveOccurredAt = resolved.date;
        effectivePrecision = resolved.precision;
        effectiveMerchant =
          r.subcategory?.name || (r.category?.name === "Transport" ? "MTR Corporation Limited" : "Octopus");
      }

      if (
        effectiveMerchant !== r.merchant ||
        effectiveOccurredAt.getTime() !== r.occurredAt.getTime() ||
        effectivePrecision !== r.datePrecision
      ) {
        const norm = normalizeMerchant(effectiveMerchant);
        await db.transaction.update({
          where: { id: r.id },
          data: {
            occurredAt: effectiveOccurredAt,
            datePrecision: effectivePrecision,
            merchant: effectiveMerchant,
            merchantNormalized: norm,
          },
        });
        r.occurredAt = effectiveOccurredAt;
        r.datePrecision = effectivePrecision;
        r.merchant = effectiveMerchant;
        r.merchantNormalized = norm;
      }

      survivingRows.push(r);
    }

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
            r.categoryId = categoryId ?? r.categoryId;
            r.subcategoryId = subcategoryId ?? r.subcategoryId;
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
          r.categoryId = categoryId ?? r.categoryId;
          r.subcategoryId = subcategoryId ?? r.subcategoryId;
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
          r.categoryId = categoryId ?? r.categoryId;
          r.subcategoryId = subcategoryId ?? r.subcategoryId;
        }
      }
    }

    for (const r of survivingRows) {
      const resolved = resolveCategoryIds(r.merchant);
      const nextCategoryId = resolved.fromSavedRule
        ? (resolved.categoryId ?? r.categoryId)
        : (r.categoryId ?? resolved.categoryId);
      const nextSubcategoryId = resolved.fromSavedRule
        ? (resolved.subcategoryId ?? r.subcategoryId)
        : (r.subcategoryId ?? resolved.subcategoryId);

      const catObj = nextCategoryId ? allCategories.find((c) => c.id === nextCategoryId) : null;
      const isP2P = !!r.counterparty || (r.source?.kind === "payme" && !catObj);

      let nextPurposeStatus = r.purposeStatus;
      let nextReviewReasons = r.reviewReasons;

      if (r.purposeStatus === "needs_review") {
        if (resolved.fromSavedRule && nextCategoryId && r.amountMinor <= reviewThresholdMinor && !isP2P) {
          nextPurposeStatus = "confirmed";
          nextReviewReasons = "[]";
        } else if (nextCategoryId && !resolved.isKeywordFallback) {
          const decision = decideReview({
            amountMinor: r.amountMinor,
            type: r.type as "expense" | "income" | "transfer" | "refund" | "top_up",
            categoryAmbiguous: catObj ? catObj.ambiguous : null,
            hasRulePurpose: resolved.fromSavedRule,
            isPersonToPerson: isP2P,
            reviewThresholdMinor,
          });
          nextPurposeStatus = decision.status === "auto" ? "confirmed" : "needs_review";
          nextReviewReasons = JSON.stringify(decision.reasons);
        } else if (nextCategoryId && resolved.isKeywordFallback) {
          nextReviewReasons = JSON.stringify(["Suggested from keyword — please confirm or change"]);
        }
      }

      if (
        nextCategoryId !== r.categoryId ||
        nextSubcategoryId !== r.subcategoryId ||
        nextPurposeStatus !== r.purposeStatus ||
        nextReviewReasons !== r.reviewReasons
      ) {
        await db.transaction.update({
          where: { id: r.id },
          data: {
            categoryId: nextCategoryId,
            subcategoryId: nextSubcategoryId,
            purposeStatus: nextPurposeStatus,
            reviewReasons: nextReviewReasons,
          },
        });
        r.categoryId = nextCategoryId;
        r.subcategoryId = nextSubcategoryId;
        r.purposeStatus = nextPurposeStatus;
        r.reviewReasons = nextReviewReasons;
      }
    }

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

async function ensureSchemaAndTaxonomy(): Promise<void> {
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
    } else {
      await ensureReferenceData(db);
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

export async function ensureDatabaseInitialized(): Promise<void> {
  if (!globalForInit.__tallySchemaReady) {
    globalForInit.__tallySchemaReady = ensureSchemaAndTaxonomy().catch((err) => {
      globalForInit.__tallySchemaReady = undefined;
      throw err;
    });
  }
  await globalForInit.__tallySchemaReady;

  const now = Date.now();
  if (!globalForInit.__tallyLastRepairAt || now - globalForInit.__tallyLastRepairAt > 3000) {
    globalForInit.__tallyLastRepairAt = now;
    await cleanupAndRepairExistingRows();
  }
}
