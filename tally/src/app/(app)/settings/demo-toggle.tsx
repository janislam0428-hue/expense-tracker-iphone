"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setDemoData } from "./actions";

export function DemoToggle({ enabled, realCount }: { enabled: boolean; realCount: number }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="max-w-[520px]">
        <label htmlFor="demo-switch" className="text-[14px]">
          Show demo data
        </label>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
          Two years of sample Hong Kong spending, including seasonal patterns, so every chart and forecast can be seen working.
          Demo rows are kept separate and never mix with your {realCount > 0 ? `${realCount.toLocaleString("en-HK")} real transactions` : "real data"}.
          {pending ? " Working…" : ""}
        </p>
      </div>
      <Switch
        id="demo-switch"
        checked={on}
        disabled={pending}
        onCheckedChange={(next) => {
          setOn(next);
          start(async () => {
            const r = await setDemoData(next);
            if (r?.ok) toast.success(r.ok);
            if (r?.error) {
              toast.error(r.error);
              setOn(!next);
            }
          });
        }}
      />
    </div>
  );
}
