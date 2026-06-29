import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "../utils/Constants";
import { clamp, hashString } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";
import { BlockId } from "./BlockTypes";
import { Chunk } from "./Chunk";
import { BiomeGenerator, BiomeId, isDryBiome, isForestBiome, isMountainBiome } from "./BiomeGenerator";
import { CaveGenerator } from "./CaveGenerator";
import { OreGenerator } from "./OreGenerator";
import { StructureGenerator } from "./StructureGenerator";
import { LivingWorldGenerator } from "./LivingWorldGenerator";
import { MacroWorldPlanner } from "./MacroWorldPlanner";
import { RegionPlanner } from "./RegionPlanner";

export class TerrainGenerator {
  readonly noise: Noise;
  readonly biomes: BiomeGenerator;
  readonly caves: CaveGenerator;
  readonly ores: OreGenerator;
  readonly structures: StructureGenerator;
  readonly living: LivingWorldGenerator;
  readonly macro: MacroWorldPlanner;
  readonly regions: RegionPlanner;

  constructor(readonly seed: string) {
    this.noise = new Noise(hashString(seed));
    this.macro = new MacroWorldPlanner(this.noise);
    this.biomes = new BiomeGenerator(this.noise);
    this.caves = new CaveGenerator(this.noise);
    this.ores = new OreGenerator(this.noise);
    this.structures = new StructureGenerator(this.noise);
    this.living = new LivingWorldGenerator(this.noise);
    this.regions = new RegionPlanner(this.noise);
  }

  getHeight(x: number, z: number): number {
    return this.macro.sample(x, z).altitude;
  }

  riverStrength(x: number, z: number): number {
    const macro = this.macro.sample(x, z);
    return clamp(Math.max(macro.hydrology.river, macro.hydrology.stream * 0.58, macro.hydrology.lake * 0.72), 0, 1);
  }

  generateChunk(chunk: Chunk): void {
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Array<BiomeId>(CHUNK_SIZE * CHUNK_SIZE);

    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const x = chunk.cx * CHUNK_SIZE + lx;
        const z = chunk.cz * CHUNK_SIZE + lz;
        const macro = this.macro.sample(x, z);
        const height = macro.altitude;
        const hydro = macro.hydrology;
        const biome = this.biomes.sample(x, z, height, hydro);
        const index = lz * CHUNK_SIZE + lx;
        heights[index] = height;
        biomes[index] = biome.id;

        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          let block = BlockId.AIR;

          if (y === 0) {
            block = BlockId.BEDROCK;
          } else if (y <= height) {
            if (this.caves.shouldCarve(x, y, z, height)) {
              block = y < Math.max(SEA_LEVEL - 3, hydro.waterLevel - 4) ? BlockId.WATER : BlockId.AIR;
            } else if (y === height) {
              block = this.surfaceBlock(x, z, height, biome.id);
            } else if (y > height - 4) {
              block = this.subsurfaceBlock(height, biome.id);
            } else {
              block = this.ores.oreForStone(x, y, z, isMountainBiome(biome.id) || biome.id === "snow");
            }
          } else if (y <= Math.max(SEA_LEVEL, hydro.waterLevel) && (hydro.river > 0.42 || hydro.stream > 0.72 || hydro.lake > 0.48 || y <= SEA_LEVEL)) {
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
        const macro = this.macro.sample(x, z);
        const hydro = macro.hydrology;
        const region = height > SEA_LEVEL + 2
          ? this.regions.sampleColumn(x, z, height, biomeId, (wx, wz) => this.getHeight(wx, wz), Math.max(hydro.river, hydro.stream * 0.7, hydro.lake * 0.6))
          : null;
        if (region?.surface) {
          chunk.setLocal(lx, height, lz, region.surface);
        }
        if (region && region.blocks.length > 0) {
          for (const block of region.blocks) {
            const y = height + block.dy;
            if (y >= 0 && y < WORLD_HEIGHT) chunk.setLocal(lx, y, lz, block.block);
          }
          continue;
        }
        if (region?.blocksDecoration) {
          continue;
        }
        const poi = height > SEA_LEVEL + 2 ? this.living.poiAt(x, z, biomeId, height) : null;
        if (poi) {
          this.living.placePoi(chunk, lx, height, lz, poi);
          continue;
        }

        const treePlaced =
          height > SEA_LEVEL + 2 &&
          (isForestBiome(biomeId) || biomeId === "plains" || biomeId === "bocage" || biomeId === "hills" || biomeId === "snow" || biomeId === "tundra") &&
          this.structures.shouldPlaceTree(x, z, biomeId, height);
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
    const macro = this.macro.sample(x, z);
    const hydro = macro.hydrology;
    if (hydro.river > 0.52 || hydro.stream > 0.74) {
      if (hydro.wetland > 0.42 && height <= hydro.waterLevel + 2) return BlockId.MUD;
      return this.noise.fbm2D(x * 0.09, z * 0.09, 2) > 0.04 ? BlockId.GRAVEL : BlockId.SAND;
    }
    if (hydro.lake > 0.48 || biome === "lake" || biome === "riverbank" || biome === "mountain_lake") {
      if (hydro.wetland > 0.55) return BlockId.MUD;
      return height <= hydro.waterLevel + 1 ? BlockId.SAND : BlockId.GRAVEL;
    }
    if (height <= SEA_LEVEL - 7) {
      return this.noise.fbm2D(x * 0.09, z * 0.09, 2) > 0.2 ? BlockId.GRAVEL : BlockId.SAND;
    }
    if (height <= SEA_LEVEL + 2 || biome === "beach" || biome === "dunes") {
      return isDryBiome(biome as BiomeId) ? BlockId.RED_SAND : BlockId.SAND;
    }
    if (isDryBiome(biome as BiomeId)) {
      return this.noise.fbm2D(x * 0.028 + 20, z * 0.028 - 20, 3) > 0.34 ? BlockId.RED_SAND : BlockId.SAND;
    }
    if (biome === "marsh" || biome === "bog") {
      return hydro.wetland > 0.34 ? BlockId.MUD : BlockId.GRASS;
    }
    if (biome === "snow" || biome === "snow_forest" || biome === "glacial_valley" || height > 96) {
      return BlockId.SNOW_BLOCK;
    }
    if (isMountainBiome(biome as BiomeId) && height > 78) {
      return this.noise.fbm2D(x * 0.06, z * 0.06, 2) > 0.18 ? BlockId.STONE : BlockId.GRASS;
    }
    return BlockId.GRASS;
  }

  private subsurfaceBlock(height: number, biome: string): BlockId {
    if (height <= SEA_LEVEL + 2 || biome === "beach" || biome === "dunes" || isDryBiome(biome as BiomeId)) {
      return isDryBiome(biome as BiomeId) ? BlockId.RED_SAND : BlockId.SAND;
    }
    if (isMountainBiome(biome as BiomeId) && height > 82) {
      return BlockId.STONE;
    }
    return BlockId.DIRT;
  }

  private decorativePlant(x: number, z: number, height: number, biome: string): BlockId {
    const surface = this.surfaceBlock(x, z, height, biome);
    if (surface !== BlockId.GRASS && surface !== BlockId.SAND && surface !== BlockId.RED_SAND && surface !== BlockId.MUD) return BlockId.AIR;
    return this.living.decorativePlant(x, z, height, biome as BiomeId);
  }
}
