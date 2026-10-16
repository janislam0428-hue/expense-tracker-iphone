// Shared vocabulary. The database stores these as text; this file is the
// single place that defines which values are valid.

export const TRANSACTION_TYPES = ["expense", "income", "transfer", "refund", "top_up"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Types that count towards "spent". Refunds reduce spending. Top ups and transfers never count. */
export const SPEND_TYPES: readonly TransactionType[] = ["expense"];
export const SPEND_REDUCING_TYPES: readonly TransactionType[] = ["refund"];

export const PURPOSE_STATUSES = ["auto", "needs_review", "confirmed"] as const;
export type PurposeStatus = (typeof PURPOSE_STATUSES)[number];

export const CHANNELS = [
  "screenshot",
  "shortcut",
  "email",
  "wallet",
  "sms",
  "csv",
  "paste",
  "manual",
  "demo",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const SOURCE_KINDS = ["octopus", "payme", "credit_card", "bank", "cash"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const DATE_PRECISIONS = ["exact", "minute", "inferred_weekday", "date_only"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const TAG_COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const REVIEW_REASONS = {
  over_threshold: "Above your review amount",
  ambiguous_category: "Category could be personal, work or a gift",
  p2p: "PayMe payment to a person",
  p2p_received: "Money received from a person",
  uncategorized: "No category yet",
} as const;
export type ReviewReason = keyof typeof REVIEW_REASONS;

export const TYPE_LABELS: Record<TransactionType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  refund: "Refund",
  top_up: "Top up",
};

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  octopus: "Octopus",
  payme: "PayMe",
  credit_card: "Credit card",
  bank: "Bank",
  cash: "Cash",
};

export function isTagColor(v: string): v is TagColor {
  return (TAG_COLORS as readonly string[]).includes(v);
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
