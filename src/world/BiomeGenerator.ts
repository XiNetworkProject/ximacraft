import { SEA_LEVEL } from "../utils/Constants";
import { Noise } from "../utils/Noise";

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
};

export class BiomeGenerator {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, roughHeight: number): BiomeSample {
    const temperature = (this.noise.fbm2D(x * 0.0018 + 29.3, z * 0.0018 - 71.4, 4) + 1) * 0.5;
    const humidity = (this.noise.fbm2D(x * 0.0022 - 93.7, z * 0.0022 + 12.5, 4) + 1) * 0.5;
    const forestAge = (this.noise.fbm2D(x * 0.0012 + 505, z * 0.0012 - 303, 4) + 1) * 0.5;
    const flowers = (this.noise.fbm2D(x * 0.004 + 130, z * 0.004 - 750, 3) + 1) * 0.5;
    const dryness = (this.noise.fbm2D(x * 0.0027 - 800, z * 0.0027 + 620, 3) + 1) * 0.5;

    if (roughHeight <= SEA_LEVEL - 4) {
      return { id: roughHeight < SEA_LEVEL - 14 && temperature < 0.35 ? "mountain_lake" : "lake", temperature, humidity };
    }
    if (roughHeight <= SEA_LEVEL + 2 && roughHeight >= SEA_LEVEL - 3) {
      return { id: "beach", temperature, humidity };
    }
    if (roughHeight > 104) {
      return { id: temperature < 0.38 ? "high_mountain" : "alpine_mountain", temperature, humidity };
    }
    if (roughHeight > 88 || (roughHeight > 74 && temperature < 0.42)) {
      if (temperature < 0.32 && humidity > 0.45) return { id: "glacial_valley", temperature, humidity };
      return { id: temperature < 0.38 ? "snow" : "mountains", temperature, humidity };
    }
    if (roughHeight > 72) {
      return { id: humidity < 0.36 ? "cliffs" : temperature < 0.34 ? "tundra" : "plateau", temperature, humidity };
    }
    if (roughHeight > 62) {
      return { id: humidity > 0.6 ? "hills" : "plateau", temperature, humidity };
    }
    if (temperature > 0.64 && humidity < 0.35) {
      if (dryness > 0.72) return { id: "dunes", temperature, humidity };
      if (roughHeight > SEA_LEVEL + 11) return { id: "rocky_desert", temperature, humidity };
      return { id: "desert", temperature, humidity };
    }
    if (humidity > 0.76 && roughHeight <= SEA_LEVEL + 9) {
      return { id: temperature < 0.42 ? "bog" : "marsh", temperature, humidity };
    }
    if (humidity > 0.56) {
      if (temperature < 0.34) return { id: humidity > 0.62 ? "snow_forest" : "taiga", temperature, humidity };
      if (forestAge > 0.78) return { id: "old_forest", temperature, humidity };
      if (forestAge < 0.28) return { id: "young_forest", temperature, humidity };
      if (dryness > 0.7) return { id: "pine_forest", temperature, humidity };
      if (flowers > 0.7) return { id: "birch_forest", temperature, humidity };
      if (humidity > 0.74 && forestAge > 0.58) return { id: "dark_forest", temperature, humidity };
      return { id: "forest", temperature, humidity };
    }
    if (temperature < 0.32) return { id: "tundra", temperature, humidity };
    if (humidity < 0.34 && temperature > 0.5) return { id: "dry_prairie", temperature, humidity };
    if (flowers > 0.66 && humidity > 0.42) return { id: "flower_meadow", temperature, humidity };
    if (humidity > 0.48 && forestAge > 0.56) return { id: "bocage", temperature, humidity };
    return { id: "plains", temperature, humidity };
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
