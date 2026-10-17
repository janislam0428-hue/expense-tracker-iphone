import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { demoScope, type AppSettings } from "@/lib/settings";
import {
  addZonedDays,
  dayStart,
  daysElapsedInMonth,
  daysInMonth,
  formatInZone,
  monthPeriod,
  previousMonthPeriod,
  weekStart,
  yearStart,
  zonedDate,
  zonedParts,
} from "@/lib/time";
import { evaluateAlert, strategyFromRule, type CategoryAlert } from "@/lib/alerts/strategy";
import { predictionTier } from "@/lib/insights/tier";

// Dashboard totals strictly include confirmed (and auto-confirmed) expenses/refunds only — never unconfirmed items or top-ups.
const CONFIRMED_SPEND_WHERE: Prisma.TransactionWhereInput = {
  type: { in: ["expense", "refund"] },
  purposeStatus: { in: ["auto", "confirmed"] },
  duplicateOfId: null,
};

export type PeriodKey = "day" | "week" | "month" | "year";

export type CategorySlice = {
  id: string | null;
  name: string;
  color: string;
  netMinor: number;
  count: number;
  sharePct: number;
  limitMinor: number;
};

export type SubcategorySlice = {
  id: string | null;
  name: string;
  parentId: string | null;
  parentName: string;
  parentColor: string;
  netMinor: number;
  count: number;
  sharePct: number;
};

export type HorizonSummary = {
  key: PeriodKey;
  label: string;
  sublabel: string;
  totalMinor: number;
  transactionCount: number;
  topCategory: CategorySlice | null;
  topSubcategory: SubcategorySlice | null;
  byCategory: CategorySlice[];
  bySubcategory: SubcategorySlice[];
};

export type TimeSeriesBar = {
  key: string;
  label: string;
  totalMinor: number;
  changePct: number | null;
  byCategory: Array<{
    categoryId: string | null;
    name: string;
    color: string;
    amountMinor: number;
  }>;
};

export type DailyPacePoint = {
  day: number;
  dateLabel: string;
  cumulativeMinor: number;
  proRataMinor: number;
};

export type CategoryPacingFlag = {
  categoryId: string;
  name: string;
  color: string;
  spentMinor: number;
  limitMinor: number;
  hasCustomLimit: boolean;
  pctOfLimit: number;
  latestTxDateLabel: string | null;
  latestTxDay: number;
  proRataAtTxMinor: number;
  status: "over_limit" | "pacing_flag" | "on_track";
  flagMessage: string | null;
  lastMonthMinor: number;
  avgMonthlyMinor: number;
  suggestedThresholdMinor: number;
  dailyCumulative: DailyPacePoint[];
};

function roundSuggestedMinor(rawMinor: number): number {
  if (rawMinor <= 0) return 50000; // Default HK$500 if no spend yet
  // Add a 15% buffer above average/recent spend and round up to nearest HK$50 (5000 minor)
  const buffered = Math.round(rawMinor * 1.15);
  const step = buffered >= 200000 ? 10000 : 5000; // HK$100 or HK$50 steps
  return Math.max(10000, Math.ceil(buffered / step) * step);
}

export async function getOverview(settings: AppSettings, now = new Date()) {
  const zone = settings.timezone;
  const scope = demoScope(settings);
  const month = monthPeriod(now, zone);
  const prev = previousMonthPeriod(now, zone);
  const elapsed = daysElapsedInMonth(now, zone);
  const totalDaysInMonth = daysInMonth(now, zone);
  const prevSameEnd = new Date(Math.min(prev.start.getTime() + elapsed * 86_400_000, prev.end.getTime()));

  const todayStart = dayStart(now, zone);
  const thisWeekStart = weekStart(now, zone, (settings.weekStart === 0 ? 0 : 1) as 0 | 1);
  const thisYearStart = yearStart(now, zone);

  // Earliest date needed for 6 months + Full Year analytics
  const sixMonthsAgoParts = zonedParts(now, zone);
  let earliestYear = sixMonthsAgoParts.year;
  let earliestMonth = sixMonthsAgoParts.month - 5;
  if (earliestMonth <= 0) {
    earliestMonth += 12;
    earliestYear -= 1;
  }
  const sixMonthsStart = zonedDate(earliestYear, earliestMonth, 1, 0, 0, zone);
  const queryStart = new Date(Math.min(thisYearStart.getTime(), sixMonthsStart.getTime()));

  const [allConfirmedTxs, categories, subcategories, pendingAgg, recent, first, lastBatch, alertRule] =
    await Promise.all([
      db.transaction.findMany({
        where: {
          ...scope,
          ...CONFIRMED_SPEND_WHERE,
          occurredAt: { gte: queryStart },
          OR: [{ isDemo: false }, { occurredAt: { lt: now } }],
        },
        select: {
          id: true,
          occurredAt: true,
          amountMinor: true,
          type: true,
          merchant: true,
          categoryId: true,
          subcategoryId: true,
        },
        orderBy: { occurredAt: "asc" },
      }),
      db.category.findMany({
        where: { parentId: null, archived: false },
        orderBy: { sortOrder: "asc" },
      }),
      db.category.findMany({
        where: { NOT: { parentId: null }, archived: false },
        orderBy: { sortOrder: "asc" },
      }),
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

  const catById = new Map(categories.map((c) => [c.id, c]));
  const subById = new Map(subcategories.map((s) => [s.id, s]));

  // Helper to compute slices for any time window [start, end)
  function buildHorizon(
    key: PeriodKey,
    label: string,
    sublabel: string,
    start: Date,
    end: Date,
  ): HorizonSummary {
    const catMap = new Map<string | null, { net: number; count: number }>();
    const subMap = new Map<string | null, { net: number; count: number; parentId: string | null }>();

    for (const tx of allConfirmedTxs) {
      if (tx.occurredAt < start || tx.occurredAt >= end) continue;
      const signed = tx.type === "refund" ? -tx.amountMinor : tx.amountMinor;

      const curCat = catMap.get(tx.categoryId) ?? { net: 0, count: 0 };
      curCat.net += signed;
      if (tx.type === "expense") curCat.count += 1;
      catMap.set(tx.categoryId, curCat);

      const subKey = tx.subcategoryId ?? `unspec:${tx.categoryId ?? "none"}`;
      const curSub = subMap.get(subKey) ?? { net: 0, count: 0, parentId: tx.categoryId };
      curSub.net += signed;
      if (tx.type === "expense") curSub.count += 1;
      subMap.set(subKey, curSub);
    }

    const totalMinor = [...catMap.values()].reduce((acc, v) => acc + Math.max(0, v.net), 0);
    const transactionCount = [...catMap.values()].reduce((acc, v) => acc + v.count, 0);

    const byCategory: CategorySlice[] = [...catMap.entries()]
      .filter(([, v]) => v.net > 0)
      .map(([id, v]) => {
        const c = id ? catById.get(id) : undefined;
        const limitMinor = c?.monthlyAlertMinor ?? settings.alertThresholdMinor;
        return {
          id,
          name: c?.name ?? "Uncategorised",
          color: c?.color ?? "gray",
          netMinor: v.net,
          count: v.count,
          sharePct: totalMinor > 0 ? Math.round((v.net / totalMinor) * 1000) / 10 : 0,
          limitMinor,
        };
      })
      .sort((a, b) => b.netMinor - a.netMinor);

    const bySubcategory: SubcategorySlice[] = [...subMap.entries()]
      .filter(([, v]) => v.net > 0)
      .map(([rawKey, v]) => {
        const isUnspec = rawKey?.startsWith("unspec:");
        const subId = isUnspec ? null : rawKey;
        const s = subId ? subById.get(subId) : undefined;
        const parentId = s?.parentId ?? v.parentId ?? null;
        const parent = parentId ? catById.get(parentId) : undefined;
        return {
          id: subId,
          name: s?.name ?? (parent ? `${parent.name} (General)` : "Unspecified"),
          parentId,
          parentName: parent?.name ?? "Uncategorised",
          parentColor: parent?.color ?? "gray",
          netMinor: v.net,
          count: v.count,
          sharePct: totalMinor > 0 ? Math.round((v.net / totalMinor) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.netMinor - a.netMinor);

    return {
      key,
      label,
      sublabel,
      totalMinor,
      transactionCount,
      topCategory: byCategory[0] ?? null,
      topSubcategory: bySubcategory[0] ?? null,
      byCategory,
      bySubcategory,
    };
  }

  const farFuture = new Date(now.getTime() + 365 * 86_400_000);
  const horizons: Record<PeriodKey, HorizonSummary> = {
    day: buildHorizon("day", "Today", formatInZone(now, "EEE d MMM", zone), todayStart, farFuture),
    week: buildHorizon(
      "week",
      "This Week",
      `Since ${formatInZone(thisWeekStart, "d MMM", zone)}`,
      thisWeekStart,
      farFuture,
    ),
    month: buildHorizon("month", "This Month", formatInZone(month.start, "MMMM yyyy", zone), month.start, month.end),
    year: buildHorizon("year", "This Year", formatInZone(thisYearStart, "yyyy", zone), thisYearStart, farFuture),
  };

  // Previous month same-days and full-month totals
  let prevSameDaysMinor = 0;
  const prevFullByCat = new Map<string | null, number>();
  for (const tx of allConfirmedTxs) {
    if (tx.occurredAt >= prev.start && tx.occurredAt < prev.end) {
      const signed = tx.type === "refund" ? -tx.amountMinor : tx.amountMinor;
      prevFullByCat.set(tx.categoryId, (prevFullByCat.get(tx.categoryId) ?? 0) + signed);
      if (tx.occurredAt < prevSameEnd) {
        prevSameDaysMinor += signed;
      }
    }
  }
  prevSameDaysMinor = Math.max(0, prevSameDaysMinor);

  // Build Week-over-Week series (last 6 weeks)
  const weeklySeries: TimeSeriesBar[] = [];
  for (let i = 5; i >= 0; i--) {
    const wStart = addZonedDays(thisWeekStart, -i * 7, zone);
    const wEnd = addZonedDays(wStart, 7, zone);
    const catTotals = new Map<string | null, number>();
    let wTotal = 0;
    for (const tx of allConfirmedTxs) {
      if (tx.occurredAt >= wStart && tx.occurredAt < wEnd) {
        const signed = tx.type === "refund" ? -tx.amountMinor : tx.amountMinor;
        catTotals.set(tx.categoryId, (catTotals.get(tx.categoryId) ?? 0) + signed);
        wTotal += signed;
      }
    }
    wTotal = Math.max(0, wTotal);
    const prevBar = weeklySeries[weeklySeries.length - 1];
    const changePct =
      prevBar && prevBar.totalMinor > 0 ? Math.round(((wTotal - prevBar.totalMinor) / prevBar.totalMinor) * 100) : null;

    weeklySeries.push({
      key: formatInZone(wStart, "yyyy-MM-dd", zone),
      label: i === 0 ? "This wk" : formatInZone(wStart, "d MMM", zone),
      totalMinor: wTotal,
      changePct,
      byCategory: [...catTotals.entries()]
        .filter(([, amt]) => amt > 0)
        .map(([cid, amt]) => {
          const c = cid ? catById.get(cid) : undefined;
          return {
            categoryId: cid,
            name: c?.name ?? "Uncategorised",
            color: c?.color ?? "gray",
            amountMinor: amt,
          };
        })
        .sort((a, b) => b.amountMinor - a.amountMinor),
    });
  }

  // Build Month-over-Month series (last 6 months)
  const monthlySeries: TimeSeriesBar[] = [];
  const nowParts = zonedParts(now, zone);
  for (let i = 5; i >= 0; i--) {
    let y = nowParts.year;
    let m = nowParts.month - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const mStart = zonedDate(y, m, 1, 0, 0, zone);
    const mPeriod = monthPeriod(mStart, zone);
    const catTotals = new Map<string | null, number>();
    let mTotal = 0;
    for (const tx of allConfirmedTxs) {
      if (tx.occurredAt >= mPeriod.start && tx.occurredAt < mPeriod.end) {
        const signed = tx.type === "refund" ? -tx.amountMinor : tx.amountMinor;
        catTotals.set(tx.categoryId, (catTotals.get(tx.categoryId) ?? 0) + signed);
        mTotal += signed;
      }
    }
    mTotal = Math.max(0, mTotal);
    const prevBar = monthlySeries[monthlySeries.length - 1];
    const changePct =
      prevBar && prevBar.totalMinor > 0 ? Math.round(((mTotal - prevBar.totalMinor) / prevBar.totalMinor) * 100) : null;

    monthlySeries.push({
      key: formatInZone(mPeriod.start, "yyyy-MM", zone),
      label: formatInZone(mPeriod.start, "MMM", zone),
      totalMinor: mTotal,
      changePct,
      byCategory: [...catTotals.entries()]
        .filter(([, amt]) => amt > 0)
        .map(([cid, amt]) => {
          const c = cid ? catById.get(cid) : undefined;
          return {
            categoryId: cid,
            name: c?.name ?? "Uncategorised",
            color: c?.color ?? "gray",
            amountMinor: amt,
          };
        })
        .sort((a, b) => b.amountMinor - a.amountMinor),
    });
  }

  // Overall daily cumulative series for the current month
  const overallDailySpend = new Array<number>(totalDaysInMonth + 1).fill(0);
  const catDailySpend = new Map<string, number[]>();
  const catLatestTxDate = new Map<string, Date>();

  for (const c of categories) {
    catDailySpend.set(c.id, new Array<number>(totalDaysInMonth + 1).fill(0));
  }

  for (const tx of allConfirmedTxs) {
    if (tx.occurredAt < month.start || tx.occurredAt >= month.end) continue;
    const tp = zonedParts(tx.occurredAt, zone);
    const dayNum = Math.min(totalDaysInMonth, Math.max(1, tp.day));
    const signed = tx.type === "refund" ? -tx.amountMinor : tx.amountMinor;
    overallDailySpend[dayNum] += signed;

    if (tx.categoryId && catDailySpend.has(tx.categoryId)) {
      const arr = catDailySpend.get(tx.categoryId)!;
      arr[dayNum] += signed;
      const prevLatest = catLatestTxDate.get(tx.categoryId);
      if (!prevLatest || tx.occurredAt > prevLatest) {
        catLatestTxDate.set(tx.categoryId, tx.occurredAt);
      }
    }
  }

  const NON_SPEND_CATS = new Set(["Money Received", "Top ups & Transfers"]);

  // Build Pacing & Threshold flags + smart suggestions per category
  const categoryPacing: CategoryPacingFlag[] = categories
    .filter((c) => !NON_SPEND_CATS.has(c.name))
    .map((c) => {
      const limitMinor = c.monthlyAlertMinor ?? settings.alertThresholdMinor;
      const hasCustomLimit = c.monthlyAlertMinor !== null;
      const dailyArr = catDailySpend.get(c.id) ?? new Array<number>(totalDaysInMonth + 1).fill(0);

      let running = 0;
      const dailyCumulative: DailyPacePoint[] = [];
      for (let d = 1; d <= elapsed; d++) {
        running += dailyArr[d];
        const dateObj = zonedDate(nowParts.year, nowParts.month, d, 12, 0, zone);
        dailyCumulative.push({
          day: d,
          dateLabel: formatInZone(dateObj, "d MMM", zone),
          cumulativeMinor: Math.max(0, running),
          proRataMinor: Math.round((limitMinor * d) / totalDaysInMonth),
        });
      }

      const spentMinor = Math.max(0, running);
      const pctOfLimit = limitMinor > 0 ? Math.round((spentMinor / limitMinor) * 1000) / 10 : 0;
      const latestTx = catLatestTxDate.get(c.id) ?? null;
      const latestTxDay = latestTx ? zonedParts(latestTx, zone).day : elapsed;
      const latestTxDateLabel = latestTx ? formatInZone(latestTx, "d MMM", zone) : null;
      const proRataAtTxMinor = Math.round((limitMinor * latestTxDay) / totalDaysInMonth);

      // Historical monthly spend for this category across the last 6 months
      const activeMonthTotals: number[] = [];
      for (const mBar of monthlySeries) {
        const found = mBar.byCategory.find((x) => x.categoryId === c.id);
        if (found && found.amountMinor > 0) {
          activeMonthTotals.push(found.amountMinor);
        }
      }
      const lastMonthMinor = Math.max(0, prevFullByCat.get(c.id) ?? 0);
      const avgMonthlyMinor =
        activeMonthTotals.length > 0
          ? Math.round(activeMonthTotals.reduce((a, b) => a + b, 0) / activeMonthTotals.length)
          : spentMinor;

      const basisMinor = lastMonthMinor > 0 ? Math.round((lastMonthMinor + avgMonthlyMinor) / 2) : avgMonthlyMinor;
      const suggestedThresholdMinor = roundSuggestedMinor(basisMinor);

      let status: "over_limit" | "pacing_flag" | "on_track" = "on_track";
      let flagMessage: string | null = null;

      if (spentMinor > limitMinor) {
        status = "over_limit";
        flagMessage = `Exceeded monthly threshold (${pctOfLimit}% of limit) as of ${latestTxDateLabel ?? "today"}.`;
      } else if (spentMinor > 0 && (spentMinor >= limitMinor * 0.5 || spentMinor > proRataAtTxMinor)) {
        status = "pacing_flag";
        flagMessage = `${pctOfLimit}% of monthly threshold spent by ${latestTxDateLabel ?? `Oct ${latestTxDay}`} (ahead of day-${latestTxDay} pace).`;
      }

      return {
        categoryId: c.id,
        name: c.name,
        color: c.color,
        spentMinor,
        limitMinor,
        hasCustomLimit,
        pctOfLimit,
        latestTxDateLabel,
        latestTxDay,
        proRataAtTxMinor,
        status,
        flagMessage,
        lastMonthMinor,
        avgMonthlyMinor,
        suggestedThresholdMinor,
        dailyCumulative,
      };
    })
    .sort((a, b) => b.spentMinor - a.spentMinor);

  // Build overall daily cumulative points
  const overallLimitMinor = categoryPacing.reduce((acc, c) => acc + c.limitMinor, 0) || settings.alertThresholdMinor;
  let overallRunning = 0;
  const overallDailyCumulative: DailyPacePoint[] = [];
  for (let d = 1; d <= elapsed; d++) {
    overallRunning += overallDailySpend[d];
    const dateObj = zonedDate(nowParts.year, nowParts.month, d, 12, 0, zone);
    overallDailyCumulative.push({
      day: d,
      dateLabel: formatInZone(dateObj, "d MMM", zone),
      cumulativeMinor: Math.max(0, overallRunning),
      proRataMinor: Math.round((overallLimitMinor * d) / totalDaysInMonth),
    });
  }

  const strategy = strategyFromRule(alertRule);
  const byCategory = horizons.month.byCategory.map((c) => {
    const catObj = c.id ? catById.get(c.id) : undefined;
    const alert: CategoryAlert | null = c.id
      ? evaluateAlert(strategy, {
          categoryId: c.id,
          categoryName: c.name,
          monthTotalMinor: c.netMinor,
          historyMinor: [prevFullByCat.get(c.id) ?? 0],
          categoryThresholdMinor: catObj?.monthlyAlertMinor ?? null,
          globalThresholdMinor: settings.alertThresholdMinor,
        })
      : null;
    return {
      ...c,
      prevSameDaysMinor: 0,
      alert,
    };
  });

  const totalMinor = horizons.month.totalMinor;
  const transactionCount = horizons.month.transactionCount;
  const lastImportAt = lastBatch?.createdAt ?? settings.lastImportAt ?? null;
  const daysSinceImport = lastImportAt ? Math.floor((now.getTime() - lastImportAt.getTime()) / 86_400_000) : null;
  const pending = pendingAgg._count._all;
  const pendingTotalMinor = pendingAgg._sum.amountMinor ?? 0;

  return {
    month,
    elapsed,
    daysInMonth: totalDaysInMonth,
    totalMinor,
    prevSameDaysMinor,
    transactionCount,
    avgPerDayMinor: Math.round(totalMinor / Math.max(1, elapsed)),
    topCategory: byCategory[0] ?? null,
    byCategory,
    alerts: byCategory.map((c) => c.alert).filter((a): a is CategoryAlert => a !== null),
    horizons,
    weeklySeries,
    monthlySeries,
    categoryPacing,
    overallDailyCumulative,
    overallLimitMinor,
    pending,
    pendingTotalMinor,
    recent,
    lastImportAt,
    daysSinceImport,
    tier: predictionTier(first?.occurredAt ?? null, now),
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;
