import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/session";
import Link from "next/link";
import { ArrowDownToLine } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { getOverview } from "@/lib/queries/overview";
import { formatMoney, percentChange } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { TxListHeader, TxRow } from "@/components/app/tx-row";
import { EmptyState } from "@/components/app/empty-state";
import { DashboardExplorer } from "@/components/app/dashboard-explorer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Dashboard" };

function changeLabel(cur: number, prev: number) {
  const pct = percentChange(cur, prev);
  if (pct === null) return { text: "No spending yet last month", tone: "muted" as const };
  const rounded = Math.round(pct);
  if (rounded === 0) return { text: "Same as last month", tone: "muted" as const };
  return { text: `${rounded > 0 ? "+" : ""}${rounded}%`, tone: rounded > 0 ? ("up" as const) : ("down" as const) };
}

export default async function DashboardPage() {
  await requireAuth();
  const settings = await getSettings();
  const o = await getOverview(settings);
  const cur = settings.currency;
  const zone = settings.timezone;
  const monthName = formatInZone(o.month.start, "MMMM yyyy", zone);
  const change = changeLabel(o.totalMinor, o.prevSameDaysMinor);
  const importOverdue = o.daysSinceImport === null || o.daysSinceImport >= 7;
  const hasAny = o.recent.length > 0 || o.pending > 0 || o.horizons.year.totalMinor > 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description={`${monthName}, day ${o.elapsed} of ${o.daysInMonth}`}
        actions={
          <Button asChild variant={importOverdue ? "default" : "outline"} size="lg">
            <Link href="/import">
              <ArrowDownToLine aria-hidden />
              Import
            </Link>
          </Button>
        }
      />

      {!hasAny ? (
        <EmptyState
          icon={<ArrowDownToLine />}
          title="No transactions yet"
          action={
            <Button asChild>
              <Link href="/import">Import your first screenshots</Link>
            </Button>
          }
        >
          Start with a screenshot of your Octopus card in Wallet. PayMe arrives on its own once email import is set up. You can
          also switch demo data on in Settings to see how everything works.
        </EmptyState>
      ) : (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              label="Spent so far"
              value={formatMoney(o.totalMinor, cur, { decimals: false })}
              hint={`${o.transactionCount} confirmed transaction${o.transactionCount === 1 ? "" : "s"}`}
            />
            <StatCard
              label="vs last month"
              value={
                <span
                  className={
                    change.tone === "up"
                      ? "text-[var(--dot-red)]"
                      : change.tone === "down"
                        ? "text-success"
                        : "text-muted-foreground text-[15px]"
                  }
                >
                  {change.text}
                </span>
              }
              hint={`${formatMoney(o.prevSameDaysMinor, cur, { decimals: false })} in the same ${o.elapsed} days`}
            />
            <StatCard
              label="Average per day"
              value={formatMoney(o.avgPerDayMinor, cur, { decimals: false })}
              hint="Confirmed expenses only"
            />
            <StatCard
              label="Top category"
              value={<span className="text-[17px]">{o.topCategory?.name ?? "None yet"}</span>}
              hint={o.topCategory ? formatMoney(o.topCategory.netMinor, cur, { decimals: false }) : undefined}
            />
            <StatCard
              label="To confirm"
              value={o.pending}
              hint={
                o.pending > 0
                  ? `~${formatMoney(o.pendingTotalMinor, cur, { decimals: false })} awaiting confirmation`
                  : "All clear"
              }
              href="/review"
              tone={o.pending > 0 ? "attention" : "default"}
            />
            <StatCard
              label="Last import"
              value={
                <span className="text-[17px]">
                  {o.daysSinceImport === null ? "Never" : o.daysSinceImport === 0 ? "Today" : `${o.daysSinceImport} days ago`}
                </span>
              }
              hint={
                importOverdue
                  ? "Time to import"
                  : o.lastImportAt
                    ? formatInZone(o.lastImportAt, "EEE d MMM", zone)
                    : undefined
              }
              href="/import"
              tone={importOverdue ? "attention" : "default"}
            />
          </section>

          <DashboardExplorer
            currency={cur}
            monthName={monthName}
            elapsed={o.elapsed}
            daysInMonth={o.daysInMonth}
            horizons={o.horizons}
            weeklySeries={o.weeklySeries}
            monthlySeries={o.monthlySeries}
            categoryPacing={o.categoryPacing}
            overallDailyCumulative={o.overallDailyCumulative}
            overallLimitMinor={o.overallLimitMinor}
          />

          <section aria-labelledby="recent">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="recent" className="text-[15px] font-medium">
                Recent confirmed transactions
              </h2>
              <Link href="/transactions" className="text-[13px] text-muted-foreground hover:text-foreground">
                View all
              </Link>
            </div>
            <TxListHeader />
            <ul className="divide-y divide-border">
              {o.recent.map((t) => (
                <TxRow key={t.id} tx={t} zone={zone} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
