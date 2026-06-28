export type ForecastConfidence = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";

export function confidenceForLead(leadSeconds: number, volatility = 0): ForecastConfidence {
  const leadMinutes = leadSeconds / 60;
  const penalty = volatility > 0.78 ? 2 : volatility > 0.55 ? 1 : 0;
  const rank = leadMinutes <= 5 ? 0 : leadMinutes <= 30 ? 1 : leadMinutes <= 180 ? 2 : leadMinutes <= 720 ? 3 : 4;
  return (["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "VERY_LOW"] as const)[Math.min(4, rank + penalty)];
}
