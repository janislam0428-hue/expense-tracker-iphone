import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { demoScope, type AppSettings } from "@/lib/settings";
import { daysElapsedInMonth, daysInMonth, monthPeriod, previousMonthPeriod } from "@/lib/time";
import { evaluateAlert, strategyFromRule, type CategoryAlert } from "@/lib/alerts/strategy";
import { predictionTier } from "@/lib/insights/tier";

// Dashboard totals strictly include confirmed (and auto-confirmed) expenses/refunds only — never unconfirmed items or top-ups.
const CONFIRMED_SPEND_WHERE: Prisma.TransactionWhereInput = {
  type: { in: ["expense", "refund"] },
  purposeStatus: { in: ["auto", "confirmed"] },
  duplicateOfId: null,
};

type Grouped = { categoryId: string | null; type: string; _sum: { amountMinor: number | null }; _count: { _all: number } };

function netByCategory(rows: Grouped[]) {
  const map = new Map<string | null, { net: number; count: number }>();
  for (const r of rows) {
    const cur = map.get(r.categoryId) ?? { net: 0, count: 0 };
    const amt = r._sum.amountMinor ?? 0;
    cur.net += r.type === "refund" ? -amt : amt;
    if (r.type === "expense") cur.count += r._count._all;
    map.set(r.categoryId, cur);
  }
  return map;
}

export async function getOverview(settings: AppSettings, now = new Date()) {
  const zone = settings.timezone;
  const scope = demoScope(settings);
  const month = monthPeriod(now, zone);
  const prev = previousMonthPeriod(now, zone);
  const elapsed = daysElapsedInMonth(now, zone);
  const prevSameEnd = new Date(Math.min(prev.start.getTime() + elapsed * 86_400_000, prev.end.getTime()));

  const [curRows, prevRows, prevFullRows, categories, pendingAgg, recent, first, lastBatch, alertRule] =
    await Promise.all([
      db.transaction.groupBy({
        by: ["categoryId", "type"],
        where: { ...scope, ...CONFIRMED_SPEND_WHERE, occurredAt: { gte: month.start, lt: month.end } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      db.transaction.groupBy({
        by: ["categoryId", "type"],
        where: { ...scope, ...CONFIRMED_SPEND_WHERE, occurredAt: { gte: prev.start, lt: prevSameEnd } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      db.transaction.groupBy({
        by: ["categoryId", "type"],
        where: { ...scope, ...CONFIRMED_SPEND_WHERE, occurredAt: { gte: prev.start, lt: prev.end } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      db.category.findMany({ where: { parentId: null } }),
      db.transaction.aggregate({
        where: { ...scope, purposeStatus: "needs_review", duplicateOfId: null },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
      db.transaction.findMany({
        where: {
          ...scope,
          ...CONFIRMED_SPEND_WHERE,
          OR: [{ isDemo: false }, { occurredAt: { lt: now } }],
        },
        orderBy: { occurredAt: "desc" },
        take: 8,
        include: { category: true, subcategory: true, source: true, purpose: true },
      }),
      db.transaction.findFirst({ where: scope, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } }),
      db.importBatch.findFirst({ where: scope, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.alertRule.findFirst({ where: { scope: "global", enabled: true } }),
    ]);

  const cur = netByCategory(curRows as Grouped[]);
  const prevMap = netByCategory(prevRows as Grouped[]);
  const prevFull = netByCategory(prevFullRows as Grouped[]);
  const catById = new Map(categories.map((c) => [c.id, c]));

  const total = [...cur.values()].reduce((a, b) => a + b.net, 0);
  const prevTotal = [...prevMap.values()].reduce((a, b) => a + b.net, 0);
  const count = [...cur.values()].reduce((a, b) => a + b.count, 0);

  const strategy = strategyFromRule(alertRule);
  const byCategory = [...cur.entries()]
    .filter(([, v]) => v.net > 0)
    .map(([id, v]) => {
      const c = id ? catById.get(id) : undefined;
      const alert: CategoryAlert | null = id
        ? evaluateAlert(strategy, {
            categoryId: id,
            categoryName: c?.name ?? "Uncategorised",
            monthTotalMinor: v.net,
            historyMinor: [prevFull.get(id)?.net ?? 0],
            categoryThresholdMinor: c?.monthlyAlertMinor ?? null,
            globalThresholdMinor: settings.alertThresholdMinor,
          })
        : null;
      return {
        id,
        name: c?.name ?? "Uncategorised",
        color: c?.color ?? "gray",
        netMinor: v.net,
        count: v.count,
        prevSameDaysMinor: prevMap.get(id)?.net ?? 0,
        alert,
      };
    })
    .sort((a, b) => b.netMinor - a.netMinor);

  const lastImportAt = lastBatch?.createdAt ?? settings.lastImportAt ?? null;
  const daysSinceImport = lastImportAt ? Math.floor((now.getTime() - lastImportAt.getTime()) / 86_400_000) : null;
  const pending = pendingAgg._count._all;
  const pendingTotalMinor = pendingAgg._sum.amountMinor ?? 0;

  return {
    month,
    elapsed,
    daysInMonth: daysInMonth(now, zone),
    totalMinor: total,
    prevSameDaysMinor: prevTotal,
    transactionCount: count,
    avgPerDayMinor: Math.round(total / Math.max(1, elapsed)),
    topCategory: byCategory[0] ?? null,
    byCategory,
    alerts: byCategory.map((c) => c.alert).filter((a): a is CategoryAlert => a !== null),
    pending,
    pendingTotalMinor,
    recent,
    lastImportAt,
    daysSinceImport,
    tier: predictionTier(first?.occurredAt ?? null, now),
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;
