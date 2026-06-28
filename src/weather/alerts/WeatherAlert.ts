import { ForecastRegion } from "../forecast/ForecastRegion";
import { WeatherAlertLevel } from "./WeatherAlertLevel";

export type WeatherAlertType =
  | "heavy_rain"
  | "storm"
  | "lightning"
  | "hail"
  | "snow"
  | "blizzard"
  | "ice"
  | "dense_fog"
  | "high_wind"
  | "sandstorm"
  | "heatwave"
  | "cold_wave"
  | "supercell"
  | "squall_line";

export interface WeatherAlert {
  id: string;
  type: WeatherAlertType;
  level: WeatherAlertLevel;
  region: ForecastRegion;
  startsAt: number;
  endsAt: number;
  probability: number;
  description: string;
  advice: string;
  linkedEventId?: number;
}
