// Reference data created on first run. This is real configuration, not demo
// data: it stays when demo data is switched off, and you can edit it later.
import type { SourceKind, TagColor } from "@/lib/domain";

export type CategorySeed = {
  name: string;
  color: TagColor;
  ambiguous: boolean;
  /** Non spending categories (top ups, money received) */
  children?: string[];
};

export const CATEGORY_SEEDS: CategorySeed[] = [
  { name: "Transport", color: "blue", ambiguous: false, children: ["MTR", "Bus", "Minibus", "Taxi", "Ferry", "Tram"] },
  { name: "Dining", color: "orange", ambiguous: true, children: ["Restaurant", "Cafe", "Bakery", "Fast food"] },
  { name: "Groceries", color: "green", ambiguous: false, children: ["Supermarket", "Convenience store", "Wet market"] },
  { name: "Beauty & Cosmetics", color: "pink", ambiguous: true },
  { name: "Shopping", color: "purple", ambiguous: true, children: ["Clothing", "Electronics", "Home"] },
  { name: "Department Stores", color: "brown", ambiguous: true },
  { name: "Online Marketplace", color: "yellow", ambiguous: true },
  { name: "Entertainment", color: "purple", ambiguous: false },
  { name: "Travel", color: "blue", ambiguous: false },
  { name: "Health", color: "red", ambiguous: false },
  { name: "Subscriptions", color: "gray", ambiguous: false },
  { name: "Utilities", color: "yellow", ambiguous: false },
  { name: "Phone & Internet", color: "gray", ambiguous: false },
  { name: "Education", color: "brown", ambiguous: false },
  { name: "Gifts & Red Packets", color: "red", ambiguous: false },
  { name: "Transfers to People", color: "pink", ambiguous: true },
  { name: "Money Received", color: "green", ambiguous: false },
  { name: "Top ups & Transfers", color: "gray", ambiguous: false },
  { name: "Fees & Charges", color: "gray", ambiguous: false },
  { name: "Other", color: "gray", ambiguous: true },
];

export type PurposeSeed = { name: string; color: TagColor; shortcutKey: string };

export const PURPOSE_SEEDS: PurposeSeed[] = [
  { name: "Personal", color: "blue", shortcutKey: "1" },
  { name: "Work", color: "gray", shortcutKey: "2" },
  { name: "Gift", color: "red", shortcutKey: "3" },
  { name: "Leisure", color: "purple", shortcutKey: "4" },
  { name: "Family", color: "green", shortcutKey: "5" },
  { name: "Reimbursement", color: "yellow", shortcutKey: "6" },
  { name: "Other", color: "brown", shortcutKey: "7" },
];

export type SourceSeed = { name: string; kind: SourceKind; color: TagColor };

export const SOURCE_SEEDS: SourceSeed[] = [
  { name: "Octopus", kind: "octopus", color: "orange" },
  { name: "PayMe", kind: "payme", color: "red" },
  { name: "Hang Seng Card", kind: "credit_card", color: "green" },
  { name: "Hang Seng Bank", kind: "bank", color: "gray" },
  { name: "Cash", kind: "cash", color: "brown" },
];
