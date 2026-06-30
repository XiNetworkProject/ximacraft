import { SEA_LEVEL } from "../../utils/Constants";
import { clamp } from "../../utils/MathUtils";
import { isForestBiome, isMountainBiome } from "../BiomeGenerator";
import type { BiomeId } from "../BiomeGenerator";
import type { RoadWaterContext } from "./RoadTypes";

export class RoadCostField {
  costAt(
    x: number,
    z: number,
    biome: BiomeId,
    getHeight: (x: number, z: number) => number,
    getWater: (x: number, z: number) => RoadWaterContext,
  ): number {
    const h = getHeight(x, z);
    if (h <= SEA_LEVEL + 1) return 120;
    const slope = this.localSlope(x, z, getHeight);
    const water = getWater(x, z);
    let cost = 1;
    cost += clamp(slope / 5, 0, 8);
    if (slope > 10) cost += 25;
    if (water.strength > 0.42) cost += 12 + water.width * 0.9;
    if (water.strength > 0.68 && water.width > 6) cost += 24;
    if (biome === "marsh" || biome === "bog") cost += 8;
    if (isForestBiome(biome)) cost += 2.2;
    if (isMountainBiome(biome)) cost += 4.5 + clamp(slope, 0, 12);
    if (biome === "riverbank") cost += water.width > 10 ? 7 : 1.5;
    if (biome === "beach" || biome === "dunes") cost += 0.8;
    if (biome === "rocky_desert" || biome === "canyon" || biome === "cliffs") cost += 5.5;
    return cost;
  }

  localSlope(x: number, z: number, getHeight: (x: number, z: number) => number): number {
    const h = getHeight(x, z);
    return Math.max(
      Math.abs(getHeight(x + 8, z) - h),
      Math.abs(getHeight(x - 8, z) - h),
      Math.abs(getHeight(x, z + 8) - h),
      Math.abs(getHeight(x, z - 8) - h),
    );
  }
}
