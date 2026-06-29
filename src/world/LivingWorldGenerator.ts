import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "../utils/Constants";
import { clamp } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";
import { BlockId } from "./BlockTypes";
import { Chunk } from "./Chunk";
import { BiomeId } from "./BiomeGenerator";
import { GroundCoverDensityMap, MicroBiomeResolver as EcoMicroBiomeResolver, VegetationPatchPlanner, VegetationRegionMap } from "./EcoResolver";

export type MicroBiomeId =
  | "open_meadow"
  | "flower_field"
  | "fern_understory"
  | "wetland"
  | "pine_grove"
  | "deadwood"
  | "boulder_field"
  | "oasis"
  | "rocky_slope"
  | "quiet_plain";

export type PoiType =
  | "abandoned_cabin"
  | "ruin"
  | "well"
  | "camp"
  | "small_mine"
  | "giant_tree_marker"
  | "shrine"
  | "watch_tower"
  | "shipwreck";

export class LivingWorldGenerator {
  private readonly ecoMicro: EcoMicroBiomeResolver;
  private readonly vegetationRegions: VegetationRegionMap;
  private readonly densityMap = new GroundCoverDensityMap();
  private readonly patchPlanner: VegetationPatchPlanner;

  constructor(private readonly noise: Noise) {
    this.ecoMicro = new EcoMicroBiomeResolver(noise);
    this.vegetationRegions = new VegetationRegionMap(noise);
    this.patchPlanner = new VegetationPatchPlanner(noise);
  }

  sampleMicroBiome(x: number, z: number, biome: BiomeId, height: number): MicroBiomeId {
    const moisture = norm(this.noise.fbm2D(x * 0.012 + 900, z * 0.012 - 330, 3));
    const flowers = norm(this.noise.fbm2D(x * 0.018 - 270, z * 0.018 + 630, 3));
    const oldGrowth = norm(this.noise.fbm2D(x * 0.009 + 1400, z * 0.009 - 940, 4));
    const rocks = norm(this.noise.fbm2D(x * 0.024 - 710, z * 0.024 + 470, 3));

    if (biome === "desert") return moisture > 0.82 && height <= SEA_LEVEL + 8 ? "oasis" : "quiet_plain";
    if (biome === "beach") return moisture > 0.58 ? "wetland" : "quiet_plain";
    if (biome === "snow") return oldGrowth > 0.64 ? "pine_grove" : rocks > 0.72 ? "boulder_field" : "quiet_plain";
    if (biome === "mountains") return rocks > 0.58 ? "rocky_slope" : "boulder_field";
    if (biome === "forest") {
      if (oldGrowth > 0.78) return "deadwood";
      if (moisture > 0.66) return "fern_understory";
      if (oldGrowth < 0.34) return "open_meadow";
      return "pine_grove";
    }
    if (biome === "hills") {
      if (rocks > 0.66) return "boulder_field";
      if (flowers > 0.68) return "flower_field";
      return "open_meadow";
    }
    if (flowers > 0.58) return "flower_field";
    if (moisture > 0.72) return "wetland";
    return "open_meadow";
  }

  decorativePlant(x: number, z: number, height: number, biome: BiomeId): BlockId {
    if (height <= SEA_LEVEL + 1) return BlockId.AIR;
    const micro = this.ecoMicro.resolve(x, z, biome, height);
    const region = this.vegetationRegions.sample(x, z);
    const canopyLight = (biome === "forest" || biome === "old_forest" || biome === "dark_forest") && region.oldGrowth > 0.55 ? 0.55 : 1;
    const density = this.densityMap.densityFor(biome, micro, canopyLight);
    return this.patchPlanner.decorativePlant(x, z, biome, micro, density, region);
  }

  decorateColumn(chunk: Chunk, lx: number, height: number, lz: number, biome: BiomeId): void {
    const x = chunk.cx * CHUNK_SIZE + lx;
    const z = chunk.cz * CHUNK_SIZE + lz;
    if (height + 1 >= WORLD_HEIGHT) return;
    const micro = this.sampleMicroBiome(x, z, biome, height);

    if (this.isNearWater(chunk, lx, height, lz)) {
      const roll = this.noise.random2D(x * 131 + 7, z * 131 - 7);
      if (roll < 0.045 && chunk.getLocal(lx, height + 1, lz) === BlockId.AIR) {
        chunk.setLocal(lx, height + 1, lz, biome === "desert" ? BlockId.SHORT_GRASS : BlockId.REEDS);
      }
      if (roll > 0.955) this.placeLilyPadNear(chunk, lx, height, lz);
      if (roll > 0.84 && roll < 0.88 && biome !== "desert") chunk.setLocal(lx, height, lz, BlockId.MUD);
    }

    if ((micro === "boulder_field" || micro === "rocky_slope") && this.noise.random2D(x * 73, z * 73) < 0.035) {
      this.placeBoulder(chunk, lx, height, lz);
    }
    if (micro === "deadwood" && this.noise.random2D(x * 89 - 5, z * 89 + 5) < 0.025) {
      this.placeDeadBranchPile(chunk, lx, height, lz);
    }
  }

  poiAt(x: number, z: number, biome: BiomeId, height: number): PoiType | null {
    const cell = biome === "beach" ? 48 : 72;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const anchorX = cx * cell + 8 + Math.floor(this.noise.random2D(cx * 211 + 3, cz * 211 - 9) * (cell - 16));
    const anchorZ = cz * cell + 8 + Math.floor(this.noise.random2D(cx * 227 - 4, cz * 227 + 13) * (cell - 16));
    if (x !== anchorX || z !== anchorZ) return null;
    const rarity = this.noise.random2D(cx * 251 + 91, cz * 251 - 41);
    if (rarity > 0.18) return null;
    const roll = this.noise.random2D(cx * 263 - 31, cz * 263 + 77);
    if (biome === "beach" && height <= SEA_LEVEL + 4 && roll < 0.36) return "shipwreck";
    if (biome === "mountains" || biome === "hills") return roll < 0.38 ? "small_mine" : roll < 0.68 ? "watch_tower" : "shrine";
    if (biome === "desert") return roll < 0.45 ? "well" : "ruin";
    if (biome === "forest" || biome === "snow") return roll < 0.34 ? "abandoned_cabin" : roll < 0.66 ? "camp" : "giant_tree_marker";
    return roll < 0.35 ? "well" : roll < 0.62 ? "ruin" : roll < 0.82 ? "camp" : "shrine";
  }

  placePoi(chunk: Chunk, lx: number, baseY: number, lz: number, type: PoiType): void {
    if (lx < 4 || lx > CHUNK_SIZE - 5 || lz < 4 || lz > CHUNK_SIZE - 5 || baseY + 8 >= WORLD_HEIGHT) return;
    switch (type) {
      case "abandoned_cabin":
        this.placeCabin(chunk, lx, baseY, lz);
        break;
      case "ruin":
        this.placeRuin(chunk, lx, baseY, lz);
        break;
      case "well":
        this.placeWell(chunk, lx, baseY, lz);
        break;
      case "camp":
        this.placeCamp(chunk, lx, baseY, lz);
        break;
      case "small_mine":
        this.placeMineMouth(chunk, lx, baseY, lz);
        break;
      case "giant_tree_marker":
        this.placeAncientStump(chunk, lx, baseY, lz);
        break;
      case "shrine":
        this.placeShrine(chunk, lx, baseY, lz);
        break;
      case "watch_tower":
        this.placeWatchTower(chunk, lx, baseY, lz);
        break;
      case "shipwreck":
        this.placeShipwreck(chunk, lx, baseY, lz);
        break;
    }
  }

  private placeCabin(chunk: Chunk, lx: number, y: number, lz: number): void {
    for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) this.set(chunk, lx + dx, y + 1, lz + dz, BlockId.WEATHERED_PLANKS);
    for (let h = 2; h <= 4; h += 1) {
      for (let i = -2; i <= 2; i += 1) {
        this.set(chunk, lx + i, y + h, lz - 2, BlockId.WEATHERED_BEAM_X);
        this.set(chunk, lx + i, y + h, lz + 2, BlockId.WEATHERED_BEAM_X);
        this.set(chunk, lx - 2, y + h, lz + i, BlockId.WEATHERED_BEAM_Z);
        this.set(chunk, lx + 2, y + h, lz + i, BlockId.WEATHERED_BEAM_Z);
      }
    }
    for (let dz = -3; dz <= 3; dz += 1) for (let dx = -3; dx <= 3; dx += 1) if (Math.abs(dx) + Math.abs(dz) < 6) this.set(chunk, lx + dx, y + 5, lz + dz, BlockId.SPRUCE_PLANKS);
    this.set(chunk, lx, y + 2, lz - 2, BlockId.AIR);
    this.set(chunk, lx, y + 3, lz - 2, BlockId.AIR);
    this.set(chunk, lx + 1, y + 2, lz, BlockId.CAMPFIRE);
  }

  private placeRuin(chunk: Chunk, lx: number, y: number, lz: number): void {
    for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
      if (this.noise.random3D(chunk.cx * 19 + lx + dx, y, chunk.cz * 19 + lz + dz) > 0.34) this.set(chunk, lx + dx, y + 1, lz + dz, BlockId.MOSSY_COBBLESTONE);
      if (this.noise.random3D(chunk.cx * 23 + lx + dx, y + 1, chunk.cz * 23 + lz + dz) > 0.72) this.set(chunk, lx + dx, y + 2, lz + dz, BlockId.MOSSY_STONE_BRICKS);
    }
    this.set(chunk, lx, y + 1, lz, BlockId.CHISELED_STONE_BRICKS);
    this.set(chunk, lx + 1, y + 1, lz, BlockId.MOSS_CARPET);
  }

  private placeWell(chunk: Chunk, lx: number, y: number, lz: number): void {
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) this.set(chunk, lx + dx, y + 1, lz + dz, Math.abs(dx) + Math.abs(dz) === 0 ? BlockId.WATER : BlockId.COBBLESTONE);
    this.set(chunk, lx - 1, y + 2, lz - 1, BlockId.WEATHERED_BEAM);
    this.set(chunk, lx + 1, y + 2, lz - 1, BlockId.WEATHERED_BEAM);
    this.set(chunk, lx - 1, y + 3, lz - 1, BlockId.WEATHERED_BEAM);
    this.set(chunk, lx + 1, y + 3, lz - 1, BlockId.WEATHERED_BEAM);
    this.set(chunk, lx, y + 4, lz - 1, BlockId.WEATHERED_BEAM_X);
  }

  private placeCamp(chunk: Chunk, lx: number, y: number, lz: number): void {
    this.set(chunk, lx, y + 1, lz, BlockId.CAMPFIRE);
    this.set(chunk, lx - 2, y + 1, lz, BlockId.OAK_LOG_X);
    this.set(chunk, lx + 2, y + 1, lz, BlockId.OAK_LOG_X);
    this.set(chunk, lx, y + 1, lz - 2, BlockId.OAK_LOG_Z);
    this.set(chunk, lx, y + 1, lz + 2, BlockId.OAK_LOG_Z);
    for (let i = 0; i < 5; i += 1) this.setIfAir(chunk, lx - 2 + i, y + 1, lz + 3, BlockId.DIRT_PATH);
  }

  private placeMineMouth(chunk: Chunk, lx: number, y: number, lz: number): void {
    for (let h = 1; h <= 3; h += 1) {
      this.set(chunk, lx - 2, y + h, lz, BlockId.WEATHERED_BEAM);
      this.set(chunk, lx + 2, y + h, lz, BlockId.WEATHERED_BEAM);
    }
    for (let dx = -2; dx <= 2; dx += 1) this.set(chunk, lx + dx, y + 4, lz, BlockId.WEATHERED_BEAM_X);
    for (let dz = 0; dz <= 3; dz += 1) for (let dx = -1; dx <= 1; dx += 1) this.set(chunk, lx + dx, y + 1, lz + dz, BlockId.AIR);
    this.set(chunk, lx, y, lz + 1, BlockId.GRAVEL);
  }

  private placeAncientStump(chunk: Chunk, lx: number, y: number, lz: number): void {
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) this.set(chunk, lx + dx, y + 1, lz + dz, BlockId.DARK_OAK_LOG);
    for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) if (Math.abs(dx) + Math.abs(dz) > 1 && Math.abs(dx) + Math.abs(dz) < 5) this.setIfAir(chunk, lx + dx, y + 1, lz + dz, BlockId.MOSS_CARPET);
  }

  private placeShrine(chunk: Chunk, lx: number, y: number, lz: number): void {
    this.set(chunk, lx, y + 1, lz, BlockId.CHISELED_STONE_BRICKS);
    this.set(chunk, lx, y + 2, lz, BlockId.GLOWSTONE);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) this.set(chunk, lx + dx, y + 1, lz + dz, BlockId.MOSSY_COBBLESTONE);
  }

  private placeWatchTower(chunk: Chunk, lx: number, y: number, lz: number): void {
    for (let h = 1; h <= 7; h += 1) {
      this.set(chunk, lx - 1, y + h, lz - 1, BlockId.WEATHERED_BEAM);
      this.set(chunk, lx + 1, y + h, lz - 1, BlockId.WEATHERED_BEAM);
      this.set(chunk, lx - 1, y + h, lz + 1, BlockId.WEATHERED_BEAM);
      this.set(chunk, lx + 1, y + h, lz + 1, BlockId.WEATHERED_BEAM);
    }
    for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) this.set(chunk, lx + dx, y + 8, lz + dz, BlockId.WEATHERED_PLANKS);
  }

  private placeShipwreck(chunk: Chunk, lx: number, y: number, lz: number): void {
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -4; dx <= 4; dx += 1) if (Math.abs(dx) + Math.abs(dz) < 5) this.set(chunk, lx + dx, y + 1, lz + dz, BlockId.WEATHERED_PLANKS);
    for (let dx = -3; dx <= 3; dx += 1) this.set(chunk, lx + dx, y + 2, lz - 1, BlockId.WEATHERED_BEAM_X);
    this.set(chunk, lx, y + 2, lz, BlockId.WEATHERED_BEAM);
    this.set(chunk, lx, y + 3, lz, BlockId.WEATHERED_BEAM);
  }

  private placeBoulder(chunk: Chunk, lx: number, y: number, lz: number): void {
    const r = 1 + Math.floor(this.noise.random3D(chunk.cx * 31 + lx, y, chunk.cz * 31 + lz) * 2);
    for (let dz = -r; dz <= r; dz += 1) for (let dx = -r; dx <= r; dx += 1) for (let dy = 0; dy <= r; dy += 1) {
      if (Math.abs(dx) + Math.abs(dz) + dy > r + 1) continue;
      this.setIfAir(chunk, lx + dx, y + 1 + dy, lz + dz, dy > 0 && (dx + dz) % 2 === 0 ? BlockId.MOSSY_COBBLESTONE : BlockId.COBBLESTONE);
    }
  }

  private placeDeadBranchPile(chunk: Chunk, lx: number, y: number, lz: number): void {
    const eastWest = this.noise.random3D(chunk.cx * 41 + lx, y, chunk.cz * 41 + lz) > 0.5;
    for (let i = -2; i <= 2; i += 1) this.setIfAir(chunk, lx + (eastWest ? i : 0), y + 1, lz + (eastWest ? 0 : i), eastWest ? BlockId.SPRUCE_LOG_X : BlockId.SPRUCE_LOG_Z);
  }

  private placeLilyPadNear(chunk: Chunk, lx: number, y: number, lz: number): void {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = lx + dx;
      const z = lz + dz;
      if (x <= 0 || z <= 0 || x >= CHUNK_SIZE - 1 || z >= CHUNK_SIZE - 1) continue;
      if (chunk.getLocal(x, y, z) === BlockId.WATER && chunk.getLocal(x, y + 1, z) === BlockId.AIR) {
        chunk.setLocal(x, y + 1, z, BlockId.LILY_PAD);
        return;
      }
    }
  }

  private isNearWater(chunk: Chunk, lx: number, y: number, lz: number): boolean {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const x = lx + dx;
      const z = lz + dz;
      if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE) continue;
      if (chunk.getLocal(x, y, z) === BlockId.WATER || chunk.getLocal(x, y - 1, z) === BlockId.WATER) return true;
    }
    return false;
  }

  private setIfAir(chunk: Chunk, lx: number, y: number, lz: number, block: BlockId): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    if (chunk.getLocal(lx, y, lz) === BlockId.AIR) chunk.setLocal(lx, y, lz, block);
  }

  private set(chunk: Chunk, lx: number, y: number, lz: number, block: BlockId): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    chunk.setLocal(lx, y, lz, block);
  }
}

function norm(value: number): number {
  return clamp((value + 1) * 0.5, 0, 1);
}
