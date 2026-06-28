import { BiomeId } from "../../world/BiomeGenerator";

export interface BiomeWeatherProfile {
  temperatureC: number;
  humidity: number;
  rainFrequency: number;
  snowFrequency: number;
  thunderFrequency: number;
  fogFrequency: number;
  stormRisk: number;
  evaporationRate: number;
  snowRetention: number;
  windInfluence: number;
}

export const BIOME_WEATHER_PROFILES: Record<BiomeId, BiomeWeatherProfile> = {
  plains: { temperatureC: 14, humidity: 0.45, rainFrequency: 0.42, snowFrequency: 0.12, thunderFrequency: 0.22, fogFrequency: 0.14, stormRisk: 0.22, evaporationRate: 0.45, snowRetention: 0.48, windInfluence: 0.7 },
  forest: { temperatureC: 12, humidity: 0.62, rainFrequency: 0.56, snowFrequency: 0.18, thunderFrequency: 0.2, fogFrequency: 0.34, stormRisk: 0.2, evaporationRate: 0.28, snowRetention: 0.62, windInfluence: 0.42 },
  desert: { temperatureC: 28, humidity: 0.16, rainFrequency: 0.06, snowFrequency: 0.01, thunderFrequency: 0.06, fogFrequency: 0.03, stormRisk: 0.18, evaporationRate: 0.95, snowRetention: 0.04, windInfluence: 0.82 },
  hills: { temperatureC: 10, humidity: 0.48, rainFrequency: 0.48, snowFrequency: 0.24, thunderFrequency: 0.2, fogFrequency: 0.22, stormRisk: 0.26, evaporationRate: 0.38, snowRetention: 0.58, windInfluence: 0.78 },
  mountains: { temperatureC: 3, humidity: 0.52, rainFrequency: 0.46, snowFrequency: 0.62, thunderFrequency: 0.18, fogFrequency: 0.38, stormRisk: 0.32, evaporationRate: 0.24, snowRetention: 0.88, windInfluence: 1 },
  beach: { temperatureC: 17, humidity: 0.66, rainFrequency: 0.5, snowFrequency: 0.04, thunderFrequency: 0.16, fogFrequency: 0.28, stormRisk: 0.24, evaporationRate: 0.5, snowRetention: 0.12, windInfluence: 0.9 },
  snow: { temperatureC: -4, humidity: 0.58, rainFrequency: 0.2, snowFrequency: 0.74, thunderFrequency: 0.08, fogFrequency: 0.26, stormRisk: 0.34, evaporationRate: 0.12, snowRetention: 1, windInfluence: 0.92 },
};
