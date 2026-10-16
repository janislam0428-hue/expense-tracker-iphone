import { describe, expect, it } from "vitest";
import { decideReview } from "@/lib/review/rules";
import { adaptiveThreshold, evaluateAlert, fixedThreshold, strategyFromRule } from "@/lib/alerts/strategy";
import { predictionTier } from "@/lib/insights/tier";

const base = { type: "expense" as const, categoryAmbiguous: false, hasRulePurpose: false, isPersonToPerson: false, reviewThresholdMinor: 50000 };

describe("needs review rules", () => {
  it("an 8.70 bus fare is never flagged", () => {
    expect(decideReview({ ...base, amountMinor: 870 })).toEqual({ status: "auto", reasons: [] });
  });
  it("PayMe person to person payments always ask, even small and with a rule", () => {
    const d = decideReview({ ...base, amountMinor: 200, isPersonToPerson: true, hasRulePurpose: true, categoryAmbiguous: true });
    expect(d.status).toBe("needs_review");
    expect(d.reasons).toEqual(["p2p"]);
  });
  it("money received from a person asks too", () => {
    expect(decideReview({ ...base, type: "income", amountMinor: 200, isPersonToPerson: true }).reasons).toEqual(["p2p_received"]);
  });
  it("over 500 asks even for an obvious category; exactly 500 does not", () => {
    expect(decideReview({ ...base, amountMinor: 50001 }).reasons).toEqual(["over_threshold"]);
    expect(decideReview({ ...base, amountMinor: 50000 }).status).toBe("auto");
  });
  it("ambiguous category asks unless a rule supplies the purpose", () => {
    expect(decideReview({ ...base, amountMinor: 28780, categoryAmbiguous: true }).reasons).toEqual(["ambiguous_category"]);
    expect(decideReview({ ...base, amountMinor: 4500, categoryAmbiguous: true, hasRulePurpose: true }).status).toBe("auto");
  });
  it("a rule does not override the amount threshold", () => {
    expect(decideReview({ ...base, amountMinor: 60000, categoryAmbiguous: true, hasRulePurpose: true }).reasons).toEqual(["over_threshold"]);
  });
  it("both conditions apply independently", () => {
    expect(decideReview({ ...base, amountMinor: 90000, categoryAmbiguous: true }).reasons).toEqual(["over_threshold", "ambiguous_category"]);
  });
  it("top ups and transfers never ask", () => {
    expect(decideReview({ ...base, type: "top_up", amountMinor: 62170 }).status).toBe("auto");
    expect(decideReview({ ...base, type: "transfer", amountMinor: 900000 }).status).toBe("auto");
  });
});

describe("category alerts", () => {
  const ctx = { categoryId: "c", categoryName: "Dining", historyMinor: [100000, 120000, 110000], categoryThresholdMinor: null, globalThresholdMinor: 200000 };
  it("fixed: strictly above 2,000 alerts", () => {
    expect(evaluateAlert(fixedThreshold, { ...ctx, monthTotalMinor: 200000 })).toBeNull();
    expect(evaluateAlert(fixedThreshold, { ...ctx, monthTotalMinor: 200001 })?.limitMinor).toBe(200000);
  });
  it("fixed: per category override wins", () => {
    expect(evaluateAlert(fixedThreshold, { ...ctx, monthTotalMinor: 90000, categoryThresholdMinor: 80000 })?.limitMinor).toBe(80000);
  });
  it("adaptive: 1.5x trailing 3 month average, ready for later", () => {
    const s = adaptiveThreshold({ multiplier: 1.5, windowMonths: 3 });
    expect(evaluateAlert(s, { ...ctx, monthTotalMinor: 160000 })).toBeNull(); // limit 165,000
    expect(evaluateAlert(s, { ...ctx, monthTotalMinor: 170000 })?.limitMinor).toBe(165000);
    expect(evaluateAlert(s, { ...ctx, historyMinor: [100000], monthTotalMinor: 999999 })).toBeNull(); // not enough history
  });
  it("defaults to fixed when no rule is saved", () => {
    expect(strategyFromRule(null).id).toBe("fixed");
    expect(strategyFromRule({ strategy: "adaptive", params: "{}" }).id).toBe("adaptive");
  });
});

describe("prediction tiers", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  it("hidden under 7 days", () => {
    expect(predictionTier(null, now).tier).toBe("locked");
    expect(predictionTier(daysAgo(5), now)).toMatchObject({ tier: "locked", daysUntilNextTier: 1 });
  });
  it("early estimate from 7 days", () => expect(predictionTier(daysAgo(6), now).tier).toBe("early"));
  it("full from about 3 months", () => expect(predictionTier(daysAgo(95), now).tier).toBe("full"));
});
