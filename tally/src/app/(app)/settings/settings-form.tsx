"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dot } from "@/components/app/tag";
import { saveSettings, type FormState } from "./actions";
import { CURRENCIES, TIMEZONES } from "./options";

type Props = {
  currency: string;
  timezone: string;
  weekStart: number;
  reviewThreshold: string;
  alertThreshold: string;
  categories: Array<{ id: string; name: string; color: string; override: string }>;
};

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
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
  useEffect(() => {
    if (state?.ok) toast.success(state.ok);
    if (state?.error) toast.error(state.error);
  }, [state]);

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

      <section aria-labelledby="flags" className="flex flex-col gap-5">
        <h2 id="flags" className="border-b border-border pb-2 text-[15px] font-medium">
          Flags and alerts
        </h2>
        <Field
          label="Ask me to confirm above"
          hint="Any transaction above this amount goes to To confirm, whatever its category"
          htmlFor="reviewThreshold"
        >
          <Input id="reviewThreshold" name="reviewThreshold" inputMode="decimal" defaultValue={p.reviewThreshold} className="tabular" />
        </Field>
        <Field
          label="Monthly category alert"
          hint="A category above this in a calendar month shows up as a highlight"
          htmlFor="alertThreshold"
        >
          <Input id="alertThreshold" name="alertThreshold" inputMode="decimal" defaultValue={p.alertThreshold} className="tabular" />
        </Field>
        <div className="grid gap-1.5 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
          <div className="pt-1.5">
            <p className="text-[14px]">Per category alerts</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">Leave blank to use the monthly default</p>
          </div>
          <ul className="grid max-w-[560px] gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {p.categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <label htmlFor={`cat_${c.id}`} className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px]">
                  <Dot color={c.color} />
                  <span className="truncate">{c.name}</span>
                </label>
                <Input
                  id={`cat_${c.id}`}
                  name={`cat_${c.id}`}
                  inputMode="decimal"
                  defaultValue={c.override}
                  placeholder={p.alertThreshold}
                  className="tabular h-7 w-24 text-right text-[13px]"
                />
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
