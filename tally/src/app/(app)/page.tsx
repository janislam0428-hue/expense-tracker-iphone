import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/session";
import Link from "next/link";
import { ArrowDownToLine } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { getOverview } from "@/lib/queries/overview";
import { formatInZone } from "@/lib/time";
import { PageHeader } from "@/components/app/page-header";
import { TxListHeader, TxRow } from "@/components/app/tx-row";
import { EmptyState } from "@/components/app/empty-state";
import { DashboardExplorer } from "@/components/app/dashboard-explorer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireAuth();
  const settings = await getSettings();
  const o = await getOverview(settings);
  const cur = settings.currency;
  const zone = settings.timezone;
  const monthName = formatInZone(o.month.start, "MMMM yyyy", zone);
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
          <DashboardExplorer
            currency={cur}
            zone={zone}
            monthName={monthName}
            currentMonthKey={o.currentMonthKey}
            elapsed={o.elapsed}
            daysInMonth={o.daysInMonth}
            daysRemainingInMonth={o.daysRemainingInMonth}
            isEndOfMonthReminderDue={o.isEndOfMonthReminderDue}
            horizons={o.horizons}
            weeklySeries={o.weeklySeries}
            monthlySeries={o.monthlySeries}
            monthlySnapshots={o.monthlySnapshots}
            thresholdLogs={o.thresholdLogs}
            spendCategories={o.spendCategories}
            pendingCount={o.pending}
            pendingTotalMinor={o.pendingTotalMinor}
            daysSinceImport={o.daysSinceImport}
            lastImportFormatted={o.lastImportAt ? formatInZone(o.lastImportAt, "EEE d MMM", zone) : null}
            importOverdue={importOverdue}
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
