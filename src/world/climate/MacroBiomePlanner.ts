import { SEA_LEVEL } from "../../utils/Constants";
import { clamp } from "../../utils/MathUtils";
import { BiomeId } from "../BiomeGenerator";
import { HydrologySample } from "../HydrologyPlanner";
import { ClimateRegionSample } from "./ClimateRegionMap";

export interface MacroBiomeSample {
  id: BiomeId;
  primary: BiomeId;
  transition: number;
  treeDensityTarget: number;
}

export class MacroBiomePlanner {
  resolve(climate: ClimateRegionSample, height: number, hydrology: HydrologySample): MacroBiomeSample {
    const local = this.resolveLocal(climate, height, hydrology);
    const transition = this.transitionWidth(climate, height, hydrology);
    return {
      id: local,
      primary: this.primaryBiome(climate, height, hydrology),
      transition,
      treeDensityTarget: treeDensity(local),
    };
  }

  private resolveLocal(climate: ClimateRegionSample, height: number, hydrology: HydrologySample): BiomeId {
    const primary = this.primaryBiome(climate, height, hydrology);
    if (hydrology.river > 0.62 || hydrology.stream > 0.82) return "riverbank";
    if (hydrology.lake > 0.58) return height > SEA_LEVEL + 18 ? "mountain_lake" : "lake";
    if (hydrology.wetland > 0.56 && height <= SEA_LEVEL + 9) return climate.temperature < 0.38 ? "bog" : "marsh";
    if ((primary === "plains" || primary === "dry_prairie") && climate.fertility > 0.68 && climate.humidity > 0.48) return "flower_meadow";
    if (primary === "plains" && climate.forestAge > 0.62 && climate.humidity > 0.48) return "bocage";
    if (primary === "forest" && climate.forestAge > 0.78) return "old_forest";
    if (primary === "forest" && climate.forestAge < 0.28) return "young_forest";
    if (primary === "forest" && climate.temperature < 0.38) return climate.humidity > 0.62 ? "snow_forest" : "taiga";
    if (primary === "forest" && climate.seasonalDryness > 0.66) return "pine_forest";
    if (primary === "forest" && climate.humidity > 0.74 && climate.forestAge > 0.56) return "dark_forest";
    if (primary === "forest" && climate.exposure > 0.68) return "birch_forest";
    if (primary === "mountains" && climate.snowPotential > 0.58) return height > 104 ? "high_mountain" : "snow";
    return primary;
  }

  private primaryBiome(climate: ClimateRegionSample, height: number, hydrology: HydrologySample): BiomeId {
    if (height <= SEA_LEVEL - 4) return height < SEA_LEVEL - 14 && climate.temperature < 0.35 ? "mountain_lake" : "lake";
    if (height <= SEA_LEVEL + 2) return climate.temperature > 0.62 && climate.humidity < 0.36 ? "dunes" : "beach";
    if (height > 110) return climate.snowPotential > 0.48 ? "high_mountain" : "alpine_mountain";
    if (height > 92) return climate.snowPotential > 0.42 ? "snow" : "mountains";
    if (height > 78) return climate.humidity < 0.36 ? "cliffs" : climate.temperature < 0.34 ? "tundra" : "plateau";
    if (height > 66) return climate.erosion > 0.62 ? "hills" : "plateau";
    if (climate.temperature > 0.66 && climate.humidity < 0.34) {
      if (climate.seasonalDryness > 0.74) return "dunes";
      return height > SEA_LEVEL + 11 ? "rocky_desert" : "desert";
    }
    if (climate.temperature < 0.32 && climate.humidity < 0.48) return "tundra";
    if (hydrology.wetland > 0.42 && climate.humidity > 0.68) return climate.temperature < 0.42 ? "bog" : "marsh";
    if (climate.humidity > 0.58 && climate.fertility > 0.45) return "forest";
    if (climate.humidity < 0.34 && climate.temperature > 0.5) return "dry_prairie";
    return "plains";
  }

  private transitionWidth(climate: ClimateRegionSample, height: number, hydrology: HydrologySample): number {
    const relief = clamp((height - SEA_LEVEL) / 70, 0, 1);
    const water = Math.max(hydrology.river, hydrology.lake, hydrology.wetland);
    return clamp(64 + climate.erosion * 104 + relief * 64 + water * 48, 64, 256);
  }
}

export function treeDensity(biome: BiomeId): number {
  switch (biome) {
    case "plains":
    case "dry_prairie":
    case "flower_meadow":
      return 0.025;
    case "bocage":
      return 0.1;
    case "young_forest":
      return 0.34;
    case "forest":
    case "birch_forest":
      return 0.44;
    case "old_forest":
      return 0.58;
    case "dark_forest":
      return 0.68;
    case "pine_forest":
    case "taiga":
    case "snow_forest":
      return 0.48;
    case "hills":
      return 0.16;
    case "tundra":
    case "snow":
      return 0.08;
    default:
      return 0.02;
  }
}
