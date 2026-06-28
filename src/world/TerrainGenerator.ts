import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "../utils/Constants";
import { clamp, hashString } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";
import { BlockId } from "./BlockTypes";
import { Chunk } from "./Chunk";
import { BiomeGenerator, BiomeId } from "./BiomeGenerator";
import { CaveGenerator } from "./CaveGenerator";
import { OreGenerator } from "./OreGenerator";
import { StructureGenerator } from "./StructureGenerator";
import { LivingWorldGenerator } from "./LivingWorldGenerator";

export class TerrainGenerator {
  readonly noise: Noise;
  readonly biomes: BiomeGenerator;
  readonly caves: CaveGenerator;
  readonly ores: OreGenerator;
  readonly structures: StructureGenerator;
  readonly living: LivingWorldGenerator;

  constructor(readonly seed: string) {
    this.noise = new Noise(hashString(seed));
    this.biomes = new BiomeGenerator(this.noise);
    this.caves = new CaveGenerator(this.noise);
    this.ores = new OreGenerator(this.noise);
    this.structures = new StructureGenerator(this.noise);
    this.living = new LivingWorldGenerator(this.noise);
  }

  getHeight(x: number, z: number): number {
    const continental = this.noise.fbm2D(x * 0.0017, z * 0.0017, 5);
    const erosion = this.noise.fbm2D(x * 0.0048 + 90, z * 0.0048 - 120, 4);
    const hills = this.noise.fbm2D(x * 0.015 + 40, z * 0.015 - 80, 4);
    const detail = this.noise.fbm2D(x * 0.04 - 160, z * 0.04 + 40, 2);
    const ridgeNoise = this.noise.fbm2D(x * 0.0032 - 100, z * 0.0032 + 120, 5);
    const river = this.riverStrength(x, z);
    const valley = this.noise.fbm2D(x * 0.0026 + 310, z * 0.0026 - 410, 4);
    const ridges = Math.pow(Math.max(0, 1 - Math.abs(ridgeNoise)), 3);
    const continentLift = continental * 22;
    const erosionCut = Math.max(0, erosion) * 9;
    const mountainMask = clamp((continental + 0.28) / 1.28, 0, 1) * clamp((valley + 0.7) / 1.5, 0.2, 1);
    const mountainLift = ridges * ridges * 58 * mountainMask;
    const rollingLand = hills * (6.5 + mountainMask * 3.5) + detail * 2.2;
    const riverCut = river * (18 + Math.max(0, continental) * 16 + Math.max(0, hills) * 6);
    const floodplainLift = river * river * 3.5;
    const rough = SEA_LEVEL + 4 + continentLift + rollingLand + mountainLift - erosionCut - riverCut + floodplainLift;
    return Math.floor(clamp(rough, 18, WORLD_HEIGHT - 14));
  }

  riverStrength(x: number, z: number): number {
    const channel = Math.abs(this.noise.fbm2D(x * 0.0019 + 700, z * 0.0019 - 270, 5));
    const feeder = Math.abs(this.noise.fbm2D(x * 0.0045 - 120, z * 0.0045 + 920, 3));
    const broad = 1 - smoothRange(0.015, 0.09, channel);
    const narrow = 1 - smoothRange(0.02, 0.12, feeder);
    return clamp(Math.max(broad * 0.92, narrow * 0.55), 0, 1);
  }

  generateChunk(chunk: Chunk): void {
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Array<BiomeId>(CHUNK_SIZE * CHUNK_SIZE);

    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const x = chunk.cx * CHUNK_SIZE + lx;
        const z = chunk.cz * CHUNK_SIZE + lz;
        const height = this.getHeight(x, z);
        const biome = this.biomes.sample(x, z, height);
        const index = lz * CHUNK_SIZE + lx;
        heights[index] = height;
        biomes[index] = biome.id;

        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          let block = BlockId.AIR;

          if (y === 0) {
            block = BlockId.BEDROCK;
          } else if (y <= height) {
            if (this.caves.shouldCarve(x, y, z, height)) {
              block = y < SEA_LEVEL - 3 ? BlockId.WATER : BlockId.AIR;
            } else if (y === height) {
              block = this.surfaceBlock(x, z, height, biome.id);
            } else if (y > height - 4) {
              block = this.subsurfaceBlock(height, biome.id);
            } else {
              block = this.ores.oreForStone(x, y, z, biome.id === "mountains" || biome.id === "snow");
            }
          } else if (y <= SEA_LEVEL) {
            block = BlockId.WATER;
          }

          chunk.setLocal(lx, y, lz, block);
        }
      }
    }

    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const index = lz * CHUNK_SIZE + lx;
        const x = chunk.cx * CHUNK_SIZE + lx;
        const z = chunk.cz * CHUNK_SIZE + lz;
        const height = heights[index];
        const biomeId = biomes[index];
        const poi = height > SEA_LEVEL + 2 ? this.living.poiAt(x, z, biomeId, height) : null;
        if (poi) {
          this.living.placePoi(chunk, lx, height, lz, poi);
          continue;
        }

        const treePlaced =
          height > SEA_LEVEL + 2 &&
          (biomeId === "forest" || biomeId === "plains" || biomeId === "hills" || biomeId === "snow") &&
          this.structures.shouldPlaceTree(x, z, biomeId);
        if (treePlaced) {
          this.structures.placeTree(chunk, lx, height, lz, biomeId);
        } else if (height > SEA_LEVEL + 2 && this.structures.shouldPlaceFallenLog(x, z, biomeId)) {
          this.structures.placeFallenLog(chunk, lx, height, lz, biomeId);
        } else {
          this.living.decorateColumn(chunk, lx, height, lz, biomeId);
          const plant = this.decorativePlant(x, z, height, biomeId);
          if (plant !== BlockId.AIR && height + 1 < WORLD_HEIGHT && chunk.getLocal(lx, height + 1, lz) === BlockId.AIR) {
            chunk.setLocal(lx, height + 1, lz, plant);
          }
        }
      }
    }

    chunk.generated = true;
    chunk.dirty = true;
  }

  private surfaceBlock(x: number, z: number, height: number, biome: string): BlockId {
    const river = this.riverStrength(x, z);
    if (river > 0.62 && height <= SEA_LEVEL + 5) {
      return this.noise.fbm2D(x * 0.09, z * 0.09, 2) > 0.12 ? BlockId.GRAVEL : BlockId.SAND;
    }
    if (height <= SEA_LEVEL - 7) {
      return this.noise.fbm2D(x * 0.09, z * 0.09, 2) > 0.2 ? BlockId.GRAVEL : BlockId.SAND;
    }
    if (height <= SEA_LEVEL + 2 || biome === "beach") {
      return biome === "desert" ? BlockId.RED_SAND : BlockId.SAND;
    }
    if (biome === "desert") {
      return this.noise.fbm2D(x * 0.028 + 20, z * 0.028 - 20, 3) > 0.34 ? BlockId.RED_SAND : BlockId.SAND;
    }
    if (biome === "snow" || height > 92) {
      return BlockId.SNOW_BLOCK;
    }
    if (biome === "mountains" && height > 78) {
      return this.noise.fbm2D(x * 0.06, z * 0.06, 2) > 0.18 ? BlockId.STONE : BlockId.GRASS;
    }
    return BlockId.GRASS;
  }

  private subsurfaceBlock(height: number, biome: string): BlockId {
    if (height <= SEA_LEVEL + 2 || biome === "beach" || biome === "desert") {
      return biome === "desert" ? BlockId.RED_SAND : BlockId.SAND;
    }
    if (biome === "mountains" && height > 82) {
      return BlockId.STONE;
    }
    return BlockId.DIRT;
  }

  private decorativePlant(x: number, z: number, height: number, biome: string): BlockId {
    const surface = this.surfaceBlock(x, z, height, biome);
    if (surface !== BlockId.GRASS && surface !== BlockId.SAND && surface !== BlockId.RED_SAND) return BlockId.AIR;
    return this.living.decorativePlant(x, z, height, biome as BiomeId);
  }
}

function smoothRange(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
