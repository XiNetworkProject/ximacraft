import { SEA_LEVEL } from "../utils/Constants";
import { Noise } from "../utils/Noise";
import { ClimateRegionMap } from "./climate/ClimateRegionMap";
import { MacroBiomePlanner } from "./climate/MacroBiomePlanner";
import { BiomeTransitionMap } from "./climate/BiomeTransitionMap";
import { LocalBiomeResolver } from "./climate/LocalBiomeResolver";
import { MicroBiomePlanner, MicroBiomeDebug } from "./climate/MicroBiomePlanner";
import { HydrologySample } from "./HydrologyPlanner";

export type BiomeId =
  | "plains"
  | "dry_prairie"
  | "flower_meadow"
  | "bocage"
  | "forest"
  | "young_forest"
  | "old_forest"
  | "birch_forest"
  | "pine_forest"
  | "dark_forest"
  | "marsh"
  | "bog"
  | "riverbank"
  | "lake"
  | "mountain_lake"
  | "beach"
  | "dunes"
  | "desert"
  | "rocky_desert"
  | "canyon"
  | "hills"
  | "plateau"
  | "cliffs"
  | "mountains"
  | "alpine_mountain"
  | "high_mountain"
  | "tundra"
  | "taiga"
  | "snow_forest"
  | "snow"
  | "glacial_valley";

export type BiomeSample = {
  id: BiomeId;
  temperature: number;
  humidity: number;
  primary?: BiomeId;
  transition?: number;
  treeDensityTarget?: number;
};

export class BiomeGenerator {
  readonly climate: ClimateRegionMap;
  private readonly macroBiomes = new MacroBiomePlanner();
  private readonly transitions: BiomeTransitionMap;
  private readonly local = new LocalBiomeResolver();
  private readonly micro: MicroBiomePlanner;
  private readonly sampleCache = new Map<string, BiomeSample>();

  constructor(private readonly noise: Noise) {
    this.climate = new ClimateRegionMap(noise);
    this.transitions = new BiomeTransitionMap(noise);
    this.micro = new MicroBiomePlanner(noise);
  }

  sample(x: number, z: number, roughHeight: number, hydrology?: HydrologySample): BiomeSample {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const cacheKey = `${ix},${iz}:${roughHeight}:${hydrology ? `${Math.round(hydrology.river * 100)}:${Math.round(hydrology.lake * 100)}:${Math.round(hydrology.wetland * 100)}` : "none"}`;
    const cached = this.sampleCache.get(cacheKey);
    if (cached) return cached;
    if (this.sampleCache.size > 420_000) this.sampleCache.clear();
    x = ix;
    z = iz;
    const climate = this.climate.sample(x, z);
    const hydro = hydrology ?? {
      river: 0,
      stream: 0,
      floodplain: 0,
      wetland: 0,
      lake: roughHeight <= SEA_LEVEL - 4 ? 1 : 0,
      waterLevel: SEA_LEVEL,
      bank: 0,
      waterfallRisk: 0,
      width: 0,
      flowX: 0,
      flowZ: 0,
      current: 0,
      source: 0,
      category: roughHeight <= SEA_LEVEL - 4 ? "lake" as const : "dry" as const,
    };
    const macro = this.macroBiomes.resolve(climate, roughHeight, hydro);
    const id = this.local.refine(macro.id, climate, hydro);
    const sample = {
      id,
      temperature: climate.temperature,
      humidity: climate.humidity,
      primary: macro.primary,
      transition: this.transitions.edgeSoftness(x, z, macro.transition),
      treeDensityTarget: macro.treeDensityTarget,
    };
    this.sampleCache.set(cacheKey, sample);
    return sample;
  }

  debugAt(x: number, z: number, roughHeight: number, hydrology?: HydrologySample): string {
    const climate = this.climate.sample(x, z);
    const biome = this.sample(x, z, roughHeight, hydrology);
    const micro: MicroBiomeDebug = this.micro.debug(x, z, biome.id);
    return `Biome x=${Math.floor(x)} z=${Math.floor(z)} id=${biome.id} primary=${biome.primary ?? biome.id} temp=${climate.temperature.toFixed(2)} humidity=${climate.humidity.toFixed(2)} continentality=${climate.continentality.toFixed(2)} fertility=${climate.fertility.toFixed(2)} forestAge=${climate.forestAge.toFixed(2)} transition=${(biome.transition ?? 0).toFixed(0)}m micro=${micro.patch}:${micro.value.toFixed(2)}`;
  }
}

export function isForestBiome(id: BiomeId): boolean {
  return id === "forest" || id === "young_forest" || id === "old_forest" || id === "birch_forest" || id === "pine_forest" || id === "dark_forest" || id === "taiga" || id === "snow_forest";
}

export function isMountainBiome(id: BiomeId): boolean {
  return id === "mountains" || id === "alpine_mountain" || id === "high_mountain" || id === "cliffs" || id === "glacial_valley";
}

export function isDryBiome(id: BiomeId): boolean {
  return id === "desert" || id === "dunes" || id === "rocky_desert" || id === "dry_prairie" || id === "canyon";
}
