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
      base = 0.58;
      spacing = 7;
    } else if (biome === "dark_forest") {
      base = 0.62;
      spacing = 7;
    } else if (biome === "forest" || biome === "birch_forest") {
      base = 0.42;
      spacing = 8;
    } else if (biome === "young_forest") {
      base = 0.38;
      spacing = 8;
    } else if (biome === "pine_forest" || biome === "taiga" || biome === "snow_forest") {
      base = 0.4;
      spacing = 8;
    } else if (biome === "bocage") {
      base = canopyPatch > 0.62 ? 0.14 : 0.045;
      spacing = 16;
    } else if (biome === "hills") {
      base = 0.09;
      spacing = 16;
    } else if (biome === "plains" || biome === "flower_meadow" || biome === "dry_prairie") {
      base = canopyPatch > 0.86 ? 0.035 : 0.006;
      spacing = 28;
    } else if (biome === "snow" || biome === "tundra") {
      base = 0.05;
      spacing = 18;
    } else if (isDryBiome(biome) || isMountainBiome(biome)) {
      base = canopyPatch > 0.92 ? 0.01 : 0;
      spacing = 30;
    }

    const gap = clearing > 0.77 ? 0.04 : clearing > 0.66 ? 0.32 : 1;
    const patchBoost = 0.52 + canopyPatch * 0.88 + oldGrowth * (isForestBiome(biome) ? 0.28 : 0.08);
    const density = clamp(base * patchBoost * gap * altitudeLimit, 0, 0.64);
    return { density, clearing, oldGrowth, spacing };
  }

  isTreeAnchor(x: number, z: number, biome: BiomeId, height: number): boolean {
    const sample = this.sample(x, z, biome, height);
    if (sample.density <= 0.002) return false;

    const standSize = isForestBiome(biome) ? 112 : biome === "bocage" ? 144 : 192;
    const standX = Math.floor(x / standSize);
    const standZ = Math.floor(z / standSize);
    const standCenterX = standX * standSize + standSize * (0.18 + this.noise.random2D(standX * 137 + 9, standZ * 137 - 3) * 0.64);
    const standCenterZ = standZ * standSize + standSize * (0.18 + this.noise.random2D(standX * 149 - 5, standZ * 149 + 11) * 0.64);
    const standRadius = standSize * (0.22 + this.noise.random2D(standX * 181 + 7, standZ * 181 - 7) * 0.36);
    const standDistance = Math.hypot(x - standCenterX, z - standCenterZ);
    const standFalloff = 1 - smoothRange(standRadius * 0.48, standRadius, standDistance);
    const corridor = norm(this.noise.fbm2D(x * 0.011 - 450, z * 0.011 + 620, 3));
    const localDensity = clamp(sample.density * (0.38 + standFalloff * 1.65) * (corridor > 0.88 ? 0.28 : 1), 0, 0.86);
    if (localDensity <= 0.003) return false;

    const localSpacing = Math.max(5, Math.round(sample.spacing * (0.72 + this.noise.random2D(standX * 41 + standZ, standZ * 41 - standX) * 0.76)));
    const cellX = Math.floor((x + standX * 3) / localSpacing);
    const cellZ = Math.floor((z - standZ * 5) / localSpacing);
    const jitterMax = Math.max(1, localSpacing - 2);
    const anchorX = cellX * localSpacing - standX * 3 + 1 + Math.floor(this.noise.random2D(cellX * 17 + 9, cellZ * 17 - 3) * jitterMax);
    const anchorZ = cellZ * localSpacing + standZ * 5 + 1 + Math.floor(this.noise.random2D(cellX * 23 - 5, cellZ * 23 + 11) * jitterMax);
    if (x !== anchorX || z !== anchorZ) return false;
    const microVariation = norm(this.noise.fbm2D(x * 0.045 + 80, z * 0.045 - 120, 2));
    return this.noise.random2D(cellX * 91 + 41, cellZ * 91 - 17) < localDensity * (0.55 + microVariation * 0.68);
  }
}

function norm(value: number): number {
  return clamp((value + 1) * 0.5, 0, 1);
}

function smoothRange(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
