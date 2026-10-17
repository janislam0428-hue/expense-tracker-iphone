import "server-only";
import { createClient } from "@libsql/client";
import { db } from "./db";
import { cleanEnv } from "./db-client";
import { ensureReferenceData } from "./reference/ensure";
import { LEGACY_CATEGORIES, migrateTaxonomy } from "./reference/migrate-taxonomy";
import { loadDemoData } from "./demo/apply";

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

const globalForInit = globalThis as unknown as { __tallyDbReady?: Promise<void> };

async function cleanupMisdetectedBalanceRows(): Promise<void> {
  try {
    const candidates = await db.transaction.findMany({
      where: { isDemo: false, purposeStatus: "needs_review" },
      select: { id: true, merchant: true },
    });
    const badIds = candidates
      .filter(
        (c) =>
          /\b(?:new balance|remaining balance|balance is)\b/i.test(c.merchant) ||
          /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{1,2}:\d{2}$/i.test(c.merchant.trim()) ||
          /^\d+\s*[hm]\s*ago$/i.test(c.merchant.trim()),
      )
      .map((c) => c.id);
    if (badIds.length > 0) {
      await db.transaction.deleteMany({ where: { id: { in: badIds } } });
    }
  } catch {
    // Non-fatal cleanup
  }
}

async function runInit(): Promise<void> {
  let existing = null;
  try {
    existing = await db.settings.findUnique({ where: { id: 1 } });
  } catch {
    // Table does not exist yet — create schema via libSQL client
    const url = cleanEnv(process.env.DATABASE_URL) ?? "file:./data/tally.db";
    const authToken = cleanEnv(process.env.DATABASE_AUTH_TOKEN);
    const client = createClient({ url, authToken });
    await client.executeMultiple(SCHEMA_SQL);
  }

  if (existing) {
    // Clean up any misdetected balance/timestamp rows from earlier screenshots
    await cleanupMisdetectedBalanceRows();

    // Check if the 9-category taxonomy migration still needs to be applied
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
 * Automatically creates tables, reference data, and applies taxonomy migrations
 * on first run so the user never has to manually execute CLI commands on Turso.
 */
export async function ensureDatabaseInitialized(): Promise<void> {
  if (!globalForInit.__tallyDbReady) {
    globalForInit.__tallyDbReady = runInit().catch((err) => {
      globalForInit.__tallyDbReady = undefined;
      throw err;
    });
  }
  return globalForInit.__tallyDbReady;
}
