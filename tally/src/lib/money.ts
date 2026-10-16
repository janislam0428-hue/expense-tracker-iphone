// Money helpers. Amounts are integers in minor units (cents).

export function toMinor(amount: number | string): number {
  const n = typeof amount === "string" ? Number(amount.replace(/[^0-9.-]/g, "")) : amount;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${amount}`);
  return Math.round(n * 100);
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean, decimals: boolean) {
  const key = `${currency}|${compact}|${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-HK", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: compact ? 0 : decimals ? 2 : 0,
      maximumFractionDigits: compact ? 1 : decimals ? 2 : 0,
    });
    formatters.set(key, f);
  }
  return f;
}

/** Format minor units, e.g. 870 -> "$8.70". */
export function formatMoney(
  minor: number,
  currency = "HKD",
  opts: { compact?: boolean; decimals?: boolean } = {},
): string {
  const { compact = false, decimals = true } = opts;
  return formatter(currency, compact, decimals).format(minor / 100);
}

/** Percentage change from previous to current. Null when previous is zero. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
