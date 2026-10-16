import { describe, expect, it } from "vitest";
import { generateDemo } from "@/lib/demo/generate";
import { zonedDate, zonedParts } from "@/lib/time";

const now = zonedDate(2026, 10, 11, 2, 30);
const { transactions } = generateDemo(now);

function monthlyNet(category: string) {
  const m = new Map<string, number>();
  for (const t of transactions) {
    if (t.category !== category) continue;
    const p = zonedParts(t.occurredAt);
    const key = `${p.year}-${String(p.month).padStart(2, "0")}`;
    const v = t.type === "refund" ? -t.amountMinor : t.type === "expense" ? t.amountMinor : 0;
    m.set(key, (m.get(key) ?? 0) + v);
  }
  return m;
}

describe("demo data", () => {
  it("is deterministic", () => {
    const again = generateDemo(now).transactions;
    expect(again.length).toBe(transactions.length);
    expect(again[100]).toEqual(transactions[100]);
  });

  it("covers about 24 months and never goes past now", () => {
    expect(transactions.length).toBeGreaterThan(2500);
    expect(Math.max(...transactions.map((t) => t.occurredAt.getTime()))).toBeLessThanOrEqual(now.getTime());
    expect(zonedParts(transactions[0].occurredAt)).toMatchObject({ year: 2024, month: 10 });
  });

  it("has a Q4 beauty peak in two different years, above the 2,000 alert", () => {
    const beauty = monthlyNet("Beauty & Cosmetics");
    for (const year of [2024, 2025]) {
      const q4 = ["10", "11", "12"].reduce((a, m) => a + (beauty.get(`${year}-${m}`) ?? 0), 0) / 3;
      expect(q4).toBeGreaterThan(200000);
    }
    const others = [...beauty.entries()].filter(([k]) => Number(k.slice(5)) < 10).map(([, v]) => v);
    const avgOther = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
    expect(avgOther).toBeLessThan(80000);
  });

  it("top ups are never expenses", () => {
    const topUps = transactions.filter((t) => t.merchant.includes("top up"));
    expect(topUps.length).toBeGreaterThan(10);
    expect(topUps.every((t) => t.type === "top_up")).toBe(true);
  });

  it("Octopus balance chain is consistent", () => {
    const oct = transactions.filter((t) => t.source === "Octopus").sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (let i = 1; i < oct.length; i++) {
      const prev = oct[i - 1].balanceAfterMinor!;
      const cur = oct[i];
      const expected = cur.type === "top_up" ? prev + cur.amountMinor : prev - cur.amountMinor;
      expect(cur.balanceAfterMinor).toBe(expected);
    }
  });

  it("uses the real fares from the user's screenshots", () => {
    const fares = new Set(transactions.filter((t) => t.category === "Transport").map((t) => t.amountMinor));
    for (const f of [870, 820, 1530, 1580, 330, 490]) expect(fares.has(f)).toBe(true);
  });
});
