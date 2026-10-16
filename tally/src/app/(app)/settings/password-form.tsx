"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword, type FormState } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      ref.current?.reset();
    }
  }, [state]);
  return (
    <form ref={ref} action={action} className="grid max-w-[320px] gap-3">
      {[
        { id: "current", label: "Current password", auto: "current-password" },
        { id: "next", label: "New password", auto: "new-password" },
        { id: "confirm", label: "Repeat new password", auto: "new-password" },
      ].map((f) => (
        <div key={f.id} className="grid gap-1.5">
          <Label htmlFor={`pw-${f.id}`} className="text-[13px] font-normal text-muted-foreground">
            {f.label}
          </Label>
          <Input id={`pw-${f.id}`} name={f.id} type="password" autoComplete={f.auto} required />
        </div>
      ))}
      {state?.error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}
