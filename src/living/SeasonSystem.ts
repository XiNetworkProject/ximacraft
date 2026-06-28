import { WORLD_DAY_TICKS } from "../utils/Constants";

export type SeasonId = "spring" | "summer" | "autumn" | "winter";

export interface SeasonState {
  season: SeasonId;
  dayOfYear: number;
  progress: number;
  temperatureOffset: number;
  vegetation: number;
  wildlife: number;
  insectActivity: number;
  leafWarmth: number;
  snowBias: number;
}

const DAYS_PER_YEAR = 96;

export class SeasonSystem {
  private forced: SeasonId | null = null;

  setSeason(season: SeasonId | "auto"): void {
    this.forced = season === "auto" ? null : season;
  }

  get forcedSeason(): SeasonId | null {
    return this.forced;
  }

  sample(ticks: number): SeasonState {
    const dayOfYear = Math.floor(ticks / WORLD_DAY_TICKS) % DAYS_PER_YEAR;
    const autoSeason = seasonFromDay(dayOfYear);
    const season = this.forced ?? autoSeason;
    const progress = seasonProgress(dayOfYear, season);
    switch (season) {
      case "spring":
        return { season, dayOfYear, progress, temperatureOffset: 2, vegetation: 0.95, wildlife: 1, insectActivity: 0.76, leafWarmth: 0.16, snowBias: 0.18 };
      case "summer":
        return { season, dayOfYear, progress, temperatureOffset: 5, vegetation: 1, wildlife: 1, insectActivity: 1, leafWarmth: 0, snowBias: 0 };
      case "autumn":
        return { season, dayOfYear, progress, temperatureOffset: -1, vegetation: 0.72, wildlife: 0.78, insectActivity: 0.38, leafWarmth: 0.72, snowBias: 0.08 };
      case "winter":
      default:
        return { season, dayOfYear, progress, temperatureOffset: -6, vegetation: 0.28, wildlife: 0.42, insectActivity: 0.04, leafWarmth: 0.08, snowBias: 0.78 };
    }
  }

  debug(ticks: number): string {
    const state = this.sample(ticks);
    return `Season ${state.season} day=${state.dayOfYear} progress=${state.progress.toFixed(2)} wildlife=${state.wildlife.toFixed(2)} insects=${state.insectActivity.toFixed(2)} snowBias=${state.snowBias.toFixed(2)}`;
  }
}

function seasonFromDay(day: number): SeasonId {
  if (day < 24) return "spring";
  if (day < 48) return "summer";
  if (day < 72) return "autumn";
  return "winter";
}

function seasonProgress(day: number, season: SeasonId): number {
  const start = season === "spring" ? 0 : season === "summer" ? 24 : season === "autumn" ? 48 : 72;
  return Math.max(0, Math.min(1, (day - start) / 24));
}
