import { Noise } from "../../utils/Noise";
import { isMountainBiome } from "../BiomeGenerator";
import type { BiomeId } from "../BiomeGenerator";
import { BlockId } from "../BlockTypes";
import type { RoadKind } from "./RoadTypes";

export class RoadSurfacePlanner {
  constructor(private readonly noise: Noise) {}

  surfaceAt(x: number, z: number, kind: RoadKind, biome: BiomeId, strength: number, slope = 0): BlockId {
    const worn = this.noise.fbm2D(x * 0.08 + 90, z * 0.08 - 40, 2);
    if (kind === "ancient") return worn > 0.38 ? BlockId.COBBLESTONE_PATH : BlockId.GRAVEL_PATH;
    if (kind === "village") return strength > 0.9 || worn > 0.28 ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH;
    if (kind === "mountain" || isMountainBiome(biome) || slope > 4.5) return worn > -0.15 ? BlockId.GRAVEL_PATH : BlockId.COBBLESTONE_PATH;
    if (kind === "riverbank") return worn > 0.2 ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH;
    if (kind === "forest") return worn > 0.45 ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH;
    if (kind === "trail") return BlockId.DIRT_PATH;
    return worn > 0.55 ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH;
  }
}
