"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, Smartphone, Check, Copy, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tag } from "@/components/app/tag";
import { Money } from "@/components/app/money";
import { previewNotificationText, importNotificationRecords, type PastePreviewState } from "./actions";

export function ImportClient({ apiToken }: { apiToken: string }) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"paste" | "shortcut">("paste");

  const [previewState, previewAction, previewPending] = useActionState<PastePreviewState, FormData>(
    previewNotificationText,
    undefined,
  );

  const [importState, importAction, importPending] = useActionState<
    { ok?: string; error?: string } | undefined,
    FormData
  >(importNotificationRecords, undefined);

  useEffect(() => {
    if (importState?.ok) {
      toast.success(importState.ok);
    }
    if (importState?.error) {
      toast.error(importState.error);
    }
  }, [importState]);

  const copyWebhookInfo = () => {
    const text = `URL: /api/ingest\nAuthorization: Bearer ${apiToken}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Webhook config copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setTab("paste")}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors ${
            tab === "paste"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-hover hover:text-foreground"
          }`}
        >
          <ClipboardPaste className="size-4" />
          Paste Notification Text
        </button>
        <button
          type="button"
          onClick={() => setTab("shortcut")}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors ${
            tab === "shortcut"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-hover hover:text-foreground"
          }`}
        >
          <Smartphone className="size-4" />
          iPhone 14 Pro Shortcut Setup
        </button>
      </div>

      {tab === "paste" && (
        <div className="flex flex-col gap-5">
          <form action={previewAction} className="flex flex-col gap-3">
            <p className="text-[13.5px] text-muted-foreground">
              Paste notification pop-out records or bank SMS from your iPhone 14 Pro (Octopus, PayMe, Hang Seng, HSBC,
              Mox, etc.).
            </p>
            <Textarea
              name="text"
              rows={4}
              placeholder={`Example:\nOctopus: Paid HK$8.70 at KMB Bus. Remaining balance HK$350.20\nYou've paid HK$150.00 to Karen Chan.`}
              defaultValue={previewState?.rawText ?? ""}
              className="font-mono text-[13px]"
            />
            {previewState?.error ? (
              <p className="text-[13px] text-destructive">{previewState.error}</p>
            ) : null}
            <div>
              <Button type="submit" disabled={previewPending}>
                {previewPending ? <Loader2 className="animate-spin" /> : null}
                Parse & Preview
              </Button>
            </div>
          </form>

          {previewState?.ok && previewState.parsedList && previewState.parsedList.length > 0 && (
            <div className="rounded-lg border border-border p-4 bg-muted/30 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[14.5px] font-medium">
                  Detected {previewState.parsedList.length} Transaction(s)
                </h3>
                <span className="text-[12px] text-muted-foreground">0 API credits used (Local Parser)</span>
              </div>

              <div className="divide-y divide-border">
                {previewState.parsedList.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2 text-[13.5px]">
                    <div className="flex items-center gap-2.5">
                      <span className="font-medium text-foreground">{item.merchant}</span>
                      <Tag color="gray">{item.sourceName}</Tag>
                      {item.isPersonToPerson ? <Tag color="pink">P2P</Tag> : null}
                      {item.type !== "expense" ? <Tag color="blue">{item.type}</Tag> : null}
                    </div>
                    <div className="text-right">
                      <Money minor={item.amountMinor} currency={item.currency} type={item.type} />
                      {item.balanceAfterMinor ? (
                        <div className="text-[11px] text-muted-foreground">
                          Bal: ${(item.balanceAfterMinor / 100).toFixed(2)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <form action={importAction}>
                <input type="hidden" name="rawText" value={previewState.rawText ?? ""} />
                <Button type="submit" disabled={importPending}>
                  {importPending ? <Loader2 className="animate-spin" /> : null}
                  Confirm & Import to Tally
                </Button>
              </form>
            </div>
          )}
        </div>
      )}

      {tab === "shortcut" && (
        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-border p-4 bg-card flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-semibold">Your iPhone Webhook Credentials</h3>
                <p className="text-[13px] text-muted-foreground">
                  Use these in your iPhone 14 Pro Shortcuts app to send notifications directly to Tally.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={copyWebhookInfo}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy Details"}
              </Button>
            </div>

            <div className="grid gap-2 text-[13px] font-mono bg-muted p-3 rounded-md">
              <div>
                <span className="text-muted-foreground">Endpoint: </span>
                <span className="text-foreground font-semibold">POST /api/ingest</span>
              </div>
              <div>
                <span className="text-muted-foreground">Header: </span>
                <span className="text-foreground">Authorization: Bearer {apiToken}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Body Format (JSON): </span>
                <span className="text-foreground">{`{ "text": "<Notification Text>" }`}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-[15px] font-medium">How It Works On iPhone 14 Pro (Zero Credits)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-4 flex flex-col gap-2">
                <span className="text-[12px] font-semibold text-primary uppercase tracking-wide">Method 1 · Automatic</span>
                <h4 className="text-[14.5px] font-medium">Apple Wallet Automation</h4>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  For Octopus or credit cards in Apple Wallet. Whenever you tap or spend, iOS Shortcuts triggers automatically in the background and sends the transaction directly to Tally with 0 taps.
                </p>
              </div>

              <div className="rounded-lg border border-border p-4 flex flex-col gap-2">
                <span className="text-[12px] font-semibold text-primary uppercase tracking-wide">Method 2 · Instant</span>
                <h4 className="text-[14.5px] font-medium">Back Tap on Notification</h4>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  When a PayMe or bank notification banner pops out, double-tap the back of your iPhone 14 Pro. The shortcut runs on-device Apple OCR (0 API credits), extracts the text, and posts to Tally instantly.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
