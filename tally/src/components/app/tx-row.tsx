import { Money } from "./money";
import { Tag } from "./tag";
import { PurposeStatusIcon } from "./status";
import { formatInZone } from "@/lib/time";
import { TYPE_LABELS, type TransactionType } from "@/lib/domain";

export type TxRowData = {
  id: string;
  occurredAt: Date;
  datePrecision: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  description: string | null;
  location: string | null;
  type: string;
  purposeStatus: string;
  category: { name: string; color: string } | null;
  subcategory: { name: string } | null;
  source: { name: string };
  purpose?: { name: string; color: string } | null;
};

export function formatTxDate(d: Date, precision: string, zone: string) {
  return precision === "date_only" ? formatInZone(d, "EEE d MMM", zone) : formatInZone(d, "EEE d MMM, HH:mm", zone);
}

/** One transaction as a Notion database style row. Stacks on phones. */
export function TxRow({ tx, zone, footer }: { tx: TxRowData; zone: string; footer?: React.ReactNode }) {
  const sub =
    tx.subcategory?.name && tx.subcategory.name.toLowerCase() !== tx.merchant.toLowerCase()
      ? tx.subcategory.name
      : null;
  const detail = [sub, tx.location, tx.description].filter(Boolean).join(" · ");
  const isNonSpend = tx.type !== "expense";
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[112px_minmax(0,1fr)_minmax(0,170px)_minmax(0,140px)_110px] sm:py-2">
      <div className="order-3 col-span-2 text-[12.5px] text-muted-foreground sm:order-none sm:col-span-1">
        {formatTxDate(tx.occurredAt, tx.datePrecision, zone)}
        <span className="sm:hidden"> · {tx.source.name}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[14px] text-foreground">{tx.merchant}</div>
        {detail ? <div className="truncate text-[12.5px] text-muted-foreground">{detail}</div> : null}
      </div>
      <div className="order-4 col-span-2 flex min-w-0 items-center gap-1.5 sm:order-none sm:col-span-1">
        {tx.category ? <Tag color={tx.category.color}>{tx.category.name}</Tag> : <Tag>Uncategorised</Tag>}
        {isNonSpend ? <Tag color="gray">{TYPE_LABELS[tx.type as TransactionType] ?? tx.type}</Tag> : null}
        {tx.purposeStatus === "needs_review" ? (
          <span className="inline-flex items-center gap-1 text-[12.5px] text-[var(--dot-red)] sm:hidden">
            <PurposeStatusIcon status="needs_review" /> To confirm
          </span>
        ) : null}
      </div>
      <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
        <PurposeStatusIcon status={tx.purposeStatus} />
        <span
          className={
            tx.purposeStatus === "needs_review"
              ? "truncate text-[13px] text-[var(--dot-red)]"
              : "truncate text-[13px] text-muted-foreground"
          }
        >
          {tx.purposeStatus === "needs_review" ? "To confirm" : (tx.subcategory?.name ?? "—")}
        </span>
      </div>
      <div className="text-right text-[14px]">
        <Money minor={tx.amountMinor} currency={tx.currency} type={tx.type} />
        <div className="hidden truncate text-[12px] text-muted-foreground sm:block">{tx.source.name}</div>
      </div>
      {footer ? <div className="order-5 col-span-full text-[12px] text-muted-foreground sm:order-none">{footer}</div> : null}
    </li>
  );
}

export function TxListHeader() {
  return (
    <div className="hidden grid-cols-[112px_minmax(0,1fr)_minmax(0,170px)_minmax(0,140px)_110px] gap-x-4 border-b border-border px-3 pb-1.5 text-[12px] text-muted-foreground sm:grid">
      <span>Date</span>
      <span>Merchant</span>
      <span>Category</span>
      <span>Subcategory</span>
      <span className="text-right">Amount</span>
    </div>
  );
}
