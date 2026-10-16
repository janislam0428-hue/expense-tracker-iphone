import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/session";
import { LineChart, Lock } from "lucide-react";
import { db } from "@/lib/db";
import { demoScope, getSettings } from "@/lib/settings";
import { predictionTier } from "@/lib/insights/tier";
import { PageHeader } from "@/components/app/page-header";
import { PhaseNote } from "@/components/app/phase-note";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Insights" };

const TIERS = [
  { key: "locked", title: "Under 7 days", body: "Predictions stay hidden. You'll see how many days are left until they unlock." },
  { key: "early", title: "7 days to 3 months", body: "An early estimate for the current month only, with a wide range." },
  { key: "full", title: "3 months or more", body: "Quarter and year forecasts, trends and new recurring charges." },
] as const;

export default async function InsightsPage() {
  await requireAuth();
  const settings = await getSettings();
  const first = await db.transaction.findFirst({
    where: demoScope(settings),
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });
  const info = predictionTier(first?.occurredAt ?? null, new Date());
  const months = Math.floor(info.daysOfData / 30.4);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insights"
        description={
          info.daysOfData === 0
            ? "No data yet."
            : `You have ${info.daysOfData.toLocaleString("en-HK")} days of history${months >= 1 ? `, about ${months} months` : ""}.`
        }
      />
      <ol className="grid gap-3 md:grid-cols-3">
        {TIERS.map((t) => {
          const active = info.tier === t.key;
          return (
            <li
              key={t.key}
              className={cn("rounded-lg border border-border p-4", active && "border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]")}
            >
              <div className="flex items-center gap-2 text-[14px] font-medium">
                {t.key === "locked" ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : <LineChart className="size-3.5 text-muted-foreground" aria-hidden />}
                {t.title}
                {active ? <span className="ml-auto rounded-[4px] bg-[var(--tag-blue-bg)] px-1.5 text-[11.5px] leading-[18px] text-[var(--tag-blue-fg)]">You are here</span> : null}
              </div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{t.body}</p>
            </li>
          );
        })}
      </ol>
      <p className="text-[13.5px] text-muted-foreground">
        Seasonal patterns need the same peak in at least two different years.{" "}
        {info.seasonalityPossible ? "You have enough history for this." : "Import older history to get there sooner."}
      </p>
      <PhaseNote phase={6}>Seasonality, forecasts shown as a range, unusual spikes, recurring charges and budgets.</PhaseNote>
    </div>
  );
}
