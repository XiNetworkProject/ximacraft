import { SEA_LEVEL } from "../utils/Constants";
import { clamp } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";
import { BiomeId } from "./BiomeGenerator";
import { BlockId } from "./BlockTypes";

export type MicroBiomeId =
  | "calm_open_ground"
  | "flower_patch"
  | "fern_understory"
  | "wet_bank"
  | "old_growth"
  | "deadwood"
  | "boulder_scree"
  | "dune_grass"
  | "oasis_edge"
  | "clearing";

export type VegetationRegion = {
  openness: number;
  moisture: number;
  oldGrowth: number;
  flowerBias: number;
};

export class MicroBiomeResolver {
  constructor(private readonly noise: Noise) {}

  resolve(x: number, z: number, biome: BiomeId, height: number): MicroBiomeId {
    const wet = norm(this.noise.fbm2D(x * 0.011 + 900, z * 0.011 - 330, 3));
    const flowers = norm(this.noise.fbm2D(x * 0.017 - 270, z * 0.017 + 630, 3));
    const age = norm(this.noise.fbm2D(x * 0.008 + 1400, z * 0.008 - 940, 4));
    const rock = norm(this.noise.fbm2D(x * 0.024 - 710, z * 0.024 + 470, 3));
    if (biome === "desert" || biome === "dunes" || biome === "rocky_desert") return wet > 0.84 && height <= SEA_LEVEL + 9 ? "oasis_edge" : "dune_grass";
    if (biome === "beach") return wet > 0.68 ? "wet_bank" : "calm_open_ground";
    if (biome === "mountains" || biome === "alpine_mountain" || biome === "high_mountain" || biome === "cliffs") return rock > 0.55 ? "boulder_scree" : "calm_open_ground";
    if (biome === "forest" || biome === "old_forest" || biome === "dark_forest" || biome === "young_forest" || biome === "birch_forest" || biome === "taiga" || biome === "snow_forest") {
      if (age > 0.82) return "old_growth";
      if (age > 0.75 && rock < 0.65) return "deadwood";
      if (wet > 0.62) return "fern_understory";
      if (age < 0.28) return "clearing";
      return "calm_open_ground";
    }
    if (biome === "flower_meadow" || flowers > 0.7) return "flower_patch";
    if (biome === "marsh" || biome === "bog" || biome === "riverbank") return "wet_bank";
    if (rock > 0.72) return "boulder_scree";
    return "calm_open_ground";
  }
}

export class VegetationRegionMap {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number): VegetationRegion {
    return {
      openness: norm(this.noise.fbm2D(x * 0.004 - 80, z * 0.004 + 90, 3)),
      moisture: norm(this.noise.fbm2D(x * 0.006 + 310, z * 0.006 - 210, 3)),
      oldGrowth: norm(this.noise.fbm2D(x * 0.003 + 1000, z * 0.003 - 1000, 4)),
      flowerBias: norm(this.noise.fbm2D(x * 0.01 - 520, z * 0.01 + 440, 2)),
    };
  }
}

export class GroundCoverDensityMap {
  densityFor(biome: BiomeId, micro: MicroBiomeId, light = 1): number {
    let density = 0.03;
    if (biome === "plains" || biome === "dry_prairie" || biome === "bocage") density = 0.045;
    if (biome === "flower_meadow" || micro === "flower_patch") density = 0.14;
    if (biome === "forest" || biome === "young_forest" || biome === "birch_forest") density = micro === "clearing" ? 0.025 : 0.085;
    if (biome === "old_forest" || biome === "dark_forest" || micro === "fern_understory") density = 0.12;
    if (biome === "marsh" || biome === "bog" || micro === "wet_bank") density = 0.09;
    if (biome === "beach" || biome === "dunes") density = 0.012;
    if (biome === "mountains" || biome === "cliffs" || biome === "high_mountain" || micro === "boulder_scree") density = 0.018;
    if (biome === "desert" || biome === "rocky_desert") density = micro === "oasis_edge" ? 0.07 : 0.006;
    if (biome === "snow" || biome === "tundra" || biome === "glacial_valley") density = 0.01;
    return clamp(density * clamp(light, 0.35, 1.15), 0, 0.2);
  }
}

export class VegetationPatchPlanner {
  constructor(private readonly noise: Noise) {}

  decorativePlant(x: number, z: number, biome: BiomeId, micro: MicroBiomeId, density: number, region: VegetationRegion): BlockId {
    const patchSize = micro === "flower_patch" ? 18 : micro === "fern_understory" ? 13 : 22;
    const cellX = Math.floor(x / patchSize);
    const cellZ = Math.floor(z / patchSize);
    const localX = x - cellX * patchSize;
    const localZ = z - cellZ * patchSize;
    const centerX = 2 + Math.floor(this.noise.random2D(cellX * 71 + 11, cellZ * 71 - 19) * Math.max(1, patchSize - 4));
    const centerZ = 2 + Math.floor(this.noise.random2D(cellX * 83 - 17, cellZ * 83 + 29) * Math.max(1, patchSize - 4));
    const dx = localX - centerX;
    const dz = localZ - centerZ;
    const radius = patchSize * (0.18 + this.noise.random2D(cellX * 97 + 3, cellZ * 97 - 3) * 0.22);
    if (dx * dx + dz * dz > radius * radius) return BlockId.AIR;
    if (this.noise.random2D(x * 127 + 5, z * 127 - 5) > clamp(density * 4.0, 0, 0.65)) return BlockId.AIR;
    const accent = this.noise.random2D(cellX * 193 + x, cellZ * 193 + z);
    if (biome === "beach" || biome === "dunes") return accent < 0.82 ? BlockId.AIR : BlockId.SHORT_GRASS;
    if (micro === "wet_bank") return accent < 0.56 ? BlockId.REEDS : accent < 0.78 ? BlockId.FERN : BlockId.SHORT_GRASS;
    if (micro === "fern_understory" || micro === "old_growth") return accent < 0.68 ? BlockId.FERN : accent < 0.88 ? BlockId.WILD_BUSH : BlockId.MOSS_CARPET;
    if (micro === "deadwood") return accent < 0.58 ? BlockId.FERN : accent < 0.82 ? BlockId.MOSS_CARPET : BlockId.WILD_BUSH;
    if (micro === "boulder_scree") return accent < 0.78 ? BlockId.AIR : BlockId.SHORT_GRASS;
    if (micro === "oasis_edge") return accent < 0.52 ? BlockId.REEDS : BlockId.SHORT_GRASS;
    if (micro === "flower_patch") {
      if (region.flowerBias < 0.32) return accent < 0.72 ? BlockId.DANDELION : BlockId.WHITE_FLOWER;
      if (region.flowerBias < 0.58) return accent < 0.7 ? BlockId.POPPY : BlockId.BLUE_FLOWER;
      return accent < 0.34 ? BlockId.DANDELION : accent < 0.67 ? BlockId.POPPY : accent < 0.84 ? BlockId.BLUE_FLOWER : BlockId.WHITE_FLOWER;
    }
    return accent < 0.72 ? BlockId.SHORT_GRASS : BlockId.TALL_GRASS;
  }
}

function norm(value: number): number {
  return clamp((value + 1) * 0.5, 0, 1);
}
