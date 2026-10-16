// How much forecasting to show, based on how much history exists.
// Agreed with the user:
//   under 7 days       -> hidden, show progress towards unlocking
//   7 days to 3 months -> current month early estimate only, wide range
//   3 months or more   -> quarter and year forecasts, trends, recurring charges
// Seasonality additionally needs the same peak in at least 2 different years.

export type PredictionTier = "locked" | "early" | "full";

export type TierInfo = {
  tier: PredictionTier;
  daysOfData: number;
  daysUntilNextTier: number | null;
  seasonalityPossible: boolean;
};

const DAY = 86_400_000;

export function predictionTier(firstAt: Date | null, now: Date): TierInfo {
  if (!firstAt) return { tier: "locked", daysOfData: 0, daysUntilNextTier: 7, seasonalityPossible: false };
  const days = Math.max(0, Math.floor((now.getTime() - firstAt.getTime()) / DAY)) + 1;
  const seasonalityPossible = days >= 365 + 31; // a full year plus the start of a second cycle
  if (days < 7) return { tier: "locked", daysOfData: days, daysUntilNextTier: 7 - days, seasonalityPossible };
  if (days < 90) return { tier: "early", daysOfData: days, daysUntilNextTier: 90 - days, seasonalityPossible };
  return { tier: "full", daysOfData: days, daysUntilNextTier: null, seasonalityPossible };
}
