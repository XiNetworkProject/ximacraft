import { WeatherType } from "../WeatherTypes";
import { ForecastConfidence } from "./ForecastConfidence";
import { ForecastRegion } from "./ForecastRegion";

export interface ForecastSnapshot {
  leadSeconds: number;
  region: ForecastRegion;
  weatherType: WeatherType;
  temperature: number;
  humidity: number;
  pressure: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  rainRisk: number;
  thunderRisk: number;
  snowRisk: number;
  hailRisk: number;
  fogRisk: number;
  dominantEventId?: number;
  etaSeconds?: number;
  departureSeconds?: number;
  confidence: ForecastConfidence;
}
