"use client";

import { useState, useTransition } from "react";
import { CheckCheck, Sparkles, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/app/tag";
import { Money } from "@/components/app/money";
import { formatInZone } from "@/lib/time";
import { REVIEW_REASONS, parseJsonArray, type ReviewReason } from "@/lib/domain";
import { confirmPurpose, confirmAllAsPersonal } from "./actions";

export type PendingTx = {
  id: string;
  occurredAt: Date;
  datePrecision: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  description: string | null;
  location: string | null;
  type: string;
  reviewReasons: string;
  categoryId: string | null;
  subcategoryId: string | null;
  category: { name: string; color: string } | null;
  source: { name: string };
  purpose: { name: string; color: string } | null;
};

export type PurposeOption = {
  id: string;
  name: string;
  color: string;
  shortcutKey: string | null;
};

type CategoryOption = { id: string; name: string; children: { id: string; name: string }[] };

export function ReviewInbox({
  initialTransactions,
  purposes,
  categories,
  zone,
}: {
  initialTransactions: PendingTx[];
  purposes: PurposeOption[];
  categories: CategoryOption[];
  zone: string;
}) {
  const [items, setItems] = useState(initialTransactions);
  const [rememberRules, setRememberRules] = useState<Record<string, boolean>>({});
  const [classifications, setClassifications] = useState<Record<string, { categoryId: string; subcategoryId: string | null }>>({});
  const [pending, startTransition] = useTransition();

  const handleConfirm = (txId: string, purposeId: string, merchant: string) => {
    const saveRule = !!rememberRules[txId];
    startTransition(async () => {
      const selection = classifications[txId];
      const res = await confirmPurpose({ transactionId: txId, purposeId, saveRule, ...selection });
      if (res.ok) {
        setClassifications((prev) => {
          const next = { ...prev };
          delete next[txId];
          return next;
        });
        setItems((prev) => prev.filter((i) => i.id !== txId));
        toast.success(`Confirmed ${merchant} ${saveRule ? "(rule saved)" : ""}`);
      } else {
        toast.error(res.error || "Failed");
      }
    });
  };

  const handleConfirmAll = () => {
    if (!confirm("Confirm all pending transactions as Personal?")) return;
    startTransition(async () => {
      const res = await confirmAllAsPersonal();
      if (res.ok) {
        setItems([]);
        toast.success(res.ok);
      } else {
        toast.error(res.error || "Failed");
      }
    });
  };

  const toggleRemember = (txId: string) => {
    setRememberRules((prev) => ({ ...prev, [txId]: !prev[txId] }));
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="size-6" />
        </div>
        <h3 className="text-[16px] font-semibold">All caught up!</h3>
        <p className="text-[13.5px] text-muted-foreground max-w-sm">
          No transactions need confirmation right now. As new notifications pop out on your iPhone, they will appear
          here if ambiguous or over your review limit.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-foreground">
            {items.length} transaction{items.length === 1 ? "" : "s"} waiting
          </span>
          <span className="text-[12px] text-muted-foreground">· One tap to confirm</span>
        </div>

        <Button variant="outline" size="sm" onClick={handleConfirmAll} disabled={pending || Object.keys(classifications).length > 0} className="gap-1.5 min-h-11">
          <CheckCheck className="size-3.5" />
          Confirm all as Personal
        </Button>
      </div>

      <div className="flex flex-col gap-3.5">
        {items.map((tx) => {
          const reasons = parseJsonArray(tx.reviewReasons);
          const remember = rememberRules[tx.id] ?? false;
          const selection = classifications[tx.id] ?? {
            categoryId: tx.categoryId ?? "", subcategoryId: tx.subcategoryId,
          };
          const selectedCategory = categories.find((c) => c.id === selection.categoryId);

          return (
            <div
              key={tx.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-all hover:border-border/80"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-foreground">{tx.merchant}</span>
                    {tx.category ? <Tag color={tx.category.color}>{tx.category.name}</Tag> : <Tag>Uncategorised</Tag>}
                    <span className="text-[12px] text-muted-foreground">· {tx.source.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span>{formatInZone(tx.occurredAt, "EEE d MMM, HH:mm", zone)}</span>
                    {tx.description ? <span>· {tx.description}</span> : null}
                    {reasons.length > 0 ? (
                      <span className="text-[var(--dot-red)]">
                        (
                        {reasons.map((r) => REVIEW_REASONS[r as ReviewReason] ?? r).join(", ")}
                        )
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[16px] font-semibold">
                    <Money minor={tx.amountMinor} currency={tx.currency} type={tx.type} />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor={`category-${tx.id}`} className="text-[12px] font-medium text-muted-foreground">
                  Category
                </label>
                <select
                  id={`category-${tx.id}`}
                  value={selection.categoryId}
                  disabled={pending}
                  onChange={(event) => setClassifications((prev) => ({
                    ...prev, [tx.id]: { categoryId: event.target.value, subcategoryId: null },
                  }))}
                  className="min-h-11 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Uncategorised</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {selectedCategory && selectedCategory.children.length > 0 ? (
                  <fieldset className="min-w-0">
                    <legend className="mb-1 text-[12px] text-muted-foreground">Subcategory (optional)</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {[{ id: "", name: "Not specified" }, ...selectedCategory.children].map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          disabled={pending}
                          aria-pressed={(selection.subcategoryId ?? "") === child.id}
                          onClick={() => setClassifications((prev) => ({
                            ...prev, [tx.id]: { ...selection, subcategoryId: child.id || null },
                          }))}
                          className="min-h-11 rounded-md border border-border px-3 text-[12.5px] transition-colors aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:font-semibold focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          {child.name}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
                <p className="text-[12px] text-muted-foreground">Choose a purpose below to save. Subcategory can be left unspecified.</p>
              </div>

              {/* Purpose Selection Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-medium text-muted-foreground mr-1">Choose Purpose:</span>
                  {purposes.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={pending}
                      onClick={() => handleConfirm(tx.id, p.id, tx.merchant)}
                      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-medium transition-all hover:scale-105 active:scale-95"
                      style={{
                        background: `var(--tag-${p.color}-bg)`,
                        color: `var(--tag-${p.color}-fg)`,
                      }}
                    >
                      {p.name}
                      {p.shortcutKey ? <span className="opacity-60 text-[10.5px]">[{p.shortcutKey}]</span> : null}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={() => toggleRemember(tx.id)}
                    className="rounded border-border text-primary focus:ring-0"
                  />
                  <Sparkles className="size-3 text-warning" />
                  <span>Remember rule for {tx.merchant}</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
