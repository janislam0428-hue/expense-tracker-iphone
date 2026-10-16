import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/session";
import Link from "next/link";
import { ArrowDownToLine, BellRing } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { getOverview } from "@/lib/queries/overview";
import { formatMoney, percentChange } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Dot } from "@/components/app/tag";
import { TxListHeader, TxRow } from "@/components/app/tx-row";
import { PhaseNote } from "@/components/app/phase-note";
import { EmptyState } from "@/components/app/empty-state";
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
  const maxCat = o.byCategory[0]?.netMinor ?? 1;
  const importOverdue = o.daysSinceImport === null || o.daysSinceImport >= 7;
  const hasAny = o.recent.length > 0;

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
            <StatCard label="Spent so far" value={formatMoney(o.totalMinor, cur, { decimals: false })} hint={`${o.transactionCount} transactions`} />
            <StatCard
              label="vs last month"
              value={
                <span className={change.tone === "up" ? "text-[var(--dot-red)]" : change.tone === "down" ? "text-success" : "text-muted-foreground text-[15px]"}>
                  {change.text}
                </span>
              }
              hint={`${formatMoney(o.prevSameDaysMinor, cur, { decimals: false })} in the same ${o.elapsed} days`}
            />
            <StatCard label="Average per day" value={formatMoney(o.avgPerDayMinor, cur, { decimals: false })} hint="Top ups and transfers not counted" />
            <StatCard
              label="Top category"
              value={<span className="text-[17px]">{o.topCategory?.name ?? "None yet"}</span>}
              hint={o.topCategory ? formatMoney(o.topCategory.netMinor, cur, { decimals: false }) : undefined}
            />
            <StatCard
              label="To confirm"
              value={o.pending}
              hint={o.pending > 0 ? "Tap to review" : "All clear"}
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
              hint={importOverdue ? "Time to import" : o.lastImportAt ? formatInZone(o.lastImportAt, "EEE d MMM", zone) : undefined}
              href="/import"
              tone={importOverdue ? "attention" : "default"}
            />
          </section>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section aria-labelledby="by-cat">
              <h2 id="by-cat" className="mb-3 text-[15px] font-medium">
                Where it went this month
              </h2>
              <ul className="flex flex-col">
                {o.byCategory.slice(0, 9).map((c) => (
                  <li key={c.id ?? "none"} className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 py-1.5">
                    <span className="flex min-w-0 items-center gap-2 text-[13.5px]">
                      <Dot color={c.color} />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(2, (c.netMinor / maxCat) * 100)}%`, background: `var(--dot-${c.color})` }}
                      />
                    </span>
                    <span className="tabular flex items-center gap-2 text-right text-[13.5px]">
                      {c.alert ? (
                        <span className="rounded-[4px] bg-[var(--tag-red-bg)] px-1.5 text-[11.5px] leading-[18px] text-[var(--tag-red-fg)]">
                          Over {formatMoney(c.alert.limitMinor, cur, { decimals: false })}
                        </span>
                      ) : null}
                      {formatMoney(c.netMinor, cur, { decimals: false })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="highlights" className="flex flex-col gap-3">
              <h2 id="highlights" className="text-[15px] font-medium">
                Highlights
              </h2>
              {o.alerts.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {o.alerts.map((a) => (
                    <li key={a.categoryId} className="flex gap-3 rounded-lg border border-border px-3.5 py-3">
                      <BellRing className="mt-0.5 size-4 shrink-0 text-[var(--dot-red)]" aria-hidden />
                      <p className="text-[13.5px] leading-relaxed">
                        <span className="font-medium">{a.categoryName}</span> is at{" "}
                        <span className="tabular">{formatMoney(a.totalMinor, cur, { decimals: false })}</span> this month, over your{" "}
                        <span className="tabular">{formatMoney(a.limitMinor, cur, { decimals: false })}</span> alert.
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-muted-foreground">
                  No category is over its {formatMoney(settings.alertThresholdMinor, cur, { decimals: false })} monthly alert yet.
                </p>
              )}
              <PhaseNote phase={5}>Filters, charts and a plain language spending summary.</PhaseNote>
            </section>
          </div>

          <section aria-labelledby="recent">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="recent" className="text-[15px] font-medium">
                Recent transactions
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
