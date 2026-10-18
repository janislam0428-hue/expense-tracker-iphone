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
  varianceMinor: number;
  latestTxDateLabel: string | null;
  latestTxDay: number;
  proRataAtTxMinor: number;
  status: "over_limit" | "pacing_flag" | "on_track";
  flagMessage: string | null;
  lastMonthMinor: number;
  avgMonthlyMinor: number;
  suggestedThresholdMinor: number;
  thresholdComment: string;
  thresholdUpdatedAt: string | null;
  dailyCumulative: DailyPacePoint[];
};

export type SpendingSurgeCategory = {
  categoryId: string;
  name: string;
  color: string;
  spentMinor: number;
  historicalAvgMinor: number;
  deltaMinor: number;
  surgePct: number;
  summaryText: string;
};

export type ThresholdLogEntry = {
  id: string;
  monthKey: string;
  categoryId: string | null;
  categoryName: string;
  previousMinor: number | null;
  amountMinor: number;
  comment: string;
  source: "suggestion" | "manual";
  changedAt: string;
  changedAtFormatted: string;
};

export type MonthlySnapshot = {
  monthKey: string; // e.g. "2026-10", "2026-09"
  label: string; // e.g. "October 2026", "September 2026"
  shortLabel: string; // e.g. "Oct 2026", "Sep 2026"
  isCurrentMonth: boolean;
  daysElapsed: number;
  daysInMonth: number;
  totalMinor: number;
  prevComparisonMinor: number;
  transactionCount: number;
  avgPerDayMinor: number;
  overallLimitMinor: number;
  topCategory: CategorySlice | null;
  topSubcategory: SubcategorySlice | null;
  surgeCategory: SpendingSurgeCategory | null;
  byCategory: CategorySlice[];
  bySubcategory: SubcategorySlice[];
  categoryPacing: CategoryPacingFlag[];
  overallDailyCumulative: DailyPacePoint[];
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
  const nowParts = zonedParts(now, zone);
  let earliestYear = nowParts.year;
  let earliestMonth = nowParts.month - 6;
  while (earliestMonth <= 0) {
    earliestMonth += 12;
    earliestYear -= 1;
  }
  const sixMonthsStart = zonedDate(earliestYear, earliestMonth, 1, 0, 0, zone);
  const queryStart = new Date(Math.min(thisYearStart.getTime(), sixMonthsStart.getTime()));

  const [
    allConfirmedTxs,
    categories,
    subcategories,
    pendingAgg,
    recent,
    first,
    lastBatch,
    alertRule,
    allBudgets,
    rawThresholdLogs,
  ] = await Promise.all([
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
    db.importBatch.findFirst({ where: scope, orderBy: { createdAt: true }, select: { createdAt: true } }).catch(() => null),
    db.alertRule.findFirst({ where: { scope: "global", enabled: true } }),
    db.budget.findMany(),
    db.alertRule.findMany({ where: { scope: "threshold_log" } }),
  ]);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const subById = new Map(subcategories.map((s) => [s.id, s]));
  const NON_SPEND_CATS = new Set(["Money Received", "Top ups & Transfers"]);
  const spendCategories = categories.filter((c) => !NON_SPEND_CATS.has(c.name));

  // Parse threshold change logs sorted newest-first
  const thresholdLogs: ThresholdLogEntry[] = [];
  for (const row of rawThresholdLogs) {
    try {
      const parsed = JSON.parse(row.params || "{}");
      const changedAtIso = typeof parsed.changedAt === "string" ? parsed.changedAt : new Date().toISOString();
      const changedDate = new Date(changedAtIso);
      const catObj = row.categoryId ? catById.get(row.categoryId) : undefined;
      thresholdLogs.push({
        id: row.id,
        monthKey: typeof parsed.monthKey === "string" ? parsed.monthKey : row.strategy,
        categoryId: row.categoryId ?? null,
        categoryName: parsed.categoryName || catObj?.name || "Default Monthly Alert",
        previousMinor: typeof parsed.previousMinor === "number" ? parsed.previousMinor : null,
        amountMinor: typeof parsed.amountMinor === "number" ? parsed.amountMinor : settings.alertThresholdMinor,
        comment:
          typeof parsed.comment === "string" && parsed.comment.trim()
            ? parsed.comment.trim()
            : "threshold testing and adjustment",
        source: parsed.source === "suggestion" ? "suggestion" : "manual",
        changedAt: changedAtIso,
        changedAtFormatted: Number.isNaN(changedDate.getTime())
          ? changedAtIso
          : formatInZone(changedDate, "d MMM yyyy, HH:mm", zone),
      });
    } catch {
      // Ignore malformed log entry
    }
  }
  thresholdLogs.sort((a, b) => b.changedAt.localeCompare(a.changedAt));

  // Ensure current month ("YYYY-MM") has a Budget snapshot for each spending category so that if
  // the month ends without further adjustments, this month's threshold is locked in for historical viewing.
  const currentMonthKey = formatInZone(month.start, "yyyy-MM", zone);
  const budgetMap = new Map<string, number>();
  for (const b of allBudgets) {
    budgetMap.set(`${b.categoryId}::${b.period}`, b.amountMinor);
  }

  for (const c of spendCategories) {
    const key = `${c.id}::${currentMonthKey}`;
    const currentEffective = c.monthlyAlertMinor ?? settings.alertThresholdMinor;
    if (!budgetMap.has(key)) {
      budgetMap.set(key, currentEffective);
      await db.budget
        .upsert({
          where: { categoryId_period: { categoryId: c.id, period: currentMonthKey } },
          create: { categoryId: c.id, period: currentMonthKey, amountMinor: currentEffective },
          update: {},
        })
        .catch(() => null);
    }
  }

  // Helper to resolve effective threshold & latest comment for (categoryId, monthKey) across the 6-month window.
  // Rule:
  // 1. If a threshold was set/changed in `monthKey` (stored in thresholdLogs or Budget for `monthKey`),
  //    use the LAST change made in `monthKey`.
  // 2. If no change was made in `monthKey`, carry forward the final threshold from the most recent prior month
  //    (or fall back to the category's current monthlyAlertMinor / global alertThresholdMinor).
  const monthKeysChronological: string[] = [];
  for (let i = 5; i >= 0; i--) {
    let y = nowParts.year;
    let m = nowParts.month - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const mStart = zonedDate(y, m, 1, 0, 0, zone);
    monthKeysChronological.push(formatInZone(mStart, "yyyy-MM", zone));
  }

  const resolvedThresholds = new Map<
    string,
    { limitMinor: number; comment: string; updatedAt: string | null; isCarriedForward: boolean }
  >();

  for (const c of spendCategories) {
    const fallbackMinor = c.monthlyAlertMinor ?? settings.alertThresholdMinor;
    let runningMinor = fallbackMinor;
    let runningComment = "threshold testing and adjustment";
    let runningUpdatedAt: string | null = null;

    for (const mKey of monthKeysChronological) {
      // Find the latest log entry for this category in this specific month
      const logsForMonth = thresholdLogs.filter(
        (l) => l.monthKey === mKey && (l.categoryId === c.id || l.categoryId === null),
      );
      const latestLog = logsForMonth[0] ?? null; // thresholdLogs is sorted newest-first
      const explicitBudget = budgetMap.get(`${c.id}::${mKey}`);

      if (latestLog) {
        runningMinor = latestLog.categoryId === c.id ? latestLog.amountMinor : explicitBudget ?? latestLog.amountMinor;
        runningComment = latestLog.comment;
        runningUpdatedAt = latestLog.changedAtFormatted;
        resolvedThresholds.set(`${c.id}::${mKey}`, {
          limitMinor: runningMinor,
          comment: runningComment,
          updatedAt: runningUpdatedAt,
          isCarriedForward: false,
        });
      } else if (explicitBudget !== undefined) {
        runningMinor = explicitBudget;
        resolvedThresholds.set(`${c.id}::${mKey}`, {
          limitMinor: runningMinor,
          comment: runningComment,
          updatedAt: runningUpdatedAt,
          isCarriedForward: true,
        });
      } else {
        resolvedThresholds.set(`${c.id}::${mKey}`, {
          limitMinor: runningMinor,
          comment: runningComment,
          updatedAt: runningUpdatedAt,
          isCarriedForward: true,
        });
      }
    }
  }

  // Helper to compute slices for any time window [start, end)
  function buildHorizon(
    key: PeriodKey,
    label: string,
    sublabel: string,
    start: Date,
    end: Date,
    mKeyForLimits = currentMonthKey,
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
        const limitMinor =
          (id ? resolvedThresholds.get(`${id}::${mKeyForLimits}`)?.limitMinor : undefined) ??
          c?.monthlyAlertMinor ??
          settings.alertThresholdMinor;
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

  // Precompute historical average monthly spend per category across active months
  const catHistoricalAvg = new Map<string, number>();
  for (const c of spendCategories) {
    const activeTotals: number[] = [];
    for (const mBar of monthlySeries) {
      const found = mBar.byCategory.find((x) => x.categoryId === c.id);
      if (found && found.amountMinor > 0) {
        activeTotals.push(found.amountMinor);
      }
    }
    const avg =
      activeTotals.length > 0 ? Math.round(activeTotals.reduce((a, b) => a + b, 0) / activeTotals.length) : 0;
    catHistoricalAvg.set(c.id, avg);
  }

  // Build detailed MonthlySnapshots for each of the last 6 months (newest-first: Current Month, Sep 2026, Aug 2026, ...)
  const monthlySnapshots: MonthlySnapshot[] = [];

  for (let i = 0; i <= 5; i++) {
    let y = nowParts.year;
    let m = nowParts.month - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const mStart = zonedDate(y, m, 1, 0, 0, zone);
    const mPeriod = monthPeriod(mStart, zone);
    const mPrevPeriod = previousMonthPeriod(mStart, zone);
    const mKey = formatInZone(mPeriod.start, "yyyy-MM", zone);
    const mLabel = formatInZone(mPeriod.start, "MMMM yyyy", zone);
    const mShortLabel = formatInZone(mPeriod.start, "MMM yyyy", zone);
    const isCurrentMonth = i === 0;
    const mDaysInMonth = daysInMonth(mStart, zone);
    const mDaysElapsed = isCurrentMonth ? elapsed : mDaysInMonth;

    const mHorizon = buildHorizon("month", mLabel, mShortLabel, mPeriod.start, mPeriod.end, mKey);

    // Compute comparison against preceding month (same days for current month, full preceding month for past months)
    const compEnd = isCurrentMonth
      ? new Date(Math.min(mPrevPeriod.start.getTime() + mDaysElapsed * 86_400_000, mPrevPeriod.end.getTime()))
      : mPrevPeriod.end;
    let prevComparisonMinor = 0;
    const mPrevByCat = new Map<string | null, number>();
    for (const tx of allConfirmedTxs) {
      if (tx.occurredAt >= mPrevPeriod.start && tx.occurredAt < mPrevPeriod.end) {
        const signed = tx.type === "refund" ? -tx.amountMinor : tx.amountMinor;
        mPrevByCat.set(tx.categoryId, (mPrevByCat.get(tx.categoryId) ?? 0) + signed);
        if (tx.occurredAt < compEnd) {
          prevComparisonMinor += signed;
        }
      }
    }
    prevComparisonMinor = Math.max(0, prevComparisonMinor);

    // Daily spend arrays for this month
    const mOverallDaily = new Array<number>(mDaysInMonth + 1).fill(0);
    const mCatDaily = new Map<string, number[]>();
    const mCatLatestTx = new Map<string, Date>();
    for (const c of spendCategories) {
      mCatDaily.set(c.id, new Array<number>(mDaysInMonth + 1).fill(0));
    }

    for (const tx of allConfirmedTxs) {
      if (tx.occurredAt < mPeriod.start || tx.occurredAt >= mPeriod.end) continue;
      const tp = zonedParts(tx.occurredAt, zone);
      const dayNum = Math.min(mDaysInMonth, Math.max(1, tp.day));
      const signed = tx.type === "refund" ? -tx.amountMinor : tx.amountMinor;
      mOverallDaily[dayNum] += signed;

      if (tx.categoryId && mCatDaily.has(tx.categoryId)) {
        mCatDaily.get(tx.categoryId)![dayNum] += signed;
        const prevLatest = mCatLatestTx.get(tx.categoryId);
        if (!prevLatest || tx.occurredAt > prevLatest) {
          mCatLatestTx.set(tx.categoryId, tx.occurredAt);
        }
      }
    }

    // Build per-category threshold & pacing for this month
    const mCategoryPacing: CategoryPacingFlag[] = spendCategories
      .map((c) => {
        const resolved = resolvedThresholds.get(`${c.id}::${mKey}`);
        const limitMinor = resolved?.limitMinor ?? c.monthlyAlertMinor ?? settings.alertThresholdMinor;
        const thresholdComment = resolved?.comment ?? "threshold testing and adjustment";
        const thresholdUpdatedAt = resolved?.updatedAt ?? null;
        const hasCustomLimit = c.monthlyAlertMinor !== null || budgetMap.has(`${c.id}::${mKey}`);
        const dailyArr = mCatDaily.get(c.id) ?? new Array<number>(mDaysInMonth + 1).fill(0);

        let running = 0;
        const dailyCumulative: DailyPacePoint[] = [];
        for (let d = 1; d <= mDaysElapsed; d++) {
          running += dailyArr[d];
          const dateObj = zonedDate(y, m, d, 12, 0, zone);
          dailyCumulative.push({
            day: d,
            dateLabel: formatInZone(dateObj, "d MMM", zone),
            cumulativeMinor: Math.max(0, running),
            proRataMinor: Math.round((limitMinor * d) / mDaysInMonth),
          });
        }

        const spentMinor = Math.max(0, running);
        const pctOfLimit = limitMinor > 0 ? Math.round((spentMinor / limitMinor) * 1000) / 10 : 0;
        const varianceMinor = limitMinor - spentMinor;
        const latestTx = mCatLatestTx.get(c.id) ?? null;
        const latestTxDay = latestTx ? zonedParts(latestTx, zone).day : mDaysElapsed;
        const latestTxDateLabel = latestTx ? formatInZone(latestTx, "d MMM", zone) : null;
        const proRataAtTxMinor = Math.round((limitMinor * latestTxDay) / mDaysInMonth);

        const lastMonthMinor = Math.max(0, mPrevByCat.get(c.id) ?? 0);
        const avgMonthlyMinor = catHistoricalAvg.get(c.id) || spentMinor;
        const basisMinor = lastMonthMinor > 0 ? Math.round((lastMonthMinor + avgMonthlyMinor) / 2) : avgMonthlyMinor;
        const suggestedThresholdMinor = roundSuggestedMinor(basisMinor);

        let status: "over_limit" | "pacing_flag" | "on_track" = "on_track";
        let flagMessage: string | null = null;

        if (spentMinor > limitMinor) {
          status = "over_limit";
          flagMessage = isCurrentMonth
            ? `Exceeded monthly threshold (${pctOfLimit}% of limit) as of ${latestTxDateLabel ?? "today"}.`
            : `Ended ${mShortLabel} at ${pctOfLimit}% of threshold (exceeded by $${Math.round((spentMinor - limitMinor) / 100).toLocaleString("en-HK")}).`;
        } else if (
          isCurrentMonth &&
          spentMinor > 0 &&
          (spentMinor >= limitMinor * 0.5 || spentMinor > proRataAtTxMinor)
        ) {
          status = "pacing_flag";
          flagMessage = `${pctOfLimit}% of monthly threshold spent by ${latestTxDateLabel ?? `Day ${latestTxDay}`} (ahead of day-${latestTxDay} pace).`;
        } else if (!isCurrentMonth && spentMinor >= limitMinor * 0.85) {
          status = "pacing_flag";
          flagMessage = `Used ${pctOfLimit}% of ${mShortLabel} threshold ($${Math.round(varianceMinor / 100).toLocaleString("en-HK")} remaining).`;
        }

        return {
          categoryId: c.id,
          name: c.name,
          color: c.color,
          spentMinor,
          limitMinor,
          hasCustomLimit,
          pctOfLimit,
          varianceMinor,
          latestTxDateLabel,
          latestTxDay,
          proRataAtTxMinor,
          status,
          flagMessage,
          lastMonthMinor,
          avgMonthlyMinor,
          suggestedThresholdMinor,
          thresholdComment,
          thresholdUpdatedAt,
          dailyCumulative,
        };
      })
      .sort((a, b) => b.spentMinor - a.spentMinor);

    const mOverallLimitMinor =
      mCategoryPacing.reduce((acc, c) => acc + c.limitMinor, 0) || settings.alertThresholdMinor;
    let overallRunning = 0;
    const mOverallDailyCumulative: DailyPacePoint[] = [];
    for (let d = 1; d <= mDaysElapsed; d++) {
      overallRunning += mOverallDaily[d];
      const dateObj = zonedDate(y, m, d, 12, 0, zone);
      mOverallDailyCumulative.push({
        day: d,
        dateLabel: formatInZone(dateObj, "d MMM", zone),
        cumulativeMinor: Math.max(0, overallRunning),
        proRataMinor: Math.round((mOverallLimitMinor * d) / mDaysInMonth),
      });
    }

    // Identify "Spending Surge vs. Past Avg" (better name for "unusually high category from past data")
    let surgeCategory: SpendingSurgeCategory | null = null;
    for (const cp of mCategoryPacing) {
      if (cp.spentMinor <= 0) continue;
      // Compute baseline from other months in the 6-month window
      const otherMonthsTotals: number[] = [];
      for (const bar of monthlySeries) {
        if (bar.key === mKey) continue;
        const found = bar.byCategory.find((x) => x.categoryId === cp.categoryId);
        if (found && found.amountMinor > 0) {
          otherMonthsTotals.push(found.amountMinor);
        }
      }
      const baselineFullMonth =
        otherMonthsTotals.length > 0
          ? Math.round(otherMonthsTotals.reduce((a, b) => a + b, 0) / otherMonthsTotals.length)
          : cp.lastMonthMinor || cp.avgMonthlyMinor;

      // For current month, compare against pro-rated historical baseline for the elapsed days (or full month if already higher)
      const baselineForComparison = isCurrentMonth
        ? Math.max(1, Math.round((baselineFullMonth * Math.max(7, mDaysElapsed)) / mDaysInMonth))
        : baselineFullMonth;

      if (baselineForComparison <= 0) continue;
      const deltaMinor = cp.spentMinor - baselineForComparison;
      const surgePct = Math.round((deltaMinor / baselineForComparison) * 100);

      if (
        deltaMinor > 0 &&
        (!surgeCategory || surgePct > surgeCategory.surgePct || deltaMinor > surgeCategory.deltaMinor)
      ) {
        surgeCategory = {
          categoryId: cp.categoryId,
          name: cp.name,
          color: cp.color,
          spentMinor: cp.spentMinor,
          historicalAvgMinor: baselineFullMonth,
          deltaMinor,
          surgePct,
          summaryText: isCurrentMonth
            ? `+${surgePct}% vs usual pace ($${Math.round(baselineFullMonth / 100).toLocaleString("en-HK")}/mo avg)`
            : `+${surgePct}% above usual $${Math.round(baselineFullMonth / 100).toLocaleString("en-HK")}/mo avg`,
        };
      }
    }

    monthlySnapshots.push({
      monthKey: mKey,
      label: mLabel,
      shortLabel: mShortLabel,
      isCurrentMonth,
      daysElapsed: mDaysElapsed,
      daysInMonth: mDaysInMonth,
      totalMinor: mHorizon.totalMinor,
      prevComparisonMinor,
      transactionCount: mHorizon.transactionCount,
      avgPerDayMinor: Math.round(mHorizon.totalMinor / Math.max(1, mDaysElapsed)),
      overallLimitMinor: mOverallLimitMinor,
      topCategory: mHorizon.topCategory,
      topSubcategory: mHorizon.topSubcategory,
      surgeCategory,
      byCategory: mHorizon.byCategory,
      bySubcategory: mHorizon.bySubcategory,
      categoryPacing: mCategoryPacing,
      overallDailyCumulative: mOverallDailyCumulative,
    });
  }

  const currentSnapshot = monthlySnapshots[0];
  const categoryPacing = currentSnapshot.categoryPacing;
  const overallDailyCumulative = currentSnapshot.overallDailyCumulative;
  const overallLimitMinor = currentSnapshot.overallLimitMinor;

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
  const daysRemainingInMonth = Math.max(0, totalDaysInMonth - elapsed);
  const isEndOfMonthReminderDue = daysRemainingInMonth <= 5 || elapsed <= 3;

  return {
    month,
    currentMonthKey,
    elapsed,
    daysInMonth: totalDaysInMonth,
    daysRemainingInMonth,
    isEndOfMonthReminderDue,
    totalMinor,
    prevSameDaysMinor,
    transactionCount,
    avgPerDayMinor: Math.round(totalMinor / Math.max(1, elapsed)),
    topCategory: byCategory[0] ?? null,
    surgeCategory: currentSnapshot.surgeCategory,
    byCategory,
    alerts: byCategory.map((c) => c.alert).filter((a): a is CategoryAlert => a !== null),
    horizons,
    weeklySeries,
    monthlySeries,
    monthlySnapshots,
    thresholdLogs,
    categoryPacing,
    overallDailyCumulative,
    overallLimitMinor,
    spendCategories: spendCategories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    pending,
    pendingTotalMinor,
    recent,
    lastImportAt,
    daysSinceImport,
    tier: predictionTier(first?.occurredAt ?? null, now),
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;
