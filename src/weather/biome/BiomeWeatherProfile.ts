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

const plains: BiomeWeatherProfile = { temperatureC: 14, humidity: 0.45, rainFrequency: 0.42, snowFrequency: 0.12, thunderFrequency: 0.22, fogFrequency: 0.14, stormRisk: 0.22, evaporationRate: 0.45, snowRetention: 0.48, windInfluence: 0.7 };
const forest: BiomeWeatherProfile = { temperatureC: 12, humidity: 0.62, rainFrequency: 0.56, snowFrequency: 0.18, thunderFrequency: 0.2, fogFrequency: 0.34, stormRisk: 0.2, evaporationRate: 0.28, snowRetention: 0.62, windInfluence: 0.42 };
const desert: BiomeWeatherProfile = { temperatureC: 28, humidity: 0.16, rainFrequency: 0.06, snowFrequency: 0.01, thunderFrequency: 0.06, fogFrequency: 0.03, stormRisk: 0.18, evaporationRate: 0.95, snowRetention: 0.04, windInfluence: 0.82 };
const hills: BiomeWeatherProfile = { temperatureC: 10, humidity: 0.48, rainFrequency: 0.48, snowFrequency: 0.24, thunderFrequency: 0.2, fogFrequency: 0.22, stormRisk: 0.26, evaporationRate: 0.38, snowRetention: 0.58, windInfluence: 0.78 };
const mountains: BiomeWeatherProfile = { temperatureC: 3, humidity: 0.52, rainFrequency: 0.46, snowFrequency: 0.62, thunderFrequency: 0.18, fogFrequency: 0.38, stormRisk: 0.32, evaporationRate: 0.24, snowRetention: 0.88, windInfluence: 1 };
const beach: BiomeWeatherProfile = { temperatureC: 17, humidity: 0.66, rainFrequency: 0.5, snowFrequency: 0.04, thunderFrequency: 0.16, fogFrequency: 0.28, stormRisk: 0.24, evaporationRate: 0.5, snowRetention: 0.12, windInfluence: 0.9 };
const snow: BiomeWeatherProfile = { temperatureC: -4, humidity: 0.58, rainFrequency: 0.2, snowFrequency: 0.74, thunderFrequency: 0.08, fogFrequency: 0.26, stormRisk: 0.34, evaporationRate: 0.12, snowRetention: 1, windInfluence: 0.92 };

export const BIOME_WEATHER_PROFILES: Record<BiomeId, BiomeWeatherProfile> = {
  plains,
  dry_prairie: { ...plains, temperatureC: 18, humidity: 0.32, rainFrequency: 0.28, evaporationRate: 0.65, windInfluence: 0.82 },
  flower_meadow: { ...plains, humidity: 0.54, rainFrequency: 0.48, fogFrequency: 0.18, evaporationRate: 0.38 },
  bocage: { ...plains, humidity: 0.56, rainFrequency: 0.5, windInfluence: 0.5 },
  forest,
  young_forest: { ...forest, humidity: 0.56, fogFrequency: 0.26, windInfluence: 0.52 },
  old_forest: { ...forest, humidity: 0.7, fogFrequency: 0.42, evaporationRate: 0.22, snowRetention: 0.7, windInfluence: 0.34 },
  birch_forest: { ...forest, humidity: 0.58, rainFrequency: 0.5, windInfluence: 0.48 },
  pine_forest: { ...forest, temperatureC: 8, humidity: 0.52, snowFrequency: 0.3, snowRetention: 0.72, windInfluence: 0.58 },
  dark_forest: { ...forest, humidity: 0.74, fogFrequency: 0.46, evaporationRate: 0.18, windInfluence: 0.3 },
  marsh: { temperatureC: 13, humidity: 0.84, rainFrequency: 0.62, snowFrequency: 0.12, thunderFrequency: 0.25, fogFrequency: 0.58, stormRisk: 0.28, evaporationRate: 0.18, snowRetention: 0.52, windInfluence: 0.38 },
  bog: { temperatureC: 8, humidity: 0.86, rainFrequency: 0.58, snowFrequency: 0.25, thunderFrequency: 0.12, fogFrequency: 0.64, stormRisk: 0.2, evaporationRate: 0.14, snowRetention: 0.76, windInfluence: 0.36 },
  riverbank: { ...beach, humidity: 0.72, rainFrequency: 0.52, fogFrequency: 0.34, evaporationRate: 0.36, windInfluence: 0.62 },
  lake: { ...beach, humidity: 0.76, fogFrequency: 0.4, windInfluence: 0.72 },
  mountain_lake: { ...mountains, humidity: 0.68, fogFrequency: 0.46, snowFrequency: 0.48 },
  beach,
  dunes: { ...desert, humidity: 0.22, rainFrequency: 0.08, windInfluence: 0.95 },
  desert,
  rocky_desert: { ...desert, stormRisk: 0.22, windInfluence: 0.9 },
  canyon: { ...desert, temperatureC: 24, humidity: 0.2, windInfluence: 0.96 },
  hills,
  plateau: { ...hills, temperatureC: 11, humidity: 0.42, windInfluence: 0.86 },
  cliffs: { ...mountains, temperatureC: 7, snowFrequency: 0.32, windInfluence: 1 },
  mountains,
  alpine_mountain: { ...mountains, temperatureC: -1, snowFrequency: 0.72, snowRetention: 0.96 },
  high_mountain: { ...mountains, temperatureC: -8, rainFrequency: 0.18, snowFrequency: 0.86, snowRetention: 1 },
  tundra: { ...snow, temperatureC: -2, humidity: 0.42, snowFrequency: 0.48, windInfluence: 0.96 },
  taiga: { ...snow, temperatureC: -1, humidity: 0.58, rainFrequency: 0.26, snowFrequency: 0.62, windInfluence: 0.62 },
  snow_forest: { ...snow, humidity: 0.64, fogFrequency: 0.32, windInfluence: 0.48 },
  snow,
  glacial_valley: { ...snow, temperatureC: -6, snowFrequency: 0.82, snowRetention: 1, windInfluence: 0.84 },
};
