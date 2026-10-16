import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { TransactionType } from "@/lib/domain";

/** Amount with sign conventions: spending plain, money in green with a plus, top ups muted. */
export function Money({
  minor,
  currency = "HKD",
  type = "expense",
  className,
  compact,
}: {
  minor: number;
  currency?: string;
  type?: TransactionType | string;
  className?: string;
  compact?: boolean;
}) {
  const text = formatMoney(minor, currency, { compact });
  const inbound = type === "income" || type === "refund";
  const neutral = type === "top_up" || type === "transfer";
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        inbound && "text-success",
        neutral && "text-muted-foreground",
        className,
      )}
    >
      {inbound ? "+" : ""}
      {text}
    </span>
  );
}
