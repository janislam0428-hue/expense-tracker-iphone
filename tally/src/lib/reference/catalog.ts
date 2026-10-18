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
  { name: "Transport", color: "blue", ambiguous: false, children: ["Public transport", "Taxi/Uber", "Other transport"] },
  { name: "Food", color: "orange", ambiguous: true, children: ["Restaurant", "Cafe", "Fast food", "Food delivery", "Bakery", "Dessert"] },
  { name: "Gathering", color: "purple", ambiguous: true, children: ["Group meal", "Drinks & desserts", "Gathering activity"] },
  { name: "Groceries", color: "green", ambiguous: false, children: ["Supermarket", "Convenience store", "Wet market"] },
  { name: "Gift", color: "red", ambiguous: true, children: ["Gift", "Red packet"] },
  { name: "Bills", color: "yellow", ambiguous: false, children: ["Phone", "Internet", "Utilities", "Car", "Insurance"] },
  { name: "Subscription", color: "gray", ambiguous: false, children: ["App", "AI", "Learning", "Streaming", "News", "Gym Membership"] },
  { name: "Personal Expense", color: "pink", ambiguous: true, children: ["Daily essentials", "Leisure clothing", "Work clothing", "Makeup", "Skincare", "Accessories", "Health & supplements", "Beauty treatments", "Leisure activities", "Learning & development", "Electronics", "Home"] },
  { name: "Travel Expense", color: "blue", ambiguous: true, children: ["Flights", "Accommodation", "Trip transport", "Trip meals", "Trip activities"] },
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
