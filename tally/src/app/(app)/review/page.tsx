import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { demoScope, getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/app/page-header";
import { ReviewInbox } from "./review-inbox";

export const metadata: Metadata = { title: "To confirm" };

export default async function ReviewPage() {
  await requireAuth();
  const settings = await getSettings();

  const [rows, purposes, categories] = await Promise.all([
    db.transaction.findMany({
      where: { ...demoScope(settings), purposeStatus: "needs_review", duplicateOfId: null },
      orderBy: { occurredAt: "desc" },
      include: { category: true, subcategory: true, source: true, purpose: true },
    }),
    db.purpose.findMany({ orderBy: { sortOrder: "asc" } }),
    db.category.findMany({
      where: { parentId: null, archived: false },
      orderBy: { sortOrder: "asc" },
      include: { children: { where: { archived: false }, orderBy: { sortOrder: "asc" } } },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="To confirm"
        description="Transactions where the purpose isn't obvious or exceeds your review threshold. Small everyday fares are auto-confirmed."
      />
      <ReviewInbox
        initialTransactions={rows}
        categories={categories.map((c) => ({
          id: c.id, name: c.name,
          children: c.children.map((s) => ({ id: s.id, name: s.name })),
        }))}
        purposes={purposes.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          shortcutKey: p.shortcutKey,
        }))}
        zone={settings.timezone}
      />
    </div>
  );
}
