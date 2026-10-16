// Monthly category alerts. Today the rule is a fixed amount (2,000 by default,
// editable globally and per category). The adaptive rule ("more than 1.5x my
// trailing 3 month average") is already implemented behind the same interface,
// so switching later is a settings change, not a rewrite.

export type AlertContext = {
  categoryId: string;
  categoryName: string;
  /** Net spend (expenses minus refunds) for the month being checked */
  monthTotalMinor: number;
  /** Net spend for previous months, most recent first */
  historyMinor: number[];
  categoryThresholdMinor: number | null;
  globalThresholdMinor: number;
};

export type CategoryAlert = {
  categoryId: string;
  categoryName: string;
  strategy: AlertStrategyId;
  totalMinor: number;
  limitMinor: number;
  /** How far over the limit, as a ratio (1.25 = 25% over) */
  ratio: number;
};

export type AlertStrategyId = "fixed" | "adaptive";

export interface AlertStrategy {
  id: AlertStrategyId;
  /** Returns the limit for this context, or null when there is not enough history. */
  limit(ctx: AlertContext): number | null;
}

export const fixedThreshold: AlertStrategy = {
  id: "fixed",
  limit: (ctx) => ctx.categoryThresholdMinor ?? ctx.globalThresholdMinor,
};

export function adaptiveThreshold(params: { multiplier?: number; windowMonths?: number } = {}): AlertStrategy {
  const multiplier = params.multiplier ?? 1.5;
  const windowMonths = params.windowMonths ?? 3;
  return {
    id: "adaptive",
    limit: (ctx) => {
      const window = ctx.historyMinor.slice(0, windowMonths);
      if (window.length < windowMonths) return null;
      const avg = window.reduce((a, b) => a + b, 0) / window.length;
      if (avg <= 0) return null;
      return Math.round(avg * multiplier);
    },
  };
}

export function evaluateAlert(strategy: AlertStrategy, ctx: AlertContext): CategoryAlert | null {
  const limit = strategy.limit(ctx);
  if (limit === null || ctx.monthTotalMinor <= limit) return null;
  return {
    categoryId: ctx.categoryId,
    categoryName: ctx.categoryName,
    strategy: strategy.id,
    totalMinor: ctx.monthTotalMinor,
    limitMinor: limit,
    ratio: ctx.monthTotalMinor / limit,
  };
}

export function strategyFromRule(rule: { strategy: string; params: string } | null | undefined): AlertStrategy {
  if (!rule || rule.strategy !== "adaptive") return fixedThreshold;
  try {
    return adaptiveThreshold(JSON.parse(rule.params));
  } catch {
    return adaptiveThreshold();
  }
}
