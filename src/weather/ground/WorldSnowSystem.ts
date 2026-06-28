import { CHUNK_SIZE, WORLD_HEIGHT } from "../../utils/Constants";
import { Chunk } from "../../world/Chunk";
import { BlockId, isLeaves, isSnowLayer, snowLayerId } from "../../world/BlockTypes";
import { World } from "../../world/World";
import { WeatherEngine } from "../WeatherEngine";
import { WeatherEventPhase } from "../events/WeatherEventPhase";
import { WeatherSceneState, isSnowPrecip } from "../scene/WeatherScene";

const TILE_SIZE = 64;
const SNOW_RATE = 0.012;
const APPLY_INTERVAL = 0.32;
const APPLY_CHUNKS_PER_TICK = 12;

const PHASE_STRENGTH: Record<WeatherEventPhase, number> = {
  [WeatherEventPhase.FORMING]: 0.25,
  [WeatherEventPhase.DEVELOPING]: 0.62,
  [WeatherEventPhase.MATURE]: 1,
  [WeatherEventPhase.APPROACHING]: 0.9,
  [WeatherEventPhase.IMPACTING]: 1,
  [WeatherEventPhase.PASSING]: 0.72,
  [WeatherEventPhase.DISSIPATING]: 0.28,
};

interface SnowTile {
  tx: number;
  tz: number;
  depth: number;
  lastSnowAt: number;
}

export interface RegionalSnowSaveData {
  version: 1;
  tiles: SnowTile[];
}

/**
 * Persistent, low-resolution snowpack. Weather updates tiles even when terrain
 * chunks are absent; loading a chunk materializes the saved pack as real
 * collision blocks on every exposed column, including tree canopies.
 */
export class WorldSnowSystem {
  private readonly tiles = new Map<string, SnowTile>();
  private accumulator = 0;
  private applyTimer = 0;
  private chunkCursor = 0;
  private readonly removeChunkHook: () => void;

  constructor(
    private readonly engine: WeatherEngine,
    private readonly world: World,
  ) {
    this.removeChunkHook = world.onChunkCreated((chunk) => this.applyChunk(chunk));
  }

  update(dt: number, scene?: Readonly<WeatherSceneState>): void {
    this.accumulator += dt;
    this.applyTimer -= dt;
    if (this.accumulator >= 1) {
      const step = this.accumulator;
      this.accumulator = 0;
      this.updateSnowpack(step, scene);
    }
    if (this.applyTimer <= 0 && this.world.chunks.size > 0) {
      this.applyTimer = APPLY_INTERVAL;
      const chunks = [...this.world.chunks.values()];
      const count = Math.min(APPLY_CHUNKS_PER_TICK, chunks.length);
      for (let index = 0; index < count; index += 1) {
        this.applyChunk(chunks[this.chunkCursor % chunks.length]);
        this.chunkCursor += 1;
      }
    }
  }

  depthAt(x: number, z: number): number {
    return this.tiles.get(this.key(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)))?.depth ?? 0;
  }

  serialize(): RegionalSnowSaveData {
    return { version: 1, tiles: [...this.tiles.values()].map((tile) => ({ ...tile })) };
  }

  restore(data?: RegionalSnowSaveData): void {
    this.tiles.clear();
    if (!data) return;
    for (const tile of data.tiles) {
      if (tile.depth > 0.001) this.tiles.set(this.key(tile.tx, tile.tz), { ...tile });
    }
  }

  dispose(): void {
    this.removeChunkHook();
  }

  private updateSnowpack(dt: number, scene?: Readonly<WeatherSceneState>): void {
    const snowingKeys = new Set<string>();
    // Broad stratiform snowfall is stored as regional tiles, not just around
    // currently loaded chunks. Moving away and returning therefore preserves
    // a coherent snow field and materializes real snow-layer blocks on load.
    if (scene && scene.precipitation.reachesGround && isSnowPrecip(scene.precipitation.kind)) {
      const observer = this.engine.getObserver();
      const centerTx = Math.floor(observer.x / TILE_SIZE);
      const centerTz = Math.floor(observer.z / TILE_SIZE);
      const radius = scene.precipitation.spatialPattern === "uniform" ? 7 : 4;
      for (let tz = centerTz - radius; tz <= centerTz + radius; tz += 1) {
        for (let tx = centerTx - radius; tx <= centerTx + radius; tx += 1) {
          const d = Math.hypot(tx - centerTx, tz - centerTz) / Math.max(1, radius);
          if (d > 1) continue;
          const influence = scene.precipitation.intensity * (0.72 + (1 - d) * 0.28);
          const key = this.key(tx, tz);
          const tile = this.tiles.get(key) ?? { tx, tz, depth: 0, lastSnowAt: this.engine.state.time };
          tile.depth = Math.min(1, tile.depth + SNOW_RATE * influence * dt);
          tile.lastSnowAt = this.engine.state.time;
          this.tiles.set(key, tile);
          snowingKeys.add(key);
        }
      }
    }
    for (const event of this.engine.getActiveEvents()) {
      if (event.precip !== "snow") continue;
      const minTx = Math.floor((event.x - event.radius) / TILE_SIZE);
      const maxTx = Math.floor((event.x + event.radius) / TILE_SIZE);
      const minTz = Math.floor((event.z - event.radius) / TILE_SIZE);
      const maxTz = Math.floor((event.z + event.radius) / TILE_SIZE);
      const phase = PHASE_STRENGTH[event.phase];
      for (let tz = minTz; tz <= maxTz; tz += 1) {
        for (let tx = minTx; tx <= maxTx; tx += 1) {
          const cx = tx * TILE_SIZE + TILE_SIZE * 0.5;
          const cz = tz * TILE_SIZE + TILE_SIZE * 0.5;
          const normalizedDistance = Math.hypot(cx - event.x, cz - event.z) / event.radius;
          if (normalizedDistance >= 1) continue;
          const influence = (1 - normalizedDistance) ** 1.35 * event.intensity * phase;
          if (influence < 0.015) continue;
          const key = this.key(tx, tz);
          const tile = this.tiles.get(key) ?? { tx, tz, depth: 0, lastSnowAt: this.engine.state.time };
          tile.depth = Math.min(1, tile.depth + SNOW_RATE * influence * dt);
          tile.lastSnowAt = this.engine.state.time;
          this.tiles.set(key, tile);
          snowingKeys.add(key);
        }
      }
    }

    for (const [key, tile] of this.tiles) {
      if (snowingKeys.has(key) || this.engine.state.time - tile.lastSnowAt < 35) continue;
      const x = tile.tx * TILE_SIZE + TILE_SIZE * 0.5;
      const z = tile.tz * TILE_SIZE + TILE_SIZE * 0.5;
      const sample = this.engine.sampleAt(x, z);
      if (sample.temperature <= 0) continue;
      const melt = 0.00014 * Math.min(24, sample.temperature) * dt;
      tile.depth = Math.max(0, tile.depth - melt);
      if (tile.depth <= 0.001) this.tiles.delete(key);
    }
  }

  private applyChunk(chunk: Chunk): void {
    const originX = chunk.cx * CHUNK_SIZE;
    const originZ = chunk.cz * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const wx = originX + lx;
        const wz = originZ + lz;
        let desired = this.layerForColumn(wx, wz);
        let existingY = -1;
        let baseY = -1;
        let baseId = BlockId.AIR;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
          const id = chunk.getLocal(lx, y, lz);
          if (isSnowLayer(id)) {
            existingY = y;
            continue;
          }
          if (id !== BlockId.AIR) {
            baseY = y;
            baseId = id;
            break;
          }
        }

        if (isLeaves(baseId) && this.engine.sampleAt(wx, wz).temperature > 0.5) {
          desired = 0;
        } else if (isLeaves(baseId)) {
          const canopyHold = this.hash01(wx * 31 + 7, wz * 17 - 3);
          desired = canopyHold < 0.72 ? 0 : Math.min(2, Math.max(1, desired - 3));
        }

        if (existingY >= 0 && (desired === 0 || baseY < 0 || baseId === BlockId.WATER)) {
          this.world.setBlock(wx, existingY, wz, BlockId.AIR, false);
          continue;
        }
        if (desired === 0 || baseY < 0 || baseY + 1 >= WORLD_HEIGHT || baseId === BlockId.WATER) continue;
        const targetY = baseY + 1;
        const targetId = snowLayerId(desired);
        if (existingY >= 0 && existingY !== targetY) this.world.setBlock(wx, existingY, wz, BlockId.AIR, false);
        if (this.world.getBlock(wx, targetY, wz) !== targetId) {
          this.world.setBlock(wx, targetY, wz, targetId, false);
        }
      }
    }
  }

  private layerForColumn(x: number, z: number): number {
    const depth = this.depthAt(x, z) * 8;
    const base = Math.floor(depth);
    const fraction = depth - base;
    const variation = this.hash01(x, z);
    return Math.max(0, Math.min(8, base + (variation < fraction ? 1 : 0)));
  }

  private hash01(x: number, z: number): number {
    let value = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  private key(tx: number, tz: number): string {
    return `${tx},${tz}`;
  }
}
