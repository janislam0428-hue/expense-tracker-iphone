"use client";

import { useState, useTransition } from "react";
import { Check, CheckCheck, Sparkles, Inbox, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tag } from "@/components/app/tag";
import { Money } from "@/components/app/money";
import { normalizeMerchant } from "@/lib/text";
import { formatInZone } from "@/lib/time";
import { REVIEW_REASONS, parseJsonArray, type ReviewReason } from "@/lib/domain";
import { confirmPurpose, confirmAllAsPersonal, deletePendingTransaction } from "./actions";

function cleanOcrMerchantName(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/^[•·▪▫◦●○■□▲△▼▽◆◇★☆⊕⊗⊙⊚⊛⊜⊝⊞⊟⊠⊡]+\s*/u, "")
    .replace(
      /^(?:[印日目甲由申田口回囚四皿且貝見頁車凸凹尚向同团因固國圖片币巾中内肉門間問開関]\s+|[印日目甲由申田口回囚四皿且貝見頁凸凹](?=[A-Za-z]))/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeMerchantKey(input: string): string {
  return normalizeMerchant(cleanOcrMerchantName(input))
    .replace(/^(?:cup|visa|master|mastercard|amex|unionpay)\s+/i, "")
    .replace(/^(?:kpay|bbmsl|qfpay|yedpay|stripe|sq|paypal|alipay|wechat|shopify|adyen)\s+/i, "")
    .replace(/\b(?:group\s+limited|holdings?\s+limited|company\s+limited|co\s+ltd|limited|ltd|inc|corp|corporation)\b/g, " ")
    .replace(/\bwel+come\b/g, "wellcome")
    .replace(/\bminibuses\b/g, "minibus")
    .replace(/\bbuses\b/g, "bus")
    .replace(/\s+/g, " ")
    .trim();
}

function doesMerchantMatchRule(merchant: string, rulePattern: string): boolean {
  const normMerchant = normalizeMerchant(cleanOcrMerchantName(merchant));
  const normRule = normalizeMerchant(cleanOcrMerchantName(rulePattern));
  if (!normMerchant || !normRule) return false;
  if (normMerchant.includes(normRule) || (normRule.length >= 3 && normRule.includes(normMerchant))) {
    return true;
  }
  const canonMerchant = canonicalizeMerchantKey(merchant);
  const canonRule = canonicalizeMerchantKey(rulePattern);
  if (!canonMerchant || !canonRule) return false;
  return canonMerchant.includes(canonRule) || (canonRule.length >= 3 && canonRule.includes(canonMerchant));
}

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
  purpose?: { name: string; color: string } | null;
};

export type PurposeOption = {
  id: string;
  name: string;
  color: string;
  shortcutKey: string | null;
};

type CategoryOption = { id: string; name: string; color?: string; children: { id: string; name: string }[] };

type DraftEdits = {
  merchant: string;
  amount: string;
  occurredAt: string;
  description: string;
};

export function ReviewInbox({
  initialTransactions,
  categories,
  zone,
}: {
  initialTransactions: PendingTx[];
  purposes?: PurposeOption[];
  categories: CategoryOption[];
  zone: string;
}) {
  const [items, setItems] = useState(initialTransactions);
  const [rememberRules, setRememberRules] = useState<Record<string, boolean>>({});
  const [classifications, setClassifications] = useState<
    Record<string, { categoryId: string; subcategoryId: string | null }>
  >({});
  const [editingIds, setEditingIds] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, DraftEdits>>({});
  const [pending, startTransition] = useTransition();

  const toggleEdit = (tx: PendingTx) => {
    const isCurrentlyOpen = !!editingIds[tx.id];
    if (!isCurrentlyOpen && !edits[tx.id]) {
      setEdits((prev) => ({
        ...prev,
        [tx.id]: {
          merchant: tx.merchant,
          amount: (tx.amountMinor / 100).toFixed(2),
          occurredAt: formatInZone(tx.occurredAt, "yyyy-MM-dd'T'HH:mm", zone),
          description: [tx.location, tx.description].filter(Boolean).join(" · "),
        },
      }));
    }
    setEditingIds((prev) => ({ ...prev, [tx.id]: !isCurrentlyOpen }));
  };

  const updateEditField = (txId: string, field: keyof DraftEdits, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [txId]: {
        ...(prev[txId] ?? { merchant: "", amount: "", occurredAt: "", description: "" }),
        [field]: value,
      },
    }));
  };

  const syncAndApplyRuleAcrossMatching = (
    sourceTx: PendingTx,
    categoryId: string,
    subcategoryId: string | null,
  ) => {
    const sourceMerchant = edits[sourceTx.id]?.merchant?.trim() || sourceTx.merchant;
    const matchedCat = categories.find((c) => c.id === categoryId);

    setClassifications((prev) => {
      const next = { ...prev };
      for (const item of items) {
        const itemMerchant = edits[item.id]?.merchant?.trim() || item.merchant;
        if (item.id === sourceTx.id || doesMerchantMatchRule(itemMerchant, sourceMerchant)) {
          next[item.id] = { categoryId, subcategoryId };
        }
      }
      return next;
    });

    if (matchedCat) {
      setItems((prev) =>
        prev.map((item) => {
          const itemMerchant = edits[item.id]?.merchant?.trim() || item.merchant;
          if (item.id === sourceTx.id || doesMerchantMatchRule(itemMerchant, sourceMerchant)) {
            return {
              ...item,
              categoryId,
              subcategoryId,
              category: { name: matchedCat.name, color: matchedCat.color ?? "blue" },
            };
          }
          return item;
        }),
      );
    }

    startTransition(async () => {
      const res = await confirmPurpose({
        transactionId: sourceTx.id,
        merchant: sourceMerchant,
        categoryId,
        subcategoryId,
        saveRule: true,
        ruleOnly: true,
      });
      if (res.ok) {
        toast.success(res.ok);
      } else if (res.error) {
        toast.error(res.error);
      }
    });
  };

  const handleConfirm = (tx: PendingTx) => {
    const txId = tx.id;
    const saveRule = !!rememberRules[txId];
    const draft = edits[txId];
    const displayMerchant = draft?.merchant?.trim() || tx.merchant;

    startTransition(async () => {
      const selection = classifications[txId] ?? {
        categoryId: tx.categoryId ?? undefined,
        subcategoryId: tx.subcategoryId,
      };
      const res = await confirmPurpose({
        transactionId: txId,
        saveRule,
        ...selection,
        ...(draft
          ? {
              merchant: draft.merchant,
              amount: draft.amount,
              occurredAt: draft.occurredAt,
              description: draft.description,
            }
          : {}),
      });
      if (res.ok) {
        const removedIds = new Set([txId, ...(res.autoConfirmedIds ?? [])]);
        setClassifications((prev) => {
          const next = { ...prev };
          for (const id of removedIds) {
            delete next[id];
          }
          return next;
        });
        setItems((prev) => prev.filter((i) => !removedIds.has(i.id)));

        const extraConfirmed = res.autoConfirmedIds?.length ?? 0;
        const extraUpdated = res.autoUpdatedCount ?? 0;
        if (extraConfirmed > 0) {
          toast.success(
            `Confirmed ${displayMerchant} & auto-confirmed ${extraConfirmed} matching transaction${extraConfirmed === 1 ? "" : "s"}`,
          );
        } else if (saveRule && extraUpdated > 0) {
          toast.success(
            `Confirmed ${displayMerchant} & categorized ${extraUpdated} matching transaction${extraUpdated === 1 ? "" : "s"}`,
          );
        } else {
          toast.success(`Confirmed ${displayMerchant}${saveRule ? " (rule saved)" : ""}`);
        }
      } else {
        toast.error(res.error || "Failed");
      }
    });
  };

  const handleDelete = (txId: string, merchant: string) => {
    startTransition(async () => {
      const res = await deletePendingTransaction(txId);
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== txId));
        toast.success(`Deleted ${merchant}`);
      } else {
        toast.error(res.error || "Could not delete");
      }
    });
  };

  const handleConfirmAll = () => {
    if (!confirm("Confirm all pending transactions with their current categories?")) return;
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

  const toggleRemember = (tx: PendingTx) => {
    const nextChecked = !rememberRules[tx.id];
    setRememberRules((prev) => ({ ...prev, [tx.id]: nextChecked }));

    if (nextChecked) {
      const currentSelection = classifications[tx.id] ?? {
        categoryId: tx.categoryId ?? "",
        subcategoryId: tx.subcategoryId,
      };
      if (currentSelection.categoryId) {
        syncAndApplyRuleAcrossMatching(tx, currentSelection.categoryId, currentSelection.subcategoryId);
      }
    }
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
          <span className="text-[12px] text-muted-foreground">· Edit, delete, or confirm</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleConfirmAll}
          disabled={pending}
          className="gap-1.5 min-h-11"
        >
          <CheckCheck className="size-3.5" />
          Confirm all
        </Button>
      </div>

      <div className="flex flex-col gap-3.5">
        {items.map((tx) => {
          const reasons = parseJsonArray(tx.reviewReasons);
          const remember = rememberRules[tx.id] ?? false;
          const isEditing = !!editingIds[tx.id];
          const draft = edits[tx.id];
          const selection = classifications[tx.id] ?? {
            categoryId: tx.categoryId ?? "",
            subcategoryId: tx.subcategoryId,
          };
          const selectedCategory = categories.find((c) => c.id === selection.categoryId);
          const displayMerchant = draft?.merchant || tx.merchant;

          return (
            <div
              key={tx.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-all hover:border-border/80"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-foreground">{displayMerchant}</span>
                    {selectedCategory ? (
                      <Tag color={selectedCategory.color ?? tx.category?.color ?? "blue"}>
                        {selectedCategory.name}
                      </Tag>
                    ) : tx.category ? (
                      <Tag color={tx.category.color}>{tx.category.name}</Tag>
                    ) : (
                      <Tag>Uncategorised</Tag>
                    )}
                    <span className="text-[12px] text-muted-foreground">· {tx.source.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span>{formatInZone(tx.occurredAt, "EEE d MMM, HH:mm", zone)}</span>
                    {tx.location ? <span>· {tx.location}</span> : null}
                    {tx.description ? <span>· {tx.description}</span> : null}
                    {reasons.length > 0 ? (
                      <span className="text-[var(--dot-red)]">
                        ({reasons.map((r) => REVIEW_REASONS[r as ReviewReason] ?? r).join(", ")})
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-right">
                  <div className="text-[16px] font-semibold">
                    <Money
                      minor={
                        draft?.amount && !Number.isNaN(parseFloat(draft.amount))
                          ? Math.round(parseFloat(draft.amount) * 100)
                          : tx.amountMinor
                      }
                      currency={tx.currency}
                      type={tx.type}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleEdit(tx)}
                    className="h-8 px-2 text-muted-foreground hover:text-foreground"
                    title="Edit name, time, amount, or details"
                  >
                    {isEditing ? <X className="size-4" /> : <Pencil className="size-3.5" />}
                    <span className="ml-1 text-[12px]">{isEditing ? "Close" : "Edit"}</span>
                  </Button>
                </div>
              </div>

              {isEditing && draft && (
                <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`merchant-${tx.id}`} className="text-[12px] text-muted-foreground">
                      Detected Name / Merchant
                    </Label>
                    <Input
                      id={`merchant-${tx.id}`}
                      value={draft.merchant}
                      onChange={(e) => updateEditField(tx.id, "merchant", e.target.value)}
                      placeholder="e.g. Bus, MTR, 7-Eleven"
                      className="h-9 bg-background"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`amount-${tx.id}`} className="text-[12px] text-muted-foreground">
                      Amount ({tx.currency})
                    </Label>
                    <Input
                      id={`amount-${tx.id}`}
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(e) => updateEditField(tx.id, "amount", e.target.value)}
                      placeholder="e.g. 8.20"
                      className="h-9 bg-background"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`time-${tx.id}`} className="text-[12px] text-muted-foreground">
                      Date &amp; Time
                    </Label>
                    <Input
                      id={`time-${tx.id}`}
                      type="datetime-local"
                      value={draft.occurredAt}
                      onChange={(e) => updateEditField(tx.id, "occurredAt", e.target.value)}
                      className="h-9 bg-background"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`detail-${tx.id}`} className="text-[12px] text-muted-foreground">
                      Detail / Location / Notes
                    </Label>
                    <Input
                      id={`detail-${tx.id}`}
                      value={draft.description}
                      onChange={(e) => updateEditField(tx.id, "description", e.target.value)}
                      placeholder="Optional note or station"
                      className="h-9 bg-background"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label htmlFor={`category-${tx.id}`} className="text-[12px] font-medium text-muted-foreground">
                  Category
                </label>
                <select
                  id={`category-${tx.id}`}
                  value={selection.categoryId}
                  disabled={pending}
                  onChange={(event) => {
                    const nextCatId = event.target.value;
                    setClassifications((prev) => ({
                      ...prev,
                      [tx.id]: { categoryId: nextCatId, subcategoryId: null },
                    }));
                    if (remember && nextCatId) {
                      syncAndApplyRuleAcrossMatching(tx, nextCatId, null);
                    }
                  }}
                  className="min-h-11 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
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
                          onClick={() => {
                            const nextSubId = child.id || null;
                            setClassifications((prev) => ({
                              ...prev,
                              [tx.id]: { ...selection, subcategoryId: nextSubId },
                            }));
                            if (remember && selection.categoryId) {
                              syncAndApplyRuleAcrossMatching(tx, selection.categoryId, nextSubId);
                            }
                          }}
                          className="min-h-11 rounded-md border border-border px-3 text-[12.5px] transition-colors aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:font-semibold focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          {child.name}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/50">
                <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={() => toggleRemember(tx)}
                    className="rounded border-border text-primary focus:ring-0"
                  />
                  <Sparkles className="size-3 text-warning" />
                  <span>Remember rule for {displayMerchant}</span>
                </label>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => handleDelete(tx.id, displayMerchant)}
                    className="gap-1.5 min-h-10 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() => handleConfirm(tx)}
                    className="gap-1.5 min-h-10 px-4"
                  >
                    <Check className="size-4" />
                    Confirm
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
