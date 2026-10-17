"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Check,
  Filter,
  Layers,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dot, Tag } from "@/components/app/tag";
import { updateCategoryThresholdQuick } from "@/app/(app)/settings/actions";
import type {
  CategoryPacingFlag,
  DailyPacePoint,
  HorizonSummary,
  PeriodKey,
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

export function DashboardExplorer({
  currency,
  monthName,
  elapsed,
  daysInMonth,
  horizons,
  weeklySeries,
  monthlySeries,
  categoryPacing,
  overallDailyCumulative,
  overallLimitMinor,
}: {
  currency: string;
  monthName: string;
  elapsed: number;
  daysInMonth: number;
  horizons: Record<PeriodKey, HorizonSummary>;
  weeklySeries: TimeSeriesBar[];
  monthlySeries: TimeSeriesBar[];
  categoryPacing: CategoryPacingFlag[];
  overallDailyCumulative: DailyPacePoint[];
  overallLimitMinor: number;
}) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [viewMode, setViewMode] = useState<"both" | "category" | "subcategory">("both");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [trendMode, setTrendMode] = useState<"wow" | "mom">("wow");
  const [paceCategoryId, setPaceCategoryId] = useState<string>("all");
  const [pending, startTransition] = useTransition();

  const activeHorizon = horizons[period];
  const maxCatMinor = activeHorizon.byCategory[0]?.netMinor ?? 1;

  const filteredSubcategories = selectedCategoryId
    ? activeHorizon.bySubcategory.filter((s) => s.parentId === selectedCategoryId)
    : activeHorizon.bySubcategory;
  const maxSubMinor = filteredSubcategories[0]?.netMinor ?? 1;

  const activeSeries = trendMode === "wow" ? weeklySeries : monthlySeries;
  const maxSeriesMinor = Math.max(1, ...activeSeries.map((b) => b.totalMinor));

  const selectedPaceCat =
    paceCategoryId === "all" ? null : categoryPacing.find((c) => c.categoryId === paceCategoryId) ?? null;
  const pacePoints = selectedPaceCat ? selectedPaceCat.dailyCumulative : overallDailyCumulative;
  const paceLimitMinor = selectedPaceCat ? selectedPaceCat.limitMinor : overallLimitMinor;
  const paceSpentMinor = selectedPaceCat
    ? selectedPaceCat.spentMinor
    : (overallDailyCumulative[overallDailyCumulative.length - 1]?.cumulativeMinor ?? 0);

  const flaggedCategories = categoryPacing.filter((c) => c.status !== "on_track");

  const handleApplySuggestion = (catId: string, suggestedMinor: number) => {
    startTransition(async () => {
      const res = await updateCategoryThresholdQuick(catId, suggestedMinor);
      if (res.ok) {
        toast.success(res.ok);
      } else {
        toast.error(res.error || "Could not update threshold");
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* 1. Highest Category & Subcategory Per Year / Month / Week / Day + Interactive Slicer */}
      <section aria-labelledby="slicer-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <h2 id="slicer-heading" className="text-[15px] font-medium">
              Spending Explorer &amp; Top Spenders by Horizon
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-1">
            {(["day", "week", "month", "year"] as PeriodKey[]).map((k) => {
              const h = horizons[k];
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
            const h = horizons[k];
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
                  onClick={() => setSelectedCategoryId(null)}
                  className="rounded-full bg-secondary px-2.5 py-0.5 text-[11.5px] font-medium text-foreground hover:bg-secondary/80"
                >
                  Clear category filter ✕
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

          <div
            className={`grid gap-6 ${
              viewMode === "both" ? "lg:grid-cols-2" : "grid-cols-1"
            }`}
          >
            {(viewMode === "both" || viewMode === "category") && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[12px] font-medium text-muted-foreground">
                  <span>Spending by Category (tap a row to filter subcategories)</span>
                  <span>Amount · Share</span>
                </div>
                {activeHorizon.byCategory.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    No confirmed spending recorded for {activeHorizon.label.toLowerCase()}.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border/50">
                    {activeHorizon.byCategory.map((c) => {
                      const isPicked = selectedCategoryId === c.id;
                      return (
                        <li key={c.id ?? "none"}>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedCategoryId((prev) => (prev === c.id ? null : c.id))
                            }
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
                      : ""}
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

      {/* 2. Visualizations & Charts: WoW / MoM Stacked Bars + Recorded Date vs Monthly Threshold Pace */}
      <section aria-labelledby="charts-heading" className="grid gap-6 lg:grid-cols-2">
        {/* Chart A: Week-over-Week & Month-over-Month Category Trends */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" />
              <h3 id="charts-heading" className="text-[14.5px] font-medium">
                Category Trends ({trendMode === "wow" ? "Week over Week" : "Month over Month"})
              </h3>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => setTrendMode("wow")}
                className={`rounded px-2.5 py-1 font-medium ${
                  trendMode === "wow" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                }`}
              >
                Week over Week
              </button>
              <button
                type="button"
                onClick={() => setTrendMode("mom")}
                className={`rounded px-2.5 py-1 font-medium ${
                  trendMode === "mom" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                }`}
              >
                Month over Month
              </button>
            </div>
          </div>

          <div className="grid grid-cols-6 items-end gap-2.5 pt-4 h-52">
            {activeSeries.map((bar) => {
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
                    title={bar.byCategory
                      .map((c) => `${c.name}: ${fmtMoney(c.amountMinor, currency)}`)
                      .join("\n")}
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

          <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-2.5 text-[11.5px] text-muted-foreground">
            {horizons.month.byCategory.slice(0, 6).map((c) => (
              <span key={c.id ?? "none"} className="inline-flex items-center gap-1.5">
                <Dot color={c.color} />
                <span>{c.name}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Chart B: Recorded Date vs Monthly Threshold Pace */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              <h3 className="text-[14.5px] font-medium">
                Recorded Date vs. Monthly Threshold ({monthName})
              </h3>
            </div>

            <select
              value={paceCategoryId}
              onChange={(e) => setPaceCategoryId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2.5 text-[12px]"
            >
              <option value="all">All Categories Combined</option>
              {categoryPacing.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name} (Limit: {fmtMoney(c.limitMinor, currency)})
                </option>
              ))}
            </select>
          </div>

          {(() => {
            const chartMax = Math.max(paceLimitMinor * 1.1, paceSpentMinor * 1.1, 100);
            const width = 460;
            const height = 160;
            const padX = 8;
            const padY = 14;
            const usableW = width - padX * 2;
            const usableH = height - padY * 2;

            const toX = (day: number) => padX + ((day - 1) / Math.max(1, daysInMonth - 1)) * usableW;
            const toY = (minor: number) =>
              padY + usableH - Math.min(usableH, Math.max(0, (minor / chartMax) * usableH));

            const limitY = toY(paceLimitMinor);
            const proRataStart = `${toX(1)},${toY(0)}`;
            const proRataEnd = `${toX(daysInMonth)},${toY(paceLimitMinor)}`;

            const polyPoints = pacePoints
              .map((pt) => `${toX(pt.day).toFixed(1)},${toY(pt.cumulativeMinor).toFixed(1)}`)
              .join(" ");

            const lastPt = pacePoints[pacePoints.length - 1];
            const isOverPace =
              lastPt && (lastPt.cumulativeMinor >= paceLimitMinor * 0.5 || lastPt.cumulativeMinor > lastPt.proRataMinor);

            return (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                  <span>
                    Spent by Day {elapsed}:{" "}
                    <strong className="tabular text-foreground">{fmtMoney(paceSpentMinor, currency)}</strong> of{" "}
                    <strong className="tabular text-foreground">{fmtMoney(paceLimitMinor, currency)}</strong> monthly
                    threshold ({paceLimitMinor > 0 ? Math.round((paceSpentMinor / paceLimitMinor) * 100) : 0}%)
                  </span>
                  {selectedPaceCat?.flagMessage ? (
                    <span className="rounded bg-[var(--tag-red-bg)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--tag-red-fg)]">
                      {selectedPaceCat.flagMessage}
                    </span>
                  ) : null}
                </div>

                <svg
                  viewBox={`0 0 ${width} ${height}`}
                  className="w-full h-40 overflow-visible rounded-lg bg-muted/20 p-2"
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
                  <text x={width - padX - 4} y={Math.max(10, limitY - 4)} textAnchor="end" className="fill-muted-foreground text-[10px]">
                    Threshold {fmtMoney(paceLimitMinor, currency)}
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
                  <span>1 {monthName.slice(0, 3)}</span>
                  <span>
                    Today (Day {elapsed} of {daysInMonth})
                  </span>
                  <span>
                    {daysInMonth} {monthName.slice(0, 3)}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* 3. Threshold Pacing Flags & Smart Reminder Section Connected to Settings */}
      <section aria-labelledby="threshold-reminders" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Left: Active Pacing & Threshold Flags */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3.5">
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <BellRing className="size-4 text-[var(--dot-red)]" />
              <h3 id="threshold-reminders" className="text-[14.5px] font-medium">
                Monthly Threshold &amp; Mid-Month Pacing Flags
              </h3>
            </div>
            <span className="text-[12px] text-muted-foreground">Day {elapsed} of {daysInMonth}</span>
          </div>

          {flaggedCategories.length === 0 ? (
            <p className="py-6 text-[13.5px] text-muted-foreground">
              All categories are currently under 50% of their monthly threshold and within expected daily pace.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {flaggedCategories.map((fc) => (
                <li
                  key={fc.categoryId}
                  className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                      <Dot color={fc.color} />
                      <span>{fc.name}</span>
                      <Tag color={fc.status === "over_limit" ? "red" : "orange"}>
                        {fc.status === "over_limit" ? "Over Threshold" : `${fc.pctOfLimit}% Spent`}
                      </Tag>
                    </span>
                    <span className="tabular text-[13.5px] font-semibold">
                      {fmtMoney(fc.spentMinor, currency)} / {fmtMoney(fc.limitMinor, currency)}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-muted-foreground flex items-center gap-1.5">
                    <AlertTriangle className="size-3.5 shrink-0 text-[var(--dot-red)]" />
                    <span>
                      {fc.spentMinor > fc.limitMinor
                        ? `${fc.name} has spent ${fmtMoney(fc.spentMinor, currency)} by ${fc.latestTxDateLabel ?? "today"}, exceeding the ${fmtMoney(fc.limitMinor, currency)} monthly threshold.`
                        : `${fmtMoney(fc.spentMinor, currency)} spent by ${fc.latestTxDateLabel ?? "today"} (${fc.pctOfLimit}% of ${fmtMoney(fc.limitMinor, currency)} threshold; day-${fc.latestTxDay} pace is ${fmtMoney(fc.proRataAtTxMinor, currency)}).`}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: Reminder Section to Update Category Thresholds + Smart Suggestions */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-warning" />
              <h3 className="text-[14.5px] font-medium">
                Threshold Reminders &amp; Smart Suggestions
              </h3>
            </div>
            <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-[12px]">
              <Link href="/settings#flags">
                <SlidersHorizontal className="size-3.5" />
                Open Threshold Settings
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>

          <p className="text-[12.5px] text-muted-foreground">
            Based on your spending pattern (showing your monthly average and {monthName} total), here are recommended
            monthly thresholds per category. Tap <strong>Apply</strong> to update a category immediately, or manage all
            thresholds in <Link href="/settings#flags" className="underline text-foreground">Settings</Link>.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium text-right">Current Limit</th>
                  <th className="pb-2 font-medium text-right">Monthly Avg</th>
                  <th className="pb-2 font-medium text-right">Suggested</th>
                  <th className="pb-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {categoryPacing.slice(0, 8).map((c) => {
                  const isMatched = c.hasCustomLimit && c.limitMinor === c.suggestedThresholdMinor;
                  return (
                    <tr key={c.categoryId}>
                      <td className="py-2 pr-2">
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          <Dot color={c.color} />
                          <span className="truncate">{c.name}</span>
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right tabular">
                        <span>{fmtMoney(c.limitMinor, currency)}</span>
                        {!c.hasCustomLimit && (
                          <span className="ml-1 text-[10.5px] text-muted-foreground">(default)</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular text-muted-foreground">
                        {fmtMoney(c.avgMonthlyMinor, currency)}
                      </td>
                      <td className="py-2 px-2 text-right tabular font-semibold text-foreground">
                        {fmtMoney(c.suggestedThresholdMinor, currency)}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        {isMatched ? (
                          <span className="inline-flex items-center gap-1 text-[11.5px] text-success">
                            <Check className="size-3" /> Set
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleApplySuggestion(c.categoryId, c.suggestedThresholdMinor)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-[11.5px] font-medium text-foreground hover:bg-accent transition-colors"
                          >
                            Apply {fmtMoney(c.suggestedThresholdMinor, currency)}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
