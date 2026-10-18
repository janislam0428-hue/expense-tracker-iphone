"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BellRing,
  CalendarClock,
  Check,
  Filter,
  Flame,
  History,
  Layers,
  MessageSquareText,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dot, Tag } from "@/components/app/tag";
import { StatCard } from "@/components/app/stat-card";
import { percentChange } from "@/lib/money";
import { updateCategoryThresholdQuick } from "@/app/(app)/settings/actions";
import type {
  HorizonSummary,
  MonthlySnapshot,
  PeriodKey,
  ThresholdLogEntry,
  TimeSeriesBar,
} from "@/lib/queries/overview";

function fmtMoney(minor: number, currency: string, decimals = false): string {
  const val = minor / 100;
  const prefix = currency === "HKD" || currency === "USD" ? "$" : `${currency} `;
  return `${prefix}${val.toLocaleString("en-HK", {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  })}`;
}

function changeLabel(cur: number, prev: number, isCurrentMonth: boolean, daysElapsed: number) {
  const pct = percentChange(cur, prev);
  if (pct === null) {
    return {
      text: "No prior month spend",
      tone: "muted" as const,
      hint: isCurrentMonth ? `First ${daysElapsed} days of prior month` : "Full prior month",
    };
  }
  const rounded = Math.round(pct);
  if (rounded === 0) {
    return {
      text: "Same as prior month",
      tone: "muted" as const,
      hint: isCurrentMonth ? `Same ${daysElapsed} days last month` : "Compared to full prior month",
    };
  }
  return {
    text: `${rounded > 0 ? "+" : ""}${rounded}%`,
    tone: rounded > 0 ? ("up" as const) : ("down" as const),
    hint: isCurrentMonth ? `in the same ${daysElapsed} days` : "vs full prior month",
  };
}

export function DashboardExplorer({
  currency,
  monthName,
  currentMonthKey,
  elapsed,
  daysInMonth,
  daysRemainingInMonth,
  isEndOfMonthReminderDue,
  horizons,
  weeklySeries,
  monthlySeries,
  monthlySnapshots,
  thresholdLogs,
  spendCategories,
  pendingCount,
  pendingTotalMinor,
  daysSinceImport,
  lastImportFormatted,
  importOverdue,
}: {
  currency: string;
  zone?: string;
  monthName: string;
  currentMonthKey: string;
  elapsed: number;
  daysInMonth: number;
  daysRemainingInMonth: number;
  isEndOfMonthReminderDue: boolean;
  horizons: Record<PeriodKey, HorizonSummary>;
  weeklySeries: TimeSeriesBar[];
  monthlySeries: TimeSeriesBar[];
  monthlySnapshots: MonthlySnapshot[];
  thresholdLogs: ThresholdLogEntry[];
  spendCategories: Array<{ id: string; name: string; color: string }>;
  pendingCount: number;
  pendingTotalMinor: number;
  daysSinceImport: number | null;
  lastImportFormatted: string | null;
  importOverdue: boolean;
}) {
  // 1. Selected Month Slicer state (defaults to current month, can switch to any past month e.g. Sept 2026)
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(
    monthlySnapshots[0]?.monthKey ?? currentMonthKey,
  );
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [quickComment, setQuickComment] = useState("");
  const [customLimits, setCustomLimits] = useState<Record<string, string>>({});

  // 2. Horizon & Category Breakdown state
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [viewMode, setViewMode] = useState<"both" | "category" | "subcategory">("both");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // 3. WoW / MoM Trend Chart & Category Slicer state
  const [trendMode, setTrendMode] = useState<"mom" | "wow">("mom");
  const [trendCategoryId, setTrendCategoryId] = useState<string>("all");

  // 4. Recorded Date vs Monthly Threshold category filter
  const [paceCategoryId, setPaceCategoryId] = useState<string>("all");
  const [pending, startTransition] = useTransition();

  const activeMonthSnapshot =
    monthlySnapshots.find((m) => m.monthKey === selectedMonthKey) ?? monthlySnapshots[0];
  const currentMonthSnapshot = monthlySnapshots[0];

  const monthChange = changeLabel(
    activeMonthSnapshot.totalMinor,
    activeMonthSnapshot.prevComparisonMinor,
    activeMonthSnapshot.isCurrentMonth,
    activeMonthSnapshot.daysElapsed,
  );

  const flaggedInSelectedMonth = activeMonthSnapshot.categoryPacing.filter((c) => c.status !== "on_track");
  const currentFlaggedCount = currentMonthSnapshot.categoryPacing.filter((c) => c.status !== "on_track").length;

  // Compute Horizon Breakdown (if period === "month", use the selectedMonthKey snapshot so the user can inspect any month!)
  const activeHorizon: HorizonSummary =
    period === "month"
      ? {
          key: "month",
          label: activeMonthSnapshot.isCurrentMonth ? "This Month (To Date)" : activeMonthSnapshot.label,
          sublabel: activeMonthSnapshot.shortLabel,
          totalMinor: activeMonthSnapshot.totalMinor,
          transactionCount: activeMonthSnapshot.transactionCount,
          topCategory: activeMonthSnapshot.topCategory,
          topSubcategory: activeMonthSnapshot.topSubcategory,
          byCategory: activeMonthSnapshot.byCategory,
          bySubcategory: activeMonthSnapshot.bySubcategory,
        }
      : horizons[period];

  const maxCatMinor = activeHorizon.byCategory[0]?.netMinor ?? 1;
  const filteredSubcategories = selectedCategoryId
    ? activeHorizon.bySubcategory.filter((s) => s.parentId === selectedCategoryId)
    : activeHorizon.bySubcategory;
  const maxSubMinor = filteredSubcategories[0]?.netMinor ?? 1;

  // Compute WoW / MoM Series filtered by `trendCategoryId` ("all" or a specific category ID)
  const rawTrendSeries = trendMode === "wow" ? weeklySeries : monthlySeries;
  const activeTrendSeries = rawTrendSeries.map((bar, idx, arr) => {
    if (trendCategoryId === "all") {
      return bar;
    }
    const catSeg = bar.byCategory.find((c) => c.categoryId === trendCategoryId);
    const catMinor = catSeg?.amountMinor ?? 0;
    const prevBar = idx > 0 ? arr[idx - 1] : null;
    const prevCatMinor = prevBar
      ? (prevBar.byCategory.find((c) => c.categoryId === trendCategoryId)?.amountMinor ?? 0)
      : 0;
    const changePct =
      prevBar && prevCatMinor > 0 ? Math.round(((catMinor - prevCatMinor) / prevCatMinor) * 100) : null;

    return {
      ...bar,
      totalMinor: catMinor,
      changePct,
      byCategory: catSeg ? [catSeg] : [],
    };
  });
  const maxSeriesMinor = Math.max(1, ...activeTrendSeries.map((b) => b.totalMinor));
  const selectedTrendCatObj =
    trendCategoryId === "all" ? null : spendCategories.find((c) => c.id === trendCategoryId) ?? null;

  // Recorded Date vs Monthly Threshold data for `activeMonthSnapshot` and `paceCategoryId`
  const selectedPaceCat =
    paceCategoryId === "all"
      ? null
      : activeMonthSnapshot.categoryPacing.find((c) => c.categoryId === paceCategoryId) ?? null;
  const pacePoints = selectedPaceCat
    ? selectedPaceCat.dailyCumulative
    : activeMonthSnapshot.overallDailyCumulative;
  const paceLimitMinor = selectedPaceCat
    ? selectedPaceCat.limitMinor
    : activeMonthSnapshot.overallLimitMinor;
  const paceSpentMinor = selectedPaceCat
    ? selectedPaceCat.spentMinor
    : activeMonthSnapshot.totalMinor;
  const paceVarianceMinor = paceLimitMinor - paceSpentMinor;

  const handleApplySuggestion = (catId: string, suggestedMinor: number) => {
    const customNote = quickComment.trim();
    startTransition(async () => {
      const res = await updateCategoryThresholdQuick(catId, suggestedMinor, {
        comment: customNote || "according to suggestion",
        source: "suggestion",
        monthKey: currentMonthKey,
      });
      if (res.ok) {
        toast.success(res.ok);
        setQuickComment("");
      } else {
        toast.error(res.error || "Could not update threshold");
      }
    });
  };

  const handleApplyCustomThreshold = (catId: string) => {
    const rawVal = customLimits[catId]?.trim();
    if (!rawVal || !/^\d{1,7}(\.\d{1,2})?$/.test(rawVal)) {
      toast.error("Enter a valid dollar amount, e.g. 1000 or 2000");
      return;
    }
    const amountMinor = Math.round(parseFloat(rawVal) * 100);
    const customNote = quickComment.trim();
    startTransition(async () => {
      const res = await updateCategoryThresholdQuick(catId, amountMinor, {
        comment: customNote || "threshold testing and adjustment",
        source: "manual",
        monthKey: currentMonthKey,
      });
      if (res.ok) {
        toast.success(res.ok);
        setQuickComment("");
      } else {
        toast.error(res.error || "Could not update threshold");
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* 0. End-of-Month Threshold Review & Adjustment Pop-Up Banner at the Very Top */}
      {!reminderDismissed && (
        <section
          aria-label="End-of-month threshold reminder"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 ${
            isEndOfMonthReminderDue || currentFlaggedCount > 0
              ? "border-warning/60 bg-warning/10"
              : "border-border bg-card"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-warning/20 p-2 text-warning">
              <CalendarClock className="size-4" />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-semibold text-foreground">
                  {isEndOfMonthReminderDue
                    ? `End-of-Month Threshold Reminder: ${daysRemainingInMonth === 0 ? "Last day" : `${daysRemainingInMonth} day${daysRemainingInMonth === 1 ? "" : "s"} left`} of ${monthName}`
                    : `Monthly Threshold Tracker & End-of-Month Reminder (${monthName})`}
                </span>
                <Tag color={isEndOfMonthReminderDue || currentFlaggedCount > 0 ? "orange" : "blue"}>
                  {isEndOfMonthReminderDue
                    ? "Action Due: Review Month-End Thresholds"
                    : `${daysRemainingInMonth} days until month-end lock`}
                </Tag>
              </div>
              <p className="text-[12.5px] text-muted-foreground">
                {isEndOfMonthReminderDue
                  ? `Review how much you used in ${monthName} vs. your thresholds below. Any threshold still active on Day ${daysInMonth} (${fmtMoney(currentMonthSnapshot.overallLimitMinor, currency)} total across categories) is saved as your final ${monthName} threshold.`
                  : `We are currently testing & adjusting thresholds (${currentFlaggedCount} categor${currentFlaggedCount === 1 ? "y" : "ies"} flagged so far). Whatever threshold is last set in ${monthName} as of ${daysInMonth} ${monthName.slice(0, 3)} will be locked as ${monthName}'s final record, and a month-end reminder will pop up to adjust for next month.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-[12px]">
              <Link href="/settings#flags">
                <SlidersHorizontal className="size-3.5" />
                Adjust in Settings
              </Link>
            </Button>
            <button
              type="button"
              onClick={() => setReminderDismissed(true)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Dismiss reminder for now"
            >
              <X className="size-4" />
            </button>
          </div>
        </section>
      )}

      {/* 1. Top Monthly Slicer (To Date & Past Months) + Key Summary Cards */}
      <section aria-labelledby="monthly-slicer-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <h2 id="monthly-slicer-heading" className="text-[15px] font-medium">
              Monthly Overview Slicer (To Date &amp; Past Months)
            </h2>
          </div>

          {/* Month Slicer Pills: Current Month (To Date) + Past 5 Months */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-1">
            {monthlySnapshots.map((m) => {
              const active = m.monthKey === activeMonthSnapshot.monthKey;
              return (
                <button
                  key={m.monthKey}
                  type="button"
                  onClick={() => {
                    setSelectedMonthKey(m.monthKey);
                    setPeriod("month");
                  }}
                  className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                    active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.isCurrentMonth ? `${m.shortLabel} (To date)` : m.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Top Summary Cards for Selected Month: Total Spending, Highest Category, Spending Surge vs Past Avg, plus existing cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={
              activeMonthSnapshot.isCurrentMonth
                ? `Monthly total (${activeMonthSnapshot.shortLabel} to date)`
                : `Monthly total (${activeMonthSnapshot.shortLabel} final)`
            }
            value={fmtMoney(activeMonthSnapshot.totalMinor, currency)}
            hint={`${activeMonthSnapshot.transactionCount} confirmed tx · ${
              activeMonthSnapshot.overallLimitMinor > 0
                ? `${Math.round((activeMonthSnapshot.totalMinor / activeMonthSnapshot.overallLimitMinor) * 100)}% of ${fmtMoney(activeMonthSnapshot.overallLimitMinor, currency)} threshold`
                : ""
            }`}
          />

          <StatCard
            label="Highest spending category"
            value={
              activeMonthSnapshot.topCategory ? (
                <span className="flex items-center gap-2 text-[17px]">
                  <Dot color={activeMonthSnapshot.topCategory.color} />
                  <span className="truncate">{activeMonthSnapshot.topCategory.name}</span>
                </span>
              ) : (
                <span className="text-[17px] text-muted-foreground">None yet</span>
              )
            }
            hint={
              activeMonthSnapshot.topCategory
                ? `${fmtMoney(activeMonthSnapshot.topCategory.netMinor, currency)} (${activeMonthSnapshot.topCategory.sharePct}% of ${activeMonthSnapshot.shortLabel})`
                : `No confirmed spend in ${activeMonthSnapshot.shortLabel}`
            }
          />

          <StatCard
            label="Spending surge vs. usual"
            value={
              activeMonthSnapshot.surgeCategory ? (
                <span className="flex items-center gap-2 text-[17px] text-[var(--dot-red)]">
                  <Flame className="size-4 shrink-0" />
                  <span className="truncate">{activeMonthSnapshot.surgeCategory.name}</span>
                </span>
              ) : (
                <span className="text-[16px] text-muted-foreground">Within usual pace</span>
              )
            }
            hint={
              activeMonthSnapshot.surgeCategory
                ? `${fmtMoney(activeMonthSnapshot.surgeCategory.spentMinor, currency)} · ${activeMonthSnapshot.surgeCategory.summaryText}`
                : "No category above historical monthly average"
            }
            tone={activeMonthSnapshot.surgeCategory ? "attention" : "default"}
          />

          <StatCard
            label={activeMonthSnapshot.isCurrentMonth ? "vs last month (same days)" : "vs prior month"}
            value={
              <span
                className={
                  monthChange.tone === "up"
                    ? "text-[var(--dot-red)]"
                    : monthChange.tone === "down"
                      ? "text-success"
                      : "text-muted-foreground text-[15px]"
                }
              >
                {monthChange.text}
              </span>
            }
            hint={`${fmtMoney(activeMonthSnapshot.prevComparisonMinor, currency)} ${monthChange.hint}`}
          />
        </div>

        {/* Keep the other summary cards: Average per day, To confirm, Last import */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label={`Average per day (${activeMonthSnapshot.shortLabel})`}
            value={fmtMoney(activeMonthSnapshot.avgPerDayMinor, currency)}
            hint={`Across ${activeMonthSnapshot.daysElapsed} day${activeMonthSnapshot.daysElapsed === 1 ? "" : "s"} in ${activeMonthSnapshot.shortLabel}`}
          />
          <StatCard
            label="To confirm"
            value={pendingCount}
            hint={
              pendingCount > 0
                ? `~${fmtMoney(pendingTotalMinor, currency)} awaiting confirmation`
                : "All clear"
            }
            href="/review"
            tone={pendingCount > 0 ? "attention" : "default"}
          />
          <StatCard
            label="Last import"
            value={
              <span className="text-[17px]">
                {daysSinceImport === null
                  ? "Never"
                  : daysSinceImport === 0
                    ? "Today"
                    : `${daysSinceImport} days ago`}
              </span>
            }
            hint={importOverdue ? "Time to import" : lastImportFormatted ?? undefined}
            href="/import"
            tone={importOverdue ? "attention" : "default"}
          />
        </div>
      </section>

      {/* 2. Threshold Flags & Smart Suggestions Put to the Front */}
      <section
        aria-labelledby="threshold-reminders-front"
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]"
      >
        {/* Left: Active Threshold & Pacing Flags for Selected Month */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <BellRing className="size-4 text-[var(--dot-red)]" />
              <h3 id="threshold-reminders-front" className="text-[14.5px] font-medium">
                Threshold Flags ({activeMonthSnapshot.label})
              </h3>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {activeMonthSnapshot.isCurrentMonth
                ? `Day ${activeMonthSnapshot.daysElapsed} of ${activeMonthSnapshot.daysInMonth}`
                : `Final (${activeMonthSnapshot.daysInMonth} days)`}
            </span>
          </div>

          {flaggedInSelectedMonth.length === 0 ? (
            <p className="py-6 text-[13.5px] text-muted-foreground">
              {activeMonthSnapshot.isCurrentMonth
                ? "All categories are currently under 50% of their monthly threshold and within expected daily pace."
                : `No categories exceeded or neared their monthly threshold in ${activeMonthSnapshot.label}.`}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {flaggedInSelectedMonth.map((fc) => (
                <li
                  key={fc.categoryId}
                  className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPaceCategoryId(fc.categoryId);
                        setTrendCategoryId(fc.categoryId);
                      }}
                      className="flex items-center gap-2 text-[14px] font-medium text-foreground hover:underline text-left"
                      title="Click to filter charts below to this category"
                    >
                      <Dot color={fc.color} />
                      <span>{fc.name}</span>
                      <Tag color={fc.status === "over_limit" ? "red" : "orange"}>
                        {fc.status === "over_limit" ? "Over Threshold" : `${fc.pctOfLimit}% Used`}
                      </Tag>
                    </button>
                    <span className="tabular text-[13.5px] font-semibold">
                      {fmtMoney(fc.spentMinor, currency)} / {fmtMoney(fc.limitMinor, currency)}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-muted-foreground flex items-center gap-1.5">
                    <AlertTriangle className="size-3.5 shrink-0 text-[var(--dot-red)]" />
                    <span>{fc.flagMessage}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Threshold note: <span className="italic">&ldquo;{fc.thresholdComment}&rdquo;</span>
                    {fc.thresholdUpdatedAt ? ` · Set ${fc.thresholdUpdatedAt}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: Quick Threshold Adjustments, Suggestions & Comment Documentation */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-warning" />
              <h3 className="text-[14.5px] font-medium">
                Threshold Suggestions &amp; Adjustment Log ({monthName})
              </h3>
            </div>
            <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-[12px]">
              <Link href="/settings#flags">
                <SlidersHorizontal className="size-3.5" />
                Open Settings
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>

          {/* Optional comment bar for quick threshold changes */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/20 p-2.5">
            <MessageSquareText className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={quickComment}
              onChange={(e) => setQuickComment(e.target.value)}
              placeholder='Optional comment for change (Suggest writes "according to suggestion"; blank defaults to "threshold testing and adjustment")'
              className="h-8 flex-1 min-w-[220px] bg-background text-[12px]"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium text-right">{activeMonthSnapshot.shortLabel} Used</th>
                  <th className="pb-2 font-medium text-right">{activeMonthSnapshot.shortLabel} Limit</th>
                  <th className="pb-2 font-medium text-right">Suggested</th>
                  <th className="pb-2 font-medium text-right">Adjust ({currentMonthSnapshot.shortLabel})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {activeMonthSnapshot.categoryPacing.slice(0, 9).map((c) => {
                  const isMatched = c.hasCustomLimit && c.limitMinor === c.suggestedThresholdMinor;
                  return (
                    <tr key={c.categoryId}>
                      <td className="py-2 pr-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPaceCategoryId(c.categoryId);
                            setTrendCategoryId(c.categoryId);
                          }}
                          className="flex items-center gap-2 font-medium text-foreground hover:underline text-left"
                        >
                          <Dot color={c.color} />
                          <span className="truncate">{c.name}</span>
                        </button>
                      </td>
                      <td className="py-2 px-2 text-right tabular text-muted-foreground">
                        {fmtMoney(c.spentMinor, currency)}
                      </td>
                      <td className="py-2 px-2 text-right tabular">
                        <span className="font-medium text-foreground">{fmtMoney(c.limitMinor, currency)}</span>
                      </td>
                      <td className="py-2 px-2 text-right tabular font-semibold text-foreground">
                        {fmtMoney(c.suggestedThresholdMinor, currency)}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Input
                            inputMode="decimal"
                            value={customLimits[c.categoryId] ?? ""}
                            onChange={(e) =>
                              setCustomLimits((prev) => ({ ...prev, [c.categoryId]: e.target.value }))
                            }
                            placeholder={String(Math.round(c.limitMinor / 100))}
                            className="h-7 w-16 px-1.5 text-right text-[11.5px] tabular"
                          />
                          {customLimits[c.categoryId]?.trim() ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => handleApplyCustomThreshold(c.categoryId)}
                              className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                            >
                              Save
                            </button>
                          ) : isMatched ? (
                            <span className="inline-flex items-center gap-1 text-[11.5px] text-success">
                              <Check className="size-3" /> Set
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => handleApplySuggestion(c.categoryId, c.suggestedThresholdMinor)}
                              className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent transition-colors"
                              title='Applies suggested threshold and logs comment "according to suggestion"'
                            >
                              Suggest {fmtMoney(c.suggestedThresholdMinor, currency)}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 3. Visualizations & Charts: MoM / WoW by Clicked Category + Recorded Date vs. Monthly Threshold (Current & Past Months) */}
      <section aria-labelledby="charts-heading" className="grid gap-6 lg:grid-cols-2">
        {/* Chart A: Month-over-Month & Week-over-Week Category Trends with Clickable Category Slicer */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3 border-b border-border pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-muted-foreground" />
                <h3 id="charts-heading" className="text-[14.5px] font-medium">
                  {trendMode === "mom" ? "Month over Month" : "Week over Week"} Trends{" "}
                  {selectedTrendCatObj ? `· ${selectedTrendCatObj.name}` : "· All Categories"}
                </h3>
              </div>

              <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5 text-[12px]">
                <button
                  type="button"
                  onClick={() => setTrendMode("mom")}
                  className={`rounded px-2.5 py-1 font-medium ${
                    trendMode === "mom" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                  }`}
                >
                  Month over Month
                </button>
                <button
                  type="button"
                  onClick={() => setTrendMode("wow")}
                  className={`rounded px-2.5 py-1 font-medium ${
                    trendMode === "wow" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                  }`}
                >
                  Week over Week
                </button>
              </div>
            </div>

            {/* Clickable Category Pills: All Categories + Each Individual Category */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTrendCategoryId("all")}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                  trendCategoryId === "all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                All Categories
              </button>
              {spendCategories.map((cat) => {
                const isSelected = trendCategoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() =>
                      setTrendCategoryId((prev) => (prev === cat.id ? "all" : cat.id))
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      isSelected
                        ? "border-primary bg-accent text-foreground ring-1 ring-primary/40"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Dot color={cat.color} />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bar Chart for All Categories OR Selected Category */}
          <div className="grid grid-cols-6 items-end gap-2.5 pt-4 h-52">
            {activeTrendSeries.map((bar) => {
              const heightPct = maxSeriesMinor > 0 ? Math.max(4, (bar.totalMinor / maxSeriesMinor) * 100) : 4;
              return (
                <div key={bar.key} className="flex h-full flex-col items-center justify-end gap-1.5">
                  <div className="flex flex-col items-center text-center">
                    <span className="tabular text-[11.5px] font-medium text-foreground">
                      {bar.totalMinor > 0 ? fmtMoney(bar.totalMinor, currency) : "$0"}
                    </span>
                    {bar.changePct !== null && (
                      <span
                        className={`text-[10px] font-medium ${
                          bar.changePct > 0
                            ? "text-[var(--dot-red)]"
                            : bar.changePct < 0
                              ? "text-success"
                              : "text-muted-foreground"
                        }`}
                      >
                        {bar.changePct > 0 ? `+${bar.changePct}%` : `${bar.changePct}%`}
                      </span>
                    )}
                  </div>

                  <div
                    className="flex w-full max-w-[44px] flex-col overflow-hidden rounded-t-md bg-muted/50 transition-all"
                    style={{ height: `${heightPct}%` }}
                    title={
                      bar.byCategory.length > 0
                        ? bar.byCategory.map((c) => `${c.name}: ${fmtMoney(c.amountMinor, currency)}`).join("\n")
                        : "No spend"
                    }
                  >
                    {bar.byCategory.map((seg, i) => {
                      const segPct = bar.totalMinor > 0 ? (seg.amountMinor / bar.totalMinor) * 100 : 0;
                      return (
                        <div
                          key={`${seg.categoryId ?? "none"}-${i}`}
                          style={{
                            height: `${segPct}%`,
                            background: `var(--dot-${seg.color})`,
                          }}
                        />
                      );
                    })}
                  </div>

                  <span className="text-[11.5px] text-muted-foreground truncate">{bar.label}</span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-[11.5px] text-muted-foreground">
            <span>
              {selectedTrendCatObj
                ? `Showing ${trendMode === "mom" ? "Month-over-Month" : "Week-over-Week"} for ${selectedTrendCatObj.name} only (click pill again for All Categories)`
                : "Tap any category pill above to isolate its Week-over-Week & Month-over-Month trend"}
            </span>
          </div>
        </div>

        {/* Chart B: Recorded Date vs. Monthly Threshold (Supports Current Month & Past Months + Historical Thresholds) */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-2.5 border-b border-border pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-muted-foreground" />
                <h3 className="text-[14.5px] font-medium">
                  Recorded Date vs. Monthly Threshold ({activeMonthSnapshot.label})
                </h3>
              </div>

              {/* Month Selector synced with Top Slicer */}
              <select
                value={activeMonthSnapshot.monthKey}
                onChange={(e) => setSelectedMonthKey(e.target.value)}
                aria-label="Select month for threshold comparison"
                className="h-8 rounded-md border border-input bg-background px-2.5 text-[12px] font-medium"
              >
                {monthlySnapshots.map((m) => (
                  <option key={m.monthKey} value={m.monthKey}>
                    {m.isCurrentMonth ? `${m.label} (To date)` : `${m.label} (Final)`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-muted-foreground">
                Filter category threshold:
              </span>
              <select
                value={paceCategoryId}
                onChange={(e) => setPaceCategoryId(e.target.value)}
                aria-label="Select category for threshold comparison"
                className="h-8 rounded-md border border-input bg-background px-2.5 text-[12px]"
              >
                <option value="all">
                  All Categories Combined (Threshold: {fmtMoney(activeMonthSnapshot.overallLimitMinor, currency)})
                </option>
                {activeMonthSnapshot.categoryPacing.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.name} (Used: {fmtMoney(c.spentMinor, currency)} / Threshold: {fmtMoney(c.limitMinor, currency)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(() => {
            const chartMax = Math.max(paceLimitMinor * 1.1, paceSpentMinor * 1.1, 100);
            const width = 460;
            const height = 155;
            const padX = 8;
            const padY = 14;
            const usableW = width - padX * 2;
            const usableH = height - padY * 2;
            const mDays = activeMonthSnapshot.daysInMonth;
            const mElapsed = activeMonthSnapshot.daysElapsed;

            const toX = (day: number) => padX + ((day - 1) / Math.max(1, mDays - 1)) * usableW;
            const toY = (minor: number) =>
              padY + usableH - Math.min(usableH, Math.max(0, (minor / chartMax) * usableH));

            const limitY = toY(paceLimitMinor);
            const proRataStart = `${toX(1)},${toY(0)}`;
            const proRataEnd = `${toX(mDays)},${toY(paceLimitMinor)}`;

            const polyPoints = pacePoints
              .map((pt) => `${toX(pt.day).toFixed(1)},${toY(pt.cumulativeMinor).toFixed(1)}`)
              .join(" ");

            const lastPt = pacePoints[pacePoints.length - 1];
            const isOverPace =
              lastPt &&
              (lastPt.cumulativeMinor > paceLimitMinor ||
                (activeMonthSnapshot.isCurrentMonth &&
                  (lastPt.cumulativeMinor >= paceLimitMinor * 0.5 ||
                    lastPt.cumulativeMinor > lastPt.proRataMinor)));

            const pctUsed = paceLimitMinor > 0 ? Math.round((paceSpentMinor / paceLimitMinor) * 100) : 0;

            return (
              <div className="flex flex-col gap-3">
                {/* Explicit Summary Banner of Used vs Historical Threshold for Selected Month */}
                <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5 flex flex-col gap-1 text-[12.5px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {activeMonthSnapshot.isCurrentMonth ? (
                        <>
                          Spent by Day {mElapsed} of {activeMonthSnapshot.shortLabel}:{" "}
                          <strong className="tabular text-foreground">{fmtMoney(paceSpentMinor, currency)}</strong> vs.{" "}
                          <strong className="tabular text-foreground">{fmtMoney(paceLimitMinor, currency)}</strong>{" "}
                          threshold ({pctUsed}%)
                        </>
                      ) : (
                        <>
                          Ended up using in {activeMonthSnapshot.label}:{" "}
                          <strong className="tabular text-foreground">{fmtMoney(paceSpentMinor, currency)}</strong> vs.{" "}
                          <strong className="tabular text-foreground">{fmtMoney(paceLimitMinor, currency)}</strong>{" "}
                          threshold set ({pctUsed}%)
                        </>
                      )}
                    </span>
                    <Tag color={paceVarianceMinor >= 0 ? "green" : "red"}>
                      {paceVarianceMinor >= 0
                        ? `${fmtMoney(paceVarianceMinor, currency)} under threshold`
                        : `Exceeded by ${fmtMoney(Math.abs(paceVarianceMinor), currency)}`}
                    </Tag>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
                    <span>
                      Recorded threshold for {activeMonthSnapshot.shortLabel}:{" "}
                      <strong className="tabular text-foreground">{fmtMoney(paceLimitMinor, currency)}</strong>
                      {selectedPaceCat ? (
                        <>
                          {" "}
                          · Note: <span className="italic">&ldquo;{selectedPaceCat.thresholdComment}&rdquo;</span>
                        </>
                      ) : (
                        " (locked per month based on last threshold set in that month)"
                      )}
                    </span>
                  </div>
                </div>

                <svg
                  viewBox={`0 0 ${width} ${height}`}
                  className="w-full h-36 overflow-visible rounded-lg bg-muted/20 p-2"
                >
                  {/* Monthly Threshold Horizontal Line */}
                  <line
                    x1={padX}
                    y1={limitY}
                    x2={width - padX}
                    y2={limitY}
                    stroke="var(--dot-red)"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={width - padX - 4}
                    y={Math.max(10, limitY - 4)}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {activeMonthSnapshot.shortLabel} Threshold {fmtMoney(paceLimitMinor, currency)}
                  </text>

                  {/* Pro-Rata Expected Pace Line */}
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.3"
                    strokeWidth="1.5"
                    strokeDasharray="2 3"
                    points={`${proRataStart} ${proRataEnd}`}
                  />

                  {/* Actual Cumulative Spend Line */}
                  {pacePoints.length > 0 && (
                    <>
                      <polyline
                        fill="none"
                        stroke={isOverPace ? "var(--dot-red)" : "var(--primary)"}
                        strokeWidth="2.5"
                        points={polyPoints}
                      />
                      {lastPt && (
                        <circle
                          cx={toX(lastPt.day)}
                          cy={toY(lastPt.cumulativeMinor)}
                          r="4"
                          fill={isOverPace ? "var(--dot-red)" : "var(--primary)"}
                        />
                      )}
                    </>
                  )}
                </svg>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>1 {activeMonthSnapshot.shortLabel.slice(0, 3)}</span>
                  <span>
                    {activeMonthSnapshot.isCurrentMonth
                      ? `Today (Day ${mElapsed} of ${mDays})`
                      : `Final (${mDays} days in ${activeMonthSnapshot.shortLabel})`}
                  </span>
                  <span>
                    {mDays} {activeMonthSnapshot.shortLabel.slice(0, 3)}
                  </span>
                </div>

                {/* Historical Month-by-Month Used vs. Threshold Record Table */}
                <div className="border-t border-border/60 pt-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-[11.5px] font-medium text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <History className="size-3.5" />
                      <span>
                        Historical Monthly Threshold Record{" "}
                        {selectedPaceCat ? `(${selectedPaceCat.name})` : "(All Categories)"}
                      </span>
                    </span>
                    <span>Used vs. Threshold Set</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                    {monthlySnapshots.map((ms) => {
                      const catRow =
                        paceCategoryId === "all"
                          ? null
                          : ms.categoryPacing.find((c) => c.categoryId === paceCategoryId) ?? null;
                      const used = catRow ? catRow.spentMinor : ms.totalMinor;
                      const limit = catRow ? catRow.limitMinor : ms.overallLimitMinor;
                      const over = used > limit;
                      const isPicked = ms.monthKey === activeMonthSnapshot.monthKey;
                      return (
                        <button
                          key={ms.monthKey}
                          type="button"
                          onClick={() => setSelectedMonthKey(ms.monthKey)}
                          className={`flex flex-col rounded-md border p-1.5 text-left text-[11px] transition-colors ${
                            isPicked
                              ? "border-primary bg-accent/40"
                              : "border-border/60 bg-background hover:bg-muted/30"
                          }`}
                        >
                          <span className="font-medium text-muted-foreground">{ms.shortLabel}</span>
                          <span className={`tabular font-semibold ${over ? "text-[var(--dot-red)]" : "text-foreground"}`}>
                            {fmtMoney(used, currency)}
                          </span>
                          <span className="tabular text-[10px] text-muted-foreground">
                            of {fmtMoney(limit, currency)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* 4. Spending Explorer & Top Spenders by Horizon (Today / This Week / Selected Month / This Year) */}
      <section aria-labelledby="slicer-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" />
            <h2 id="slicer-heading" className="text-[15px] font-medium">
              Spending Breakdown by Category &amp; Subcategory
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-1">
            {(["day", "week", "month", "year"] as PeriodKey[]).map((k) => {
              const h = k === "month" ? activeHorizon : horizons[k];
              const active = period === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setPeriod(k);
                    setSelectedCategoryId(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                    active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {h.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 4-Horizon Highest Category & Subcategory Matrix */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(["day", "week", "month", "year"] as PeriodKey[]).map((k) => {
            const h = k === "month" ? activeHorizon : horizons[k];
            const isSelected = period === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setPeriod(k);
                  setSelectedCategoryId(null);
                }}
                className={`flex flex-col gap-2.5 rounded-xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-accent/30 ring-1 ring-primary/30"
                    : "border-border bg-card hover:border-border/80"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-muted-foreground">
                    {h.label} · <span className="text-[11.5px]">{h.sublabel}</span>
                  </span>
                  <span className="tabular text-[14px] font-semibold text-foreground">
                    {fmtMoney(h.totalMinor, currency)}
                  </span>
                </div>

                <div className="grid gap-1.5 border-t border-border/60 pt-2 text-[12.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Highest Cat:</span>
                    {h.topCategory ? (
                      <span className="flex items-center gap-1.5 font-medium text-foreground truncate">
                        <Dot color={h.topCategory.color} />
                        <span className="truncate">{h.topCategory.name}</span>
                        <span className="tabular text-muted-foreground">
                          ({fmtMoney(h.topCategory.netMinor, currency)})
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Highest Sub:</span>
                    {h.topSubcategory ? (
                      <span className="flex items-center gap-1.5 font-medium text-foreground truncate">
                        <Dot color={h.topSubcategory.parentColor} />
                        <span className="truncate">{h.topSubcategory.name}</span>
                        <span className="tabular text-muted-foreground">
                          ({fmtMoney(h.topSubcategory.netMinor, currency)})
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Category & Subcategory Breakdown Slicer */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              <span className="text-[14px] font-medium">
                {activeHorizon.label} Breakdown ({fmtMoney(activeHorizon.totalMinor, currency)} across{" "}
                {activeHorizon.transactionCount} transaction{activeHorizon.transactionCount === 1 ? "" : "s"})
              </span>
              {selectedCategoryId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategoryId(null);
                    setTrendCategoryId("all");
                    setPaceCategoryId("all");
                  }}
                  className="rounded-full bg-secondary px-2.5 py-0.5 text-[11.5px] font-medium text-foreground hover:bg-secondary/80"
                >
                  Show All Categories ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5 text-[12px]">
              {(
                [
                  { id: "both", label: "Category + Subcategory" },
                  { id: "category", label: "By Category" },
                  { id: "subcategory", label: "By Subcategory" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewMode(tab.id)}
                  className={`rounded px-2.5 py-1 font-medium transition-colors ${
                    viewMode === tab.id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className={`grid gap-6 ${viewMode === "both" ? "lg:grid-cols-2" : "grid-cols-1"}`}>
            {(viewMode === "both" || viewMode === "category") && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[12px] font-medium text-muted-foreground">
                  <span>Spending by Category (tap a category to filter WoW/MoM trends &amp; subcategories)</span>
                  <span>Used / Limit · Share</span>
                </div>
                {activeHorizon.byCategory.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    No confirmed spending recorded for {activeHorizon.label}.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border/50">
                    {activeHorizon.byCategory.map((c) => {
                      const isPicked = selectedCategoryId === c.id;
                      return (
                        <li key={c.id ?? "none"}>
                          <button
                            type="button"
                            onClick={() => {
                              const nextId = selectedCategoryId === c.id ? null : c.id;
                              setSelectedCategoryId(nextId);
                              if (nextId) {
                                setTrendCategoryId(nextId);
                                setPaceCategoryId(nextId);
                              } else {
                                setTrendCategoryId("all");
                                setPaceCategoryId("all");
                              }
                            }}
                            className={`w-full grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 py-2 px-2 rounded-md text-left transition-colors ${
                              isPicked ? "bg-accent/60 font-medium" : "hover:bg-muted/40"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2 text-[13.5px]">
                              <Dot color={c.color} />
                              <span className="truncate">{c.name}</span>
                              <span className="text-[11px] text-muted-foreground">({c.count})</span>
                            </span>
                            <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                              <span
                                className="block h-full rounded-full"
                                style={{
                                  width: `${Math.max(3, (c.netMinor / maxCatMinor) * 100)}%`,
                                  background: `var(--dot-${c.color})`,
                                }}
                              />
                            </span>
                            <span className="tabular flex items-center gap-2 text-right text-[13px]">
                              <span className="font-medium text-foreground">
                                {fmtMoney(c.netMinor, currency)}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                / {fmtMoney(c.limitMinor, currency)}
                              </span>
                              <span className="w-11 text-[11.5px] text-muted-foreground">
                                {c.sharePct}%
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {(viewMode === "both" || viewMode === "subcategory") && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[12px] font-medium text-muted-foreground">
                  <span>
                    Spending by Subcategory
                    {selectedCategoryId
                      ? ` (${activeHorizon.byCategory.find((x) => x.id === selectedCategoryId)?.name ?? ""})`
                      : " (All Categories)"}
                  </span>
                  <span>Amount · Share</span>
                </div>
                {filteredSubcategories.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    No subcategory spending for this selection.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border/50">
                    {filteredSubcategories.slice(0, 12).map((s, idx) => (
                      <li
                        key={`${s.id ?? "unspec"}-${idx}`}
                        className="grid grid-cols-[minmax(0,175px)_1fr_auto] items-center gap-3 py-2 px-1"
                      >
                        <span className="flex min-w-0 items-center gap-2 text-[13px]">
                          <Dot color={s.parentColor} />
                          <span className="truncate font-medium text-foreground">{s.name}</span>
                          <span className="truncate text-[11px] text-muted-foreground">
                            · {s.parentName}
                          </span>
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.max(3, (s.netMinor / maxSubMinor) * 100)}%`,
                              background: `var(--dot-${s.parentColor})`,
                            }}
                          />
                        </span>
                        <span className="tabular flex items-center gap-2 text-right text-[13px]">
                          <span className="font-medium text-foreground">
                            {fmtMoney(s.netMinor, currency)}
                          </span>
                          <span className="w-11 text-[11.5px] text-muted-foreground">
                            {s.sharePct}%
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 5. Recent Documented Threshold Changes Log (if any) */}
      {thresholdLogs.length > 0 && (
        <section aria-labelledby="dashboard-threshold-log" className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              <h3 id="dashboard-threshold-log" className="text-[14px] font-medium">
                Documented Monthly Threshold Changes
              </h3>
            </div>
            <Link href="/settings#flags" className="text-[12px] text-muted-foreground hover:text-foreground">
              Manage &amp; comment in Settings &rarr;
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground">
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium text-right">Threshold Change</th>
                  <th className="pb-2 pl-3 font-medium">Reason / Comment</th>
                  <th className="pb-2 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {thresholdLogs.slice(0, 6).map((log) => (
                  <tr key={log.id}>
                    <td className="py-1.5 pr-2 font-medium tabular">{log.monthKey}</td>
                    <td className="py-1.5 pr-2">{log.categoryName}</td>
                    <td className="py-1.5 px-2 text-right tabular">
                      {log.previousMinor !== null ? (
                        <span className="text-muted-foreground">
                          {fmtMoney(log.previousMinor, currency)} &rarr;{" "}
                        </span>
                      ) : null}
                      <strong className="text-foreground">{fmtMoney(log.amountMinor, currency)}</strong>
                    </td>
                    <td className="py-1.5 pl-3">
                      <Tag color={log.comment === "according to suggestion" ? "blue" : "gray"}>
                        {log.comment}
                      </Tag>
                    </td>
                    <td className="py-1.5 pl-2 text-right text-muted-foreground tabular">
                      {log.changedAtFormatted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
