import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";
import { BiomeId, isDryBiome, isForestBiome, isMountainBiome } from "../BiomeGenerator";

export interface ForestPatchSample {
  density: number;
  clearing: number;
  oldGrowth: number;
  spacing: number;
}

export class ForestPatchPlanner {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, biome: BiomeId, height: number): ForestPatchSample {
    const oldGrowth = norm(this.noise.fbm2D(x * 0.0023 + 1700, z * 0.0023 - 840, 4));
    const canopyPatch = norm(this.noise.fbm2D(x * 0.0062 - 510, z * 0.0062 + 220, 4));
    const clearing = norm(this.noise.fbm2D(x * 0.0095 + 90, z * 0.0095 - 140, 3));
    const altitudeLimit = clamp((112 - height) / 34, 0, 1);
    let base = 0.02;
    let spacing = 22;

    if (biome === "old_forest") {
      base = 0.66;
      spacing = 5;
    } else if (biome === "dark_forest") {
      base = 0.72;
      spacing = 5;
    } else if (biome === "forest" || biome === "birch_forest") {
      base = 0.48;
      spacing = 7;
    } else if (biome === "young_forest") {
      base = 0.36;
      spacing = 8;
    } else if (biome === "pine_forest" || biome === "taiga" || biome === "snow_forest") {
      base = 0.46;
      spacing = 7;
    } else if (biome === "bocage") {
      base = canopyPatch > 0.62 ? 0.22 : 0.08;
      spacing = 11;
    } else if (biome === "hills") {
      base = 0.15;
      spacing = 12;
    } else if (biome === "plains" || biome === "flower_meadow" || biome === "dry_prairie") {
      base = canopyPatch > 0.82 ? 0.08 : 0.012;
      spacing = 19;
    } else if (biome === "snow" || biome === "tundra") {
      base = 0.09;
      spacing = 13;
    } else if (isDryBiome(biome) || isMountainBiome(biome)) {
      base = canopyPatch > 0.9 ? 0.018 : 0;
      spacing = 24;
    }

    const gap = clearing > 0.76 ? 0.18 : clearing > 0.66 ? 0.46 : 1;
    const patchBoost = 0.52 + canopyPatch * 0.88 + oldGrowth * (isForestBiome(biome) ? 0.28 : 0.08);
    const density = clamp(base * patchBoost * gap * altitudeLimit, 0, 0.86);
    return { density, clearing, oldGrowth, spacing };
  }

  isTreeAnchor(x: number, z: number, biome: BiomeId, height: number): boolean {
    const sample = this.sample(x, z, biome, height);
    if (sample.density <= 0.002) return false;
    const cellX = Math.floor(x / sample.spacing);
    const cellZ = Math.floor(z / sample.spacing);
    const jitterMax = Math.max(1, sample.spacing - 2);
    const anchorX = cellX * sample.spacing + 1 + Math.floor(this.noise.random2D(cellX * 17 + 9, cellZ * 17 - 3) * jitterMax);
    const anchorZ = cellZ * sample.spacing + 1 + Math.floor(this.noise.random2D(cellX * 23 - 5, cellZ * 23 + 11) * jitterMax);
    if (x !== anchorX || z !== anchorZ) return false;
    return this.noise.random2D(cellX * 91 + 41, cellZ * 91 - 17) < sample.density;
  }
}

function norm(value: number): number {
  return clamp((value + 1) * 0.5, 0, 1);
}
