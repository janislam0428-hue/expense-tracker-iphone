"use client";

import { useState, useTransition } from "react";
import { KeyRound, Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateApiToken } from "./actions";

export function ApiTokenCard({ hasExistingToken }: { hasExistingToken: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleGenerate = () => {
    if (hasExistingToken && !confirm("Generate a new API token? Your existing iPhone Shortcut will need to be updated.")) {
      return;
    }
    startTransition(async () => {
      const res = await generateApiToken();
      if (res.token) {
        setToken(res.token);
        toast.success("Generated new API token. Copy it now!");
      } else {
        toast.error(res.error || "Failed to generate token");
      }
    });
  };

  const copyToken = () => {
    if (!token) return;
    navigator.clipboard.writeText(token);
    setCopied(true);
    toast.success("Token copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3 max-w-[560px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[14px]">iPhone Webhook Token</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
            Authorizes your iPhone 14 Pro Shortcut to send notification records to{" "}
            <code className="rounded bg-muted px-1 font-mono text-[12px]">POST /api/ingest</code> without logging in.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={handleGenerate}
          className="shrink-0 gap-1.5"
        >
          <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
          {hasExistingToken || token ? "Regenerate" : "Generate Token"}
        </Button>
      </div>

      {token ? (
        <div className="flex items-center gap-2 rounded-md border border-[var(--primary)] bg-primary/5 p-3">
          <KeyRound className="size-4 text-primary shrink-0" />
          <code className="flex-1 font-mono text-[12px] truncate select-all">{token}</code>
          <Button type="button" variant="ghost" size="sm" onClick={copyToken} className="h-7 px-2">
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            <span className="text-[11.5px]">{copied ? "Copied" : "Copy"}</span>
          </Button>
        </div>
      ) : hasExistingToken ? (
        <div className="text-[12.5px] text-muted-foreground bg-muted/50 p-2.5 rounded-md">
          A token is currently active. For security, raw tokens are not stored. If you forgot your token, tap Regenerate above.
        </div>
      ) : (
        <div className="text-[12.5px] text-muted-foreground bg-muted/50 p-2.5 rounded-md">
          No custom token generated yet. The default fallback token is{" "}
          <code className="font-mono text-foreground">tally_secret_token</code>.
        </div>
      )}
    </div>
  );
}
