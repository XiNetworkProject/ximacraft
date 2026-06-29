import { SeasonId, SeasonState } from "../living/SeasonSystem";
import { PrecipKind, WeatherSample, WeatherType } from "../weather/WeatherTypes";

export type FogBankKind = "radiation" | "river" | "valley" | "advection" | "freezing";
export type SurfaceMood = "dry" | "dew" | "wet" | "muddy" | "snow" | "frost" | "ice";

export interface EnvironmentVisualState {
  season: SeasonId;
  vegetation: number;
  leafWarmth: number;
  leafDrop: number;
  flowering: number;
  dryness: number;
  frost: number;
  snow: number;
  wetness: number;
  haze: number;
  heatShimmer: number;
}

export interface EnvironmentSurfaceState {
  wetness: number;
  mud: number;
  puddles: number;
  snowDepth: number;
  hailDepth: number;
  ice: number;
  frost: number;
  dew: number;
  compactedSnow: number;
  snowBurial: number;
  surfaceTemperature: number;
  exposedToSky: number;
  mood: SurfaceMood;
}

export interface EnvironmentFogState {
  density: number;
  visibilityMeters: number;
  bankDensity: number;
  nearestBankDistance: number;
  kind: FogBankKind | "none";
}

export interface EnvironmentFaunaState {
  activity: number;
  insects: number;
  birds: number;
  amphibians: number;
  fish: number;
  sheltering: number;
  migration: number;
  label: string;
}

export interface AirQualityState {
  haze: number;
  dust: number;
  humidityHaze: number;
  heatShimmer: number;
  clarity: number;
}

export interface ThermalComfortState {
  feelsLike: number;
  heatStress: number;
  coldStress: number;
  windChill: number;
  humidex: number;
  label: "comfortable" | "cool" | "cold" | "freezing" | "warm" | "hot" | "danger";
}

export interface EnvironmentState {
  season: SeasonState;
  dayOfSeason: number;
  weather: WeatherSample;
  timeOfDay: number;
  hour: number;
  dayFactor: number;
  altitude: number;
  biomeId: string;
  temperature: number;
  humidity: number;
  pressure: number;
  dewPoint: number;
  windSpeed: number;
  windDirectionDegrees: number;
  gustSpeed: number;
  cloudCover: number;
  precipitation: number;
  weatherType: WeatherType;
  precipitationKind: PrecipKind;
  thunderRisk: number;
  sunExposure: number;
  riverLevel: number;
  fauna: EnvironmentFaunaState;
  airQuality: AirQualityState;
  surface: EnvironmentSurfaceState;
  thermal: ThermalComfortState;
  fog: EnvironmentFogState;
  visual: EnvironmentVisualState;
}
