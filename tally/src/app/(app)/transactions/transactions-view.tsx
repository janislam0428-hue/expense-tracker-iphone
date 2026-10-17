"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TxListHeader, TxRow, type TxRowData } from "@/components/app/tx-row";
import { formatInZone } from "@/lib/time";
import { addTransaction, updateTransaction, deleteTransaction } from "./actions";

type Option = { id: string; name: string };
type CategoryOption = { id: string; name: string; children?: Option[] };

export function TransactionsView({
  initialTransactions,
  categories,
  sources,
  zone,
  currency,
}: {
  initialTransactions: TxRowData[];
  categories: CategoryOption[];
  sources: Option[];
  purposes?: Option[];
  zone: string;
  currency: string;
}) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<TxRowData | null>(null);

  const [modalCategoryId, setModalCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [modalSubcategoryId, setModalSubcategoryId] = useState<string>("none");
  const [pending, startTransition] = useTransition();

  const activeModalCategory = categories.find((c) => c.id === modalCategoryId);
  const modalSubcategories = activeModalCategory?.children ?? [];

  const openAddModal = () => {
    setModalCategoryId(categories[0]?.id ?? "");
    setModalSubcategoryId("none");
    setIsAddOpen(true);
  };

  const openEditModal = (tx: TxRowData) => {
    setModalCategoryId(tx.categoryId ?? "none");
    setModalSubcategoryId(tx.subcategoryId ?? "none");
    setEditingTx(tx);
  };

  const filtered = transactions.filter((t) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchMerchant = t.merchant.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q) ?? false;
      const matchNotes = t.notes?.toLowerCase().includes(q) ?? false;
      const matchSub = t.subcategory?.name.toLowerCase().includes(q) ?? false;
      if (!matchMerchant && !matchDesc && !matchNotes && !matchSub) return false;
    }
    if (selectedCat !== "all") {
      if (t.category?.name !== selectedCat) return false;
    }
    if (selectedSource !== "all") {
      if (t.source.name !== selectedSource) return false;
    }
    return true;
  });

  const handleDelete = (id: string, merchant: string) => {
    if (!confirm(`Delete transaction for ${merchant}?`)) return;
    startTransition(async () => {
      const res = await deleteTransaction(id);
      if (res?.ok) {
        setTransactions((prev) => prev.filter((t) => t.id !== id));
        toast.success(res.ok);
      } else if (res?.error) {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Controls Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1 sm:max-w-[280px]">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              placeholder="Search merchant or notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>

          <Select value={selectedCat} onValueChange={setSelectedCat}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedSource} onValueChange={setSelectedSource}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(search || selectedCat !== "all" || selectedSource !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setSelectedCat("all");
                setSelectedSource("all");
              }}
              className="text-muted-foreground text-[12.5px]"
            >
              Reset
            </Button>
          )}
        </div>

        <Button onClick={openAddModal} className="h-9 gap-1.5 shrink-0">
          <Plus className="size-4" />
          Add transaction
        </Button>
      </div>

      {/* Add Transaction Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-[420px] rounded-xl border border-border bg-background p-5 shadow-xl animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-[16px] font-semibold">New Transaction</h3>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <form
              action={async (formData) => {
                if (modalCategoryId && modalCategoryId !== "none") {
                  formData.set("categoryId", modalCategoryId);
                } else {
                  formData.delete("categoryId");
                }
                if (modalSubcategoryId && modalSubcategoryId !== "none") {
                  formData.set("subcategoryId", modalSubcategoryId);
                } else {
                  formData.delete("subcategoryId");
                }
                const res = await addTransaction(undefined, formData);
                if (res?.ok) {
                  toast.success(res.ok);
                  setIsAddOpen(false);
                  window.location.reload();
                } else if (res?.error) {
                  toast.error(res.error);
                }
              }}
              className="mt-4 flex flex-col gap-3.5"
            >
              <div className="grid gap-1">
                <Label htmlFor="merchant" className="text-[13px]">
                  Merchant / Payee *
                </Label>
                <Input id="merchant" name="merchant" required placeholder="e.g. Starbucks, KMB, Wellcome" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="amount" className="text-[13px]">
                    Amount ({currency}) *
                  </Label>
                  <Input id="amount" name="amount" required inputMode="decimal" placeholder="e.g. 48.00" />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="type" className="text-[13px]">
                    Type
                  </Label>
                  <Select name="type" defaultValue="expense">
                    <SelectTrigger id="type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="top_up">Top up</SelectItem>
                      <SelectItem value="refund">Refund</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-1">
                <Label htmlFor="occurredAt" className="text-[13px]">
                  Date &amp; Time
                </Label>
                <Input
                  id="occurredAt"
                  name="occurredAt"
                  type="datetime-local"
                  defaultValue={formatInZone(new Date(), "yyyy-MM-dd'T'HH:mm", zone)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="sourceId" className="text-[13px]">
                    Payment Source *
                  </Label>
                  <Select name="sourceId" defaultValue={sources[0]?.id}>
                    <SelectTrigger id="sourceId" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="categoryId" className="text-[13px]">
                    Category
                  </Label>
                  <Select
                    value={modalCategoryId}
                    onValueChange={(val) => {
                      setModalCategoryId(val);
                      setModalSubcategoryId("none");
                    }}
                  >
                    <SelectTrigger id="categoryId" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Uncategorised</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {modalSubcategories.length > 0 && (
                <div className="grid gap-1">
                  <Label htmlFor="subcategoryId" className="text-[13px]">
                    Subcategory (optional)
                  </Label>
                  <Select value={modalSubcategoryId} onValueChange={setModalSubcategoryId}>
                    <SelectTrigger id="subcategoryId" className="w-full">
                      <SelectValue placeholder="Not specified" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not specified</SelectItem>
                      {modalSubcategories.map((sub) => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-1">
                <Label htmlFor="notes" className="text-[13px]">
                  Details / Notes (optional)
                </Label>
                <Input id="notes" name="notes" placeholder="e.g. Lunch with colleagues" />
              </div>

              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save Transaction</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {editingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-[420px] rounded-xl border border-border bg-background p-5 shadow-xl animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-[16px] font-semibold">Edit Transaction</h3>
              <button
                type="button"
                onClick={() => setEditingTx(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <form
              action={async (formData) => {
                formData.set("id", editingTx.id);
                if (modalCategoryId && modalCategoryId !== "none") {
                  formData.set("categoryId", modalCategoryId);
                } else {
                  formData.delete("categoryId");
                }
                if (modalSubcategoryId && modalSubcategoryId !== "none") {
                  formData.set("subcategoryId", modalSubcategoryId);
                } else {
                  formData.delete("subcategoryId");
                }
                const res = await updateTransaction(undefined, formData);
                if (res?.ok) {
                  toast.success(res.ok);
                  setEditingTx(null);
                  window.location.reload();
                } else if (res?.error) {
                  toast.error(res.error);
                }
              }}
              className="mt-4 flex flex-col gap-3.5"
            >
              <div className="grid gap-1">
                <Label htmlFor="edit-merchant" className="text-[13px]">
                  Merchant / Name *
                </Label>
                <Input
                  id="edit-merchant"
                  name="merchant"
                  required
                  defaultValue={editingTx.merchant}
                  placeholder="e.g. Starbucks, Bus, MTR"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="edit-amount" className="text-[13px]">
                    Amount ({currency}) *
                  </Label>
                  <Input
                    id="edit-amount"
                    name="amount"
                    required
                    inputMode="decimal"
                    defaultValue={(editingTx.amountMinor / 100).toFixed(2)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="edit-type" className="text-[13px]">
                    Type
                  </Label>
                  <Select name="type" defaultValue={editingTx.type}>
                    <SelectTrigger id="edit-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="top_up">Top up</SelectItem>
                      <SelectItem value="refund">Refund</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-1">
                <Label htmlFor="edit-occurredAt" className="text-[13px]">
                  Date &amp; Time
                </Label>
                <Input
                  id="edit-occurredAt"
                  name="occurredAt"
                  type="datetime-local"
                  defaultValue={formatInZone(editingTx.occurredAt, "yyyy-MM-dd'T'HH:mm", zone)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="edit-sourceId" className="text-[13px]">
                    Payment Source *
                  </Label>
                  <Select
                    name="sourceId"
                    defaultValue={
                      editingTx.sourceId ??
                      sources.find((s) => s.name === editingTx.source.name)?.id ??
                      sources[0]?.id
                    }
                  >
                    <SelectTrigger id="edit-sourceId" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="edit-categoryId" className="text-[13px]">
                    Category
                  </Label>
                  <Select
                    value={modalCategoryId}
                    onValueChange={(val) => {
                      setModalCategoryId(val);
                      setModalSubcategoryId("none");
                    }}
                  >
                    <SelectTrigger id="edit-categoryId" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Uncategorised</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {modalSubcategories.length > 0 && (
                <div className="grid gap-1">
                  <Label htmlFor="edit-subcategoryId" className="text-[13px]">
                    Subcategory (optional)
                  </Label>
                  <Select value={modalSubcategoryId} onValueChange={setModalSubcategoryId}>
                    <SelectTrigger id="edit-subcategoryId" className="w-full">
                      <SelectValue placeholder="Not specified" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not specified</SelectItem>
                      {modalSubcategories.map((sub) => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-1">
                <Label htmlFor="edit-notes" className="text-[13px]">
                  Details / Notes (optional)
                </Label>
                <Input
                  id="edit-notes"
                  name="notes"
                  defaultValue={[editingTx.description, editingTx.notes].filter(Boolean).join(" · ")}
                  placeholder="Optional detail or note"
                />
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const target = editingTx;
                    setEditingTx(null);
                    handleDelete(target.id, target.merchant);
                  }}
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditingTx(null)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save Changes</Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction List */}
      <div>
        <TxListHeader showActions />
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No transactions match your search or filter.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <TxRow
                key={t.id}
                tx={t}
                zone={zone}
                actions={
                  <>
                    <button
                      type="button"
                      title="Edit transaction"
                      disabled={pending}
                      onClick={() => openEditModal(t)}
                      className="grid size-8 place-items-center rounded-md border border-border/60 bg-background text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete transaction"
                      disabled={pending}
                      onClick={() => handleDelete(t.id, t.merchant)}
                      className="grid size-8 place-items-center rounded-md border border-border/60 bg-background text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
