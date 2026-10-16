import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { demoScope, getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/app/page-header";
import { TransactionsView } from "./transactions-view";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  await requireAuth();
  const settings = await getSettings();
  const where = { ...demoScope(settings), duplicateOfId: null, occurredAt: { lt: new Date() } };

  const [rows, total, categories, sources, purposes] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: 200,
      include: { category: true, subcategory: true, source: true, purpose: true },
    }),
    db.transaction.count({ where }),
    db.category.findMany({ where: { parentId: null, archived: false }, orderBy: { sortOrder: "asc" } }),
    db.paymentSource.findMany({ where: { isActive: true } }),
    db.purpose.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        description={`${total.toLocaleString("en-HK")} transactions recorded. Showing recent transactions.`}
      />
      <TransactionsView
        initialTransactions={rows}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        sources={sources.map((s) => ({ id: s.id, name: s.name }))}
        purposes={purposes.map((p) => ({ id: p.id, name: p.name }))}
        zone={settings.timezone}
        currency={settings.currency}
      />
    </div>
  );
}
