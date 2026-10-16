// Decides whether a transaction needs a purpose confirmation.
// Rules agreed with the user (informational only, nothing is ever blocked):
//  1. Amount strictly above the review threshold (500 by default) always asks.
//  2. An ambiguous category (dining, shopping, beauty, department stores,
//     online marketplaces, transfers to people, uncategorised) asks, unless a
//     saved merchant rule supplies the purpose.
//  3. PayMe person to person payments always ask, even with a rule.
//  Rules 1 and 2 apply independently. Top ups, transfers and income from
//  non person sources never ask.
import type { PurposeStatus, ReviewReason, TransactionType } from "@/lib/domain";

export type ReviewInput = {
  amountMinor: number;
  type: TransactionType;
  categoryAmbiguous: boolean | null; // null = no category
  hasRulePurpose: boolean;
  isPersonToPerson: boolean;
  reviewThresholdMinor: number;
};

export type ReviewDecision = { status: PurposeStatus; reasons: ReviewReason[] };

export function decideReview(input: ReviewInput): ReviewDecision {
  const reasons: ReviewReason[] = [];

  if (input.type === "top_up" || input.type === "transfer") {
    return { status: "auto", reasons };
  }

  if (input.isPersonToPerson) {
    reasons.push(input.type === "income" ? "p2p_received" : "p2p");
  }

  if (input.type === "income" && !input.isPersonToPerson) {
    return { status: "auto", reasons };
  }

  if (input.amountMinor > input.reviewThresholdMinor) {
    reasons.push("over_threshold");
  }

  // A person to person payment already asks; no need to add the category reason too.
  if (!input.hasRulePurpose && !input.isPersonToPerson) {
    if (input.categoryAmbiguous === null) reasons.push("uncategorized");
    else if (input.categoryAmbiguous) reasons.push("ambiguous_category");
  }

  return { status: reasons.length > 0 ? "needs_review" : "auto", reasons };
}
