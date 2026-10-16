import { describe, expect, it } from "vitest";
import { formatMoney, percentChange, toMinor } from "@/lib/money";
import { daysElapsedInMonth, formatInZone, monthPeriod, zonedDate, zonedParts } from "@/lib/time";
import { normalizeMerchant } from "@/lib/text";

describe("money", () => {
  it("stores amounts as whole cents", () => {
    expect(toMinor("8.70")).toBe(870);
    expect(toMinor("HK$621.70")).toBe(62170);
    expect(toMinor(0.1 + 0.2)).toBe(30);
  });
  it("formats HKD", () => {
    expect(formatMoney(870)).toBe("$8.70");
    expect(formatMoney(200000, "HKD", { decimals: false })).toBe("$2,000");
  });
  it("percent change handles zero", () => {
    expect(percentChange(132, 100)).toBeCloseTo(32);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe("Hong Kong time", () => {
  it("a 23:50 payment on 10 Oct stays on 10 Oct in Hong Kong", () => {
    const d = zonedDate(2026, 10, 10, 23, 50);
    expect(d.toISOString()).toBe("2026-10-10T15:50:00.000Z");
    expect(zonedParts(d).day).toBe(10);
    expect(formatInZone(d, "d MMM HH:mm")).toBe("10 Oct 23:50");
  });
  it("month boundaries are local midnight", () => {
    const p = monthPeriod(zonedDate(2026, 10, 11, 2, 0));
    expect(p.start.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });
  it("counts elapsed days including today", () => {
    expect(daysElapsedInMonth(zonedDate(2026, 10, 11, 2, 0))).toBe(11);
  });
});

describe("merchant normalisation", () => {
  it("folds width, case and punctuation", () => {
    expect(normalizeMerchant("７－Ｅｌｅｖｅｎ")).toBe("7 eleven");
    expect(normalizeMerchant("7-Eleven")).toBe("7 eleven");
    expect(normalizeMerchant("Circle K OK便利店")).toBe("circle k ok便利店");
    expect(normalizeMerchant("  chree   patisserie CH3 ")).toBe("chree patisserie ch3");
  });
});
