import { ForecastSnapshot } from "./ForecastSnapshot";

export const FORECAST_HORIZONS = [0, 5 * 60, 15 * 60, 30 * 60, 60 * 60, 3 * 60 * 60, 6 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60];

export interface ForecastTimeline {
  generatedAt: number;
  snapshots: ForecastSnapshot[];
}
