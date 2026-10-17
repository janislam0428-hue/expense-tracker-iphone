import type { Db } from "@/lib/db-client";
import { CATEGORY_SEEDS } from "./catalog";
import { classifyMerchant, type Classification } from "./classify";
import { ensureReferenceData } from "./ensure";

export const LEGACY_CATEGORIES: Record<string, Classification> = {
  Dining: { category: "Food" },
  Shopping: { category: "Personal Expense" },
  "Beauty & Cosmetics": { category: "Personal Expense" },
  "Department Stores": { category: "Personal Expense" },
  "Online Marketplace": { category: "Personal Expense" },
  Entertainment: { category: "Personal Expense", subcategory: "Leisure activities" },
  Health: { category: "Personal Expense", subcategory: "Health & supplements" },
  Subscriptions: { category: "Subscription" },
  Utilities: { category: "Bills", subcategory: "Utilities" },
  "Phone & Internet": { category: "Bills" },
  Education: { category: "Personal Expense", subcategory: "Learning & development" },
  "Gifts & Red Packets": { category: "Gift" },
  Travel: { category: "Travel Expense" },
};

const RENAME = {
  Dining: "Food", Shopping: "Personal Expense", Subscriptions: "Subscription",
  Utilities: "Bills", "Gifts & Red Packets": "Gift", Travel: "Travel Expense",
};
const TRANSIT = new Set(["MTR", "Bus", "Minibus", "Ferry", "Tram"]);

// Safe for repeated runs. No schema change and no transaction deletion.
export async function migrateTaxonomy(db: Db) {
  return db.$transaction(async (db) => {
    const originals = await db.category.findMany();
    const originalNames = new Map(originals.map((c) => [c.id, c.name]));
    for (const [oldName, name] of Object.entries(RENAME)) {
      const old = await db.category.findFirst({ where: { name: oldName, parentId: null } });
      const target = await db.category.findFirst({ where: { name, parentId: null } });
      if (old && !target) {
        // Preserve the ID and any budget/alert links whenever a rename suffices.
        await db.category.update({ where: { id: old.id }, data: { name } });
      }
    }
    await ensureReferenceData(db);
    const categories = await db.category.findMany();
    const byId = new Map(categories.map((c) => [c.id, c]));
    const root = (name: string) => categories.find((c) => c.name === name && !c.parentId)!;
    const child = (parentId: string, name?: string) =>
      name ? categories.find((c) => c.parentId === parentId && c.name === name && !c.archived) : undefined;

    function resolve(categoryId: string, subcategoryId: string | null, merchant = "") {
      const current = byId.get(categoryId);
      if (!current) return null;
      const parent = current.parentId ? byId.get(current.parentId)! : current;
      const sub = current.parentId ? current : subcategoryId ? byId.get(subcategoryId) : undefined;
      const legacy = LEGACY_CATEGORIES[originalNames.get(parent.id) ?? parent.name];
      const mapped = legacy ?? { category: parent.name };
      const target = root(mapped.category);
      if (!target) return null; // Keep custom categories untouched.
      // Preserve explicitly unspecified/new classifications on repeated runs.
      const allowedChildren = CATEGORY_SEEDS.find((seed) => seed.name === target.name)?.children;
      if (!legacy && (!sub || (child(target.id, sub.name) && (!allowedChildren || allowedChildren.includes(sub.name))))) {
        return { categoryId: target.id, subcategoryId: sub?.id ?? null };
      }
      let subName = sub?.name;
      if (target.name === "Transport" && subName) {
        if (TRANSIT.has(subName)) subName = "Public transport";
        else if (subName === "Taxi") subName = "Taxi/Uber";
      }
      // "Clothing" cannot tell us work vs leisure; do not guess.
      const hint = classifyMerchant(merchant);
      const targetChild = child(target.id, subName) ??
        child(target.id, mapped.subcategory) ??
        (hint?.category === target.name ? child(target.id, hint.subcategory) : undefined);
      return { categoryId: target.id, subcategoryId: targetChild?.id ?? null };
    }

    let transactionsChanged = 0;
    const transactions = await db.transaction.findMany();
    for (const tx of transactions) {
      if (!tx.categoryId) continue;
      const next = resolve(tx.categoryId, tx.subcategoryId, tx.merchant);
      if (!next) continue;
      if (next.categoryId !== tx.categoryId || next.subcategoryId !== tx.subcategoryId) {
        await db.transaction.update({ where: { id: tx.id }, data: next });
        transactionsChanged++;
      }
    }
    for (const rule of await db.merchantRule.findMany()) {
      if (!rule.categoryId) continue;
      const next = resolve(rule.categoryId, null, rule.pattern);
      if (next) {
        await db.merchantRule.update({
          where: { id: rule.id }, data: { categoryId: next.subcategoryId ?? next.categoryId },
        });
      }
    }
    for (const old of categories.filter((c) => !c.parentId && LEGACY_CATEGORIES[c.name])) {
      const target = root(LEGACY_CATEGORIES[old.name].category);
      if (!old.archived) {
        // Merge budgets once, while retaining the archived originals for audit.
        for (const budget of await db.budget.findMany({ where: { categoryId: old.id } })) {
          await db.budget.upsert({
            where: { categoryId_period: { categoryId: target.id, period: budget.period } },
            create: { categoryId: target.id, period: budget.period, amountMinor: budget.amountMinor },
            update: { amountMinor: { increment: budget.amountMinor } },
          });
        }
        await db.alertRule.updateMany({ where: { categoryId: old.id }, data: { categoryId: target.id } });
      }
      await db.category.update({ where: { id: old.id }, data: { archived: true } });
      await db.category.updateMany({ where: { parentId: old.id }, data: { archived: true } });
    }
    for (const [index, seed] of CATEGORY_SEEDS.entries()) {
      const target = root(seed.name);
      await db.category.update({
        where: { id: target.id },
        data: { archived: false, sortOrder: (index + 1) * 10, color: seed.color, ambiguous: seed.ambiguous },
      });
      // Old children remain archived, not deleted.
      await db.category.updateMany({
        where: { parentId: target.id, name: { notIn: seed.children ?? [] } },
        data: { archived: true },
      });
    }
    return { transactionsChanged };
  }, { timeout: 120_000 });
}
