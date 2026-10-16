// Switches demo data on and off. Demo rows are flagged with isDemo so they
// never mix with real imports and can be removed in one step.
import type { Db } from "@/lib/db-client";
import { decideReview } from "@/lib/review/rules";
import { loadRefMaps } from "@/lib/reference/ensure";
import { addZonedDays } from "@/lib/time";
import { demoFingerprint, generateDemo } from "./generate";

/** Transactions newer than this are left in To confirm so the inbox has something to show. */
const RECENT_DAYS = 14;

export async function removeDemoData(db: Db) {
  const [tx] = await db.$transaction([
    db.transaction.deleteMany({ where: { isDemo: true } }),
    db.merchantRule.deleteMany({ where: { isDemo: true } }),
    db.importBatch.deleteMany({ where: { isDemo: true } }),
  ]);
  // Reset "last import" to the latest real import, if any.
  const lastReal = await db.importBatch.findFirst({ where: { isDemo: false }, orderBy: { createdAt: "desc" } });
  await db.settings.update({ where: { id: 1 }, data: { lastImportAt: lastReal?.createdAt ?? null } });
  return tx.count;
}

export async function loadDemoData(db: Db, now = new Date()) {
  await removeDemoData(db);
  const refs = await loadRefMaps(db);
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const { transactions, rules } = generateDemo(now);
  const recentCutoff = addZonedDays(now, -RECENT_DAYS);
  const rulePatterns = new Set(rules.map((r) => r.pattern));

  const lastImport = addZonedDays(now, -5);
  const batch = await db.importBatch.create({
    data: { channel: "demo", sourceHint: "Demo data", capturedAt: lastImport, createdAt: lastImport, isDemo: true },
  });

  let needsReview = 0;
  const rows = transactions.map((t, i) => {
    const cat = t.category ? refs.category(t.category, t.subcategory) : null;
    const parentCat = t.category ? refs.category(t.category) : null;
    const hasRule = [...rulePatterns].some((p) => t.merchantNormalized.includes(p));
    const decision = decideReview({
      amountMinor: t.amountMinor,
      type: t.type,
      categoryAmbiguous: cat ? cat.ambiguous : null,
      hasRulePurpose: hasRule,
      isPersonToPerson: t.isPersonToPerson,
      reviewThresholdMinor: settings.reviewThresholdMinor,
    });
    let status: string = decision.status;
    if (status === "needs_review" && t.occurredAt < recentCutoff) status = "confirmed";
    if (status === "needs_review") needsReview++;
    return {
      occurredAt: t.occurredAt,
      datePrecision: t.datePrecision,
      amountMinor: t.amountMinor,
      currency: settings.currency,
      merchant: t.merchant,
      merchantNormalized: t.merchantNormalized,
      counterparty: t.counterparty ?? null,
      description: t.description ?? null,
      location: t.location ?? null,
      categoryId: parentCat?.id ?? null,
      subcategoryId: t.subcategory && cat ? cat.id : null,
      sourceId: refs.source(t.source),
      channel: "demo",
      type: t.type,
      purposeId: t.purpose ? refs.purpose(t.purpose) : null,
      purposeStatus: status,
      reviewReasons: JSON.stringify(decision.reasons),
      balanceAfterMinor: t.balanceAfterMinor ?? null,
      externalRef: t.externalRef ?? null,
      notes: t.notes ?? null,
      fingerprint: demoFingerprint(t, i),
      importBatchId: batch.id,
      isDemo: true,
    };
  });

  for (let i = 0; i < rows.length; i += 400) {
    await db.transaction.createMany({ data: rows.slice(i, i + 400) });
  }

  for (const r of rules) {
    const cat = refs.category(r.category, r.subcategory);
    await db.merchantRule.create({
      data: {
        pattern: r.pattern,
        matchType: "contains",
        categoryId: r.subcategory ? refs.category(r.category).id : cat.id,
        purposeId: refs.purpose(r.purpose),
        isDemo: true,
      },
    });
  }

  await db.importBatch.update({ where: { id: batch.id }, data: { added: rows.length, needsReview } });
  await db.settings.update({ where: { id: 1 }, data: { demoEnabled: true, lastImportAt: lastImport } });
  return { added: rows.length, needsReview };
}
