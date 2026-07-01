import { WeatherSample, WeatherType } from "../weather/WeatherTypes";
import { SurfaceWeatherState } from "../weather/ground/SurfaceWeatherState";
import { World } from "../world/World";
import { BlockId, isPlant, isSnowLayer } from "../world/BlockTypes";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../utils/Constants";

export interface SurfaceTrace {
  x: number;
  y: number;
  z: number;
  createdAt: number;
  ttl: number;
  strength: number;
}

export interface WorldMemorySnapshot {
  ageSeconds: number;
  biomes: string[];
  weather: string[];
  structures: string[];
  traceCount: number;
  maxAltitude: number;
  distanceTravelled: number;
  lastBiome?: string;
  lastWeather?: string;
}

export class WorldMemorySystem {
  private timer = 0;
  private cursor = 0;
  private age = 0;
  private readonly traces: SurfaceTrace[] = [];
  private readonly seenBiomes = new Set<string>();
  private readonly seenWeather = new Set<string>();
  private readonly seenStructures = new Set<string>();
  private maxAltitude = 0;
  private distanceTravelled = 0;
  private lastPlayer: { x: number; z: number } | null = null;
  private lastBiome = "";
  private lastWeather = "";

  update(delta: number, world: World, surface: SurfaceWeatherState, player: { x: number; z: number }, sample: WeatherSample): void {
    this.age += delta;
    this.updateExploration(world, player, sample);
    this.pruneTraces(sample);
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = sample.windSpeed > 16 || sample.precipitation > 0.1 ? 1.2 : 2.8;

    for (let i = 0; i < 8; i += 1) {
      this.cursor += 1;
      const angle = this.cursor * 2.399963229728653;
      const radius = 8 + ((this.cursor * 37) % 28);
      const x = Math.floor(player.x + Math.cos(angle) * radius);
      const z = Math.floor(player.z + Math.sin(angle) * radius);
      const y = world.getSurfaceHeight(x, z);
      const base = world.getBlock(x, y, z);
      const above = world.getBlock(x, y + 1, z);
      if (above !== BlockId.AIR && !isPlant(above) && !isSnowLayer(above)) continue;
      const col = surface.get(x, z);
      const wet = col?.wetness ?? 0;
      if (this.shouldLeaveTracks(base, above, wet, sample)) {
        this.addTrace(x, y + 1, z, wet, sample);
        continue;
      }
      if (this.shouldDropBranch(base, above, sample)) {
        world.setBlock(x, y + 1, z, (this.cursor & 1) === 0 ? BlockId.SPRUCE_LOG_X : BlockId.OAK_LOG_Z);
      }
    }
  }

  debug(sample: WeatherSample): string {
    return `WorldMemory traces=${this.traces.length} wind=${sample.windSpeed.toFixed(1)} precip=${sample.precipitation.toFixed(2)}`;
  }

  getSurfaceTraces(): readonly SurfaceTrace[] {
    return this.traces;
  }

  snapshot(): WorldMemorySnapshot {
    return {
      ageSeconds: this.age,
      biomes: [...this.seenBiomes].sort(),
      weather: [...this.seenWeather].sort(),
      structures: [...this.seenStructures].sort(),
      traceCount: this.traces.length,
      maxAltitude: this.maxAltitude,
      distanceTravelled: this.distanceTravelled,
      lastBiome: this.lastBiome || undefined,
      lastWeather: this.lastWeather || undefined,
    };
  }

  cleanupGeneratedTrackBlocks(world: World): number {
    let removed = 0;
    for (const chunk of world.chunks.values()) {
      for (let y = 0; y < WORLD_HEIGHT; y += 1) {
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            if (chunk.getLocal(x, y, z) === BlockId.ANIMAL_TRACKS) {
              chunk.setLocal(x, y, z, BlockId.AIR);
              removed += 1;
            }
          }
        }
      }
      if (removed > 0) chunk.dirty = true;
    }
    for (const [key, blockId] of world.blockChanges.entries()) {
      if (blockId === BlockId.ANIMAL_TRACKS) {
        world.blockChanges.delete(key);
      }
    }
    this.traces.length = 0;
    return removed;
  }

  private updateExploration(world: World, player: { x: number; z: number }, sample: WeatherSample): void {
    if (this.lastPlayer) {
      const step = Math.hypot(player.x - this.lastPlayer.x, player.z - this.lastPlayer.z);
      if (step < 80) this.distanceTravelled += step;
    }
    this.lastPlayer = { x: player.x, z: player.z };
    const x = Math.floor(player.x);
    const z = Math.floor(player.z);
    const height = world.getSurfaceHeight(x, z);
    const biome = world.getBiomeAt(x, z).id;
    this.lastBiome = biome;
    this.lastWeather = sample.weatherType;
    this.maxAltitude = Math.max(this.maxAltitude, height);
    this.seenBiomes.add(biome);
    this.seenWeather.add(sample.weatherType);

    const settlement = world.terrain.regions.settlementAt(x, z, height, biome, (wx, wz) => world.getSurfaceHeight(wx, wz));
    if (settlement) this.seenStructures.add(settlement.kind === "village" ? "village" : "hameau");
    for (let dz = -48; dz <= 48; dz += 24) {
      for (let dx = -48; dx <= 48; dx += 24) {
        const sx = x + dx;
        const sz = z + dz;
        const sy = world.getSurfaceHeight(sx, sz);
        const sampleBiome = world.getBiomeAt(sx, sz).id;
        const poi = world.terrain.living.poiAt(sx, sz, sampleBiome, sy);
        if (poi) this.seenStructures.add(poi);
      }
    }
  }

  private shouldLeaveTracks(base: BlockId, above: BlockId, wetness: number, sample: WeatherSample): boolean {
    if (above !== BlockId.AIR && !isSnowLayer(above)) return false;
    const hash = (this.cursor * 1103515245 + 12345) >>> 0;
    const roll = (hash % 1000) / 1000;
    if (isSnowLayer(above) || base === BlockId.SNOW_BLOCK) return roll < 0.18;
    if (base === BlockId.SAND || base === BlockId.RED_SAND) return roll < 0.07;
    if (base === BlockId.MUD || wetness > 0.42) return roll < 0.12;
    return false;
  }

  private shouldDropBranch(base: BlockId, above: BlockId, sample: WeatherSample): boolean {
    if (above !== BlockId.AIR || (base !== BlockId.GRASS && base !== BlockId.DIRT && base !== BlockId.MUD)) return false;
    if (sample.windSpeed < 17 && sample.weatherType !== WeatherType.THUNDERSTORM) return false;
    const hash = (this.cursor * 1664525 + 1013904223) >>> 0;
    return (hash % 1000) / 1000 < 0.018;
  }

  private addTrace(x: number, y: number, z: number, wetness: number, sample: WeatherSample): void {
    const existing = this.traces.find((trace) => Math.abs(trace.x - x) <= 1 && Math.abs(trace.z - z) <= 1 && Math.abs(trace.y - y) <= 1);
    if (existing) {
      existing.createdAt = this.age;
      existing.strength = Math.min(1, existing.strength + 0.18);
      return;
    }
    const stormWear = sample.precipitation > 0.35 || sample.windSpeed > 18 ? 0.45 : 1;
    const ttl = (60 + wetness * 180) * stormWear;
    this.traces.push({ x, y, z, createdAt: this.age, ttl, strength: 0.45 + wetness * 0.45 });
    if (this.traces.length > 256) {
      this.traces.splice(0, this.traces.length - 256);
    }
  }

  private pruneTraces(sample: WeatherSample): void {
    if (this.traces.length === 0) return;
    const weatherWear = sample.precipitation > 0.08 ? 2.2 : sample.windSpeed > 16 ? 1.35 : 1;
    for (let i = this.traces.length - 1; i >= 0; i -= 1) {
      const trace = this.traces[i];
      if ((this.age - trace.createdAt) * weatherWear > trace.ttl) {
        this.traces.splice(i, 1);
      }
    }
  }
}
