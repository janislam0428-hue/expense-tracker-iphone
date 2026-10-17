"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dot } from "@/components/app/tag";
import { saveSettings, type FormState } from "./actions";
import { CURRENCIES, TIMEZONES } from "./options";

type CategoryThresholdItem = {
  id: string;
  name: string;
  color: string;
  override: string;
  avgMonthly?: string;
  currentMonth?: string;
  lastMonth?: string;
  suggested?: string;
};

type Props = {
  currency: string;
  timezone: string;
  weekStart: number;
  reviewThreshold: string;
  alertThreshold: string;
  categories: CategoryThresholdItem[];
};

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[220px_minmax(0,320px)] sm:items-start sm:gap-6">
      <div className="pt-1.5">
        <Label htmlFor={htmlFor} className="text-[14px] font-normal">
          {label}
        </Label>
        {hint ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function SettingsForm(p: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, undefined);
  const [overrides, setOverrides] = useState<Record<string, string>>(() =>
    Object.fromEntries(p.categories.map((c) => [c.id, c.override])),
  );

  useEffect(() => {
    if (state?.ok) toast.success(state.ok);
    if (state?.error) toast.error(state.error);
  }, [state]);

  const applyAllSuggested = () => {
    const next: Record<string, string> = {};
    for (const c of p.categories) {
      next[c.id] = c.suggested || p.alertThreshold;
    }
    setOverrides(next);
    toast.success("Filled suggested thresholds from your spending average. Click Save settings to apply.");
  };

  return (
    <form action={action} className="flex flex-col gap-10">
      <section aria-labelledby="general" className="flex flex-col gap-5">
        <h2 id="general" className="border-b border-border pb-2 text-[15px] font-medium">
          General
        </h2>
        <Field label="Currency" hint="Used for display and new transactions" htmlFor="currency">
          <Select name="currency" defaultValue={p.currency}>
            <SelectTrigger id="currency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Timezone" hint="Decides which day a late night payment belongs to" htmlFor="timezone">
          <Select name="timezone" defaultValue={p.timezone}>
            <SelectTrigger id="timezone" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Weeks start on" htmlFor="weekStart">
          <Select name="weekStart" defaultValue={String(p.weekStart)}>
            <SelectTrigger id="weekStart" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Monday</SelectItem>
              <SelectItem value="0">Sunday</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </section>

      <section id="flags" aria-labelledby="flags-heading" className="flex scroll-mt-8 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <h2 id="flags-heading" className="text-[15px] font-medium">
            Flags and alerts
          </h2>
          <Button type="button" variant="outline" size="sm" onClick={applyAllSuggested} className="h-8 gap-1.5 text-[12px]">
            <Sparkles className="size-3.5 text-warning" />
            Fill all suggested thresholds
          </Button>
        </div>

        <Field
          label="Ask me to confirm above"
          hint="Any transaction above this amount goes to To confirm, whatever its category"
          htmlFor="reviewThreshold"
        >
          <Input
            id="reviewThreshold"
            name="reviewThreshold"
            inputMode="decimal"
            defaultValue={p.reviewThreshold}
            className="tabular"
          />
        </Field>
        <Field
          label="Monthly category alert"
          hint="Default monthly threshold when a category has no custom limit below"
          htmlFor="alertThreshold"
        >
          <Input
            id="alertThreshold"
            name="alertThreshold"
            inputMode="decimal"
            defaultValue={p.alertThreshold}
            className="tabular"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
          <div className="pt-1.5">
            <p className="text-[14px]">Per category alerts &amp; suggestions</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
              Shows your monthly average and this month&apos;s total so you can set realistic limits per category.
            </p>
          </div>

          <ul className="flex max-w-[680px] flex-col divide-y divide-border/60 rounded-xl border border-border bg-card px-3.5 py-1">
            {p.categories.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-[160px] flex-1">
                  <label htmlFor={`cat_${c.id}`} className="flex items-center gap-2 text-[13.5px] font-medium">
                    <Dot color={c.color} />
                    <span className="truncate">{c.name}</span>
                  </label>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    Avg: ${c.avgMonthly ?? "0"}/mo · This mo: ${c.currentMonth ?? "0"}
                    {c.lastMonth && c.lastMonth !== "0" ? ` · Last mo: $${c.lastMonth}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {c.suggested && (
                    <button
                      type="button"
                      onClick={() => setOverrides((prev) => ({ ...prev, [c.id]: c.suggested! }))}
                      className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/40 px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      title="Use recommended threshold based on your average spend"
                    >
                      <Sparkles className="size-3 text-warning" />
                      Suggest: ${c.suggested}
                    </button>
                  )}
                  <Input
                    id={`cat_${c.id}`}
                    name={`cat_${c.id}`}
                    inputMode="decimal"
                    value={overrides[c.id] ?? ""}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    placeholder={p.alertThreshold}
                    className="tabular h-8 w-24 text-right text-[13px]"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save settings
        </Button>
      </div>
    </form>
  );
}
