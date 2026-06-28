import * as THREE from "three";
import { BlockRegistry } from "./BlockRegistry";
import { BlockId } from "./BlockTypes";
import { Chunk } from "./Chunk";
import { TerrainGenerator } from "./TerrainGenerator";
import { blockKey, chunkKey, parseBlockKey, worldToChunk, worldToLocal } from "../utils/MathUtils";
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "../utils/Constants";

export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly blockChanges = new Map<string, BlockId>();
  readonly terrain: TerrainGenerator;
  private readonly chunkCreatedHandlers: Array<(chunk: Chunk) => void> = [];

  constructor(
    readonly seed: string,
    readonly blockRegistry: BlockRegistry,
    savedChanges?: Record<string, number>,
  ) {
    this.terrain = new TerrainGenerator(seed);
    if (savedChanges) {
      Object.entries(savedChanges).forEach(([key, value]) => this.blockChanges.set(key, value as BlockId));
    }
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  ensureChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.terrain.generateChunk(chunk);
      this.chunks.set(key, chunk);
      this.applySavedChangesToChunk(chunk);
      for (const handler of this.chunkCreatedHandlers) handler(chunk);
    }
    return chunk;
  }

  getBlock(x: number, y: number, z: number): BlockId {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= WORLD_HEIGHT) {
      return BlockId.AIR;
    }
    const chunk = this.getChunk(worldToChunk(x), worldToChunk(z));
    if (!chunk) {
      return BlockId.AIR;
    }
    return chunk.getLocal(worldToLocal(x), iy, worldToLocal(z));
  }

  setBlock(x: number, y: number, z: number, blockId: BlockId, trackChange = true): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    if (iy < 0 || iy >= WORLD_HEIGHT) {
      return;
    }

    const cx = worldToChunk(ix);
    const cz = worldToChunk(iz);
    const chunk = this.ensureChunk(cx, cz);
    chunk.setLocal(worldToLocal(ix), iy, worldToLocal(iz), blockId);
    if (trackChange) {
      this.blockChanges.set(blockKey(ix, iy, iz), blockId);
    }

    this.markNeighborsDirty(ix, iy, iz);
  }

  isSolidBlock(x: number, y: number, z: number): boolean {
    return this.blockRegistry.isSolid(this.getBlock(x, y, z));
  }

  getBlockCollisionHeight(x: number, y: number, z: number): number {
    const block = this.blockRegistry.get(this.getBlock(x, y, z));
    return block.solid ? block.collisionHeight ?? 1 : 0;
  }

  onChunkCreated(handler: (chunk: Chunk) => void): () => void {
    this.chunkCreatedHandlers.push(handler);
    return () => {
      const index = this.chunkCreatedHandlers.indexOf(handler);
      if (index >= 0) this.chunkCreatedHandlers.splice(index, 1);
    };
  }

  getSurfaceHeight(x: number, z: number): number {
    return this.terrain.getHeight(Math.floor(x), Math.floor(z));
  }

  getBiomeAt(x: number, z: number) {
    const height = this.getSurfaceHeight(x, z);
    return this.terrain.biomes.sample(x, z, height);
  }

  getSpawnPosition(): THREE.Vector3 {
    for (let radius = 0; radius <= 512; radius += 16) {
      for (let z = -radius; z <= radius; z += 16) {
        for (let x = -radius; x <= radius; x += 16) {
          if (Math.abs(x) !== radius && Math.abs(z) !== radius) {
            continue;
          }
          const y = this.getSurfaceHeight(x, z);
          if (y > SEA_LEVEL + 4) {
            return new THREE.Vector3(x + 0.5, y + 3, z + 0.5);
          }
        }
      }
    }
    const y = Math.max(this.getSurfaceHeight(0, 0) + 3, SEA_LEVEL + 6);
    return new THREE.Vector3(0.5, y, 0.5);
  }

  serializeChanges(): Record<string, number> {
    return Object.fromEntries(this.blockChanges.entries());
  }

  regenerateLoadedChunks(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      chunk.blocks.fill(BlockId.AIR);
      chunk.generated = false;
      chunk.dirty = true;
      this.terrain.generateChunk(chunk);
      this.applySavedChangesToChunk(chunk);
      for (const handler of this.chunkCreatedHandlers) handler(chunk);
      count += 1;
    }
    return count;
  }

  private applySavedChangesToChunk(chunk: Chunk): void {
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE - 1;
    const maxZ = minZ + CHUNK_SIZE - 1;

    for (const [key, blockId] of this.blockChanges.entries()) {
      const [x, y, z] = parseBlockKey(key);
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ && y >= 0 && y < WORLD_HEIGHT) {
        chunk.setLocal(worldToLocal(x), y, worldToLocal(z), blockId);
      }
    }
  }

  private markNeighborsDirty(x: number, _y: number, z: number): void {
    const cx = worldToChunk(x);
    const cz = worldToChunk(z);
    this.getChunk(cx, cz)!.dirty = true;
    if (worldToLocal(x) === 0) this.getChunk(cx - 1, cz) && (this.getChunk(cx - 1, cz)!.dirty = true);
    if (worldToLocal(x) === CHUNK_SIZE - 1) this.getChunk(cx + 1, cz) && (this.getChunk(cx + 1, cz)!.dirty = true);
    if (worldToLocal(z) === 0) this.getChunk(cx, cz - 1) && (this.getChunk(cx, cz - 1)!.dirty = true);
    if (worldToLocal(z) === CHUNK_SIZE - 1) this.getChunk(cx, cz + 1) && (this.getChunk(cx, cz + 1)!.dirty = true);
  }
}
