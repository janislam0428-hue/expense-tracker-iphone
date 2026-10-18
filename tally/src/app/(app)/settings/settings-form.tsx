"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { History, Loader2, MessageSquareText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dot, Tag } from "@/components/app/tag";
import { saveSettings, type FormState } from "./actions";
import { CURRENCIES, TIMEZONES } from "./options";
import type { ThresholdLogEntry } from "@/lib/queries/overview";

type CategoryThresholdItem = {
  id: string;
  name: string;
  color: string;
  override: string;
  avgMonthly?: string;
  currentMonth?: string;
  lastMonth?: string;
  suggested?: string;
  latestComment?: string;
  latestUpdatedAt?: string | null;
};

type Props = {
  currency: string;
  timezone: string;
  weekStart: number;
  reviewThreshold: string;
  alertThreshold: string;
  categories: CategoryThresholdItem[];
  thresholdLogs?: ThresholdLogEntry[];
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
    <div className="grid gap-1.5 sm:grid-cols-[220px_minmax(0,380px)] sm:items-start sm:gap-6">
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
  const [comments, setComments] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, "suggestion" | "manual">>({});
  const [globalComment, setGlobalComment] = useState("");

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      setComments({});
      setSources({});
      setGlobalComment("");
    }
    if (state?.error) toast.error(state.error);
  }, [state]);

  const applyAllSuggested = () => {
    const nextOverrides: Record<string, string> = {};
    const nextComments: Record<string, string> = { ...comments };
    const nextSources: Record<string, "suggestion" | "manual"> = { ...sources };
    for (const c of p.categories) {
      nextOverrides[c.id] = c.suggested || p.alertThreshold;
      nextComments[c.id] = "according to suggestion";
      nextSources[c.id] = "suggestion";
    }
    setOverrides(nextOverrides);
    setComments(nextComments);
    setSources(nextSources);
    toast.success('Filled suggested thresholds with comment "according to suggestion". Click Save settings to apply.');
  };

  const applySingleSuggestion = (c: CategoryThresholdItem) => {
    if (!c.suggested) return;
    setOverrides((prev) => ({ ...prev, [c.id]: c.suggested! }));
    setComments((prev) => ({ ...prev, [c.id]: "according to suggestion" }));
    setSources((prev) => ({ ...prev, [c.id]: "suggestion" }));
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
            Flags, Monthly Thresholds &amp; Change Documentation
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyAllSuggested}
            className="h-8 gap-1.5 text-[12px]"
          >
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
        <Field
          label="Comment for threshold change (optional)"
          hint='Applies to any threshold changed in this save if no per-category note is written. Clicking Suggest sets "according to suggestion"; leaving blank defaults to "threshold testing and adjustment".'
          htmlFor="thresholdComment"
        >
          <Input
            id="thresholdComment"
            name="thresholdComment"
            value={globalComment}
            onChange={(e) => setGlobalComment(e.target.value)}
            placeholder='Default: "threshold testing and adjustment"'
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
          <div className="pt-1.5">
            <p className="text-[14px]">Per category monthly thresholds &amp; reasons</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
              Each month keeps a historical record of the last threshold set in that month (or carries forward your
              previous month&apos;s threshold if unchanged). Add an optional comment whenever you adjust a category.
            </p>
          </div>

          <ul className="flex max-w-[780px] flex-col divide-y divide-border/60 rounded-xl border border-border bg-card px-3.5 py-1">
            {p.categories.map((c) => {
              const isChanged = (overrides[c.id] ?? "") !== c.override;
              return (
                <li key={c.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[180px] flex-1">
                      <label htmlFor={`cat_${c.id}`} className="flex items-center gap-2 text-[13.5px] font-medium">
                        <Dot color={c.color} />
                        <span className="truncate">{c.name}</span>
                      </label>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        Avg: ${c.avgMonthly ?? "0"}/mo · This mo: ${c.currentMonth ?? "0"}
                        {c.lastMonth && c.lastMonth !== "0" ? ` · Last mo: $${c.lastMonth}` : ""}
                      </p>
                      {c.latestComment ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Current note: <span className="italic">&ldquo;{c.latestComment}&rdquo;</span>
                          {c.latestUpdatedAt ? ` (${c.latestUpdatedAt})` : ""}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      {c.suggested && (
                        <button
                          type="button"
                          onClick={() => applySingleSuggestion(c)}
                          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/40 px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          title='Apply suggested threshold and set comment to "according to suggestion"'
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
                        onChange={(e) => {
                          const val = e.target.value;
                          setOverrides((prev) => ({ ...prev, [c.id]: val }));
                          setSources((prev) => ({ ...prev, [c.id]: "manual" }));
                        }}
                        placeholder={p.alertThreshold}
                        className="tabular h-8 w-24 text-right text-[13px]"
                      />
                      <input type="hidden" name={`source_${c.id}`} value={sources[c.id] ?? "manual"} />
                    </div>
                  </div>

                  {/* Per-category optional comment input */}
                  <div className="flex items-center gap-2 pl-4">
                    <MessageSquareText className="size-3.5 shrink-0 text-muted-foreground" />
                    <Input
                      name={`comment_${c.id}`}
                      value={comments[c.id] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setComments((prev) => ({ ...prev, [c.id]: val }));
                      }}
                      placeholder={
                        isChanged
                          ? 'Reason for change (optional — defaults to "threshold testing and adjustment")'
                          : "Optional comment if changing this category's threshold..."
                      }
                      className="h-7 text-[12px] bg-muted/20"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Documented Threshold Change History */}
        {p.thresholdLogs && p.thresholdLogs.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6 pt-2">
            <div className="pt-1">
              <p className="flex items-center gap-1.5 text-[14px]">
                <History className="size-3.5 text-muted-foreground" />
                <span>Threshold change log</span>
              </p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                Historical log of every threshold change per month and its documented reason.
              </p>
            </div>

            <div className="max-w-[780px] overflow-x-auto rounded-xl border border-border bg-card p-3.5">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 font-medium">Month</th>
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 font-medium text-right">Change</th>
                    <th className="pb-2 pl-3 font-medium">Comment / Reason</th>
                    <th className="pb-2 text-right font-medium">Recorded At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {p.thresholdLogs.slice(0, 15).map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 pr-2 font-medium tabular">{log.monthKey}</td>
                      <td className="py-2 pr-2">{log.categoryName}</td>
                      <td className="py-2 px-2 text-right tabular">
                        {log.previousMinor !== null ? (
                          <span className="text-muted-foreground">
                            ${Math.round(log.previousMinor / 100)} &rarr;{" "}
                          </span>
                        ) : null}
                        <strong className="text-foreground">${Math.round(log.amountMinor / 100)}</strong>
                      </td>
                      <td className="py-2 pl-3">
                        <Tag color={log.comment === "according to suggestion" ? "blue" : "gray"}>
                          {log.comment}
                        </Tag>
                      </td>
                      <td className="py-2 pl-2 text-right text-muted-foreground tabular">
                        {log.changedAtFormatted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
