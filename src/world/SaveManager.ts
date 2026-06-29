import { SAVE_SLOT_KEY } from "../utils/Constants";
import { IndexedDbStore } from "../utils/IndexedDbStore";
import { GameMode } from "../player/GameMode";
import { InventorySlot } from "../player/PlayerInventory";
import { WeatherSaveData } from "./WeatherTypes";
import { SurfaceWeatherSaveData } from "../weather/persistence/SurfaceWeatherSaveData";
import { RegionalSnowSaveData } from "../weather/ground/WorldSnowSystem";
import { SeasonId } from "../living/SeasonSystem";
import { WORLD_DAY_TICKS } from "../utils/Constants";

const WORLD_INDEX_KEY = `${SAVE_SLOT_KEY}-world-index`;
const DEFAULT_WORLD_ID = "default";

export type SaveData = {
  version: 1;
  seed: string;
  worldOptions?: {
    difficulty?: "peaceful" | "normal" | "hard";
    startSeason?: SeasonId | "auto";
    dynamicWeather?: boolean;
    dynamicSeasons?: boolean;
    worldQuality?: "standard" | "large" | "wild";
  };
  player: {
    position: number[];
    velocity: number[];
    gameMode: GameMode;
    creativeFlying: boolean;
    health: number;
    hunger: number;
    inventory: Array<InventorySlot | null>;
    selectedHotbarIndex: number;
  };
  time: {
    ticks: number;
    speed: number;
  };
  weather: WeatherSaveData;
  surfaceWeather?: SurfaceWeatherSaveData;
  regionalSnow?: RegionalSnowSaveData;
  blockChanges: Record<string, number>;
};

export type WorldSummary = {
  id: string;
  name: string;
  seed: string;
  createdAt: number;
  updatedAt: number;
  lastPlayedAt: number;
  mode?: GameMode;
  playTimeTicks?: number;
  timeTicks?: number;
  season?: SeasonId;
  weather?: string;
  thumbnailKey?: string;
  worldOptions?: SaveData["worldOptions"];
};

export class SaveManager {
  private readonly store = new IndexedDbStore<SaveData>();
  private readonly indexStore = new IndexedDbStore<WorldSummary[]>();

  async listWorlds(): Promise<WorldSummary[]> {
    const fromDb = await this.indexStore.get(WORLD_INDEX_KEY);
    const fromLocal = this.readLocalIndex();
    let worlds = fromDb ?? fromLocal ?? [];
    if (worlds.length === 0) {
      const legacy = await this.load(DEFAULT_WORLD_ID, true);
      if (legacy) {
        worlds = [this.summaryFromSave(DEFAULT_WORLD_ID, "Monde local", legacy)];
        await this.writeIndex(worlds);
      }
    }
    return worlds.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  }

  async load(worldId = DEFAULT_WORLD_ID, skipLegacyIndex = false): Promise<SaveData | null> {
    const key = this.keyFor(worldId);
    const fromDb = await this.store.get(key);
    if (fromDb) return fromDb;
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as SaveData;
    if (worldId !== DEFAULT_WORLD_ID || skipLegacyIndex) return null;
    const legacy = localStorage.getItem(SAVE_SLOT_KEY);
    return legacy ? (JSON.parse(legacy) as SaveData) : null;
  }

  async save(data: SaveData, worldId = DEFAULT_WORLD_ID, name?: string): Promise<void> {
    const key = this.keyFor(worldId);
    const saved = await this.store.set(key, data);
    if (!saved) {
      localStorage.setItem(key, JSON.stringify(data));
    }
    await this.upsertSummary(this.summaryFromSave(worldId, name ?? "Monde local", data));
  }

  async clear(worldId = DEFAULT_WORLD_ID): Promise<void> {
    const key = this.keyFor(worldId);
    await this.store.delete(key);
    localStorage.removeItem(key);
    if (worldId === DEFAULT_WORLD_ID) localStorage.removeItem(SAVE_SLOT_KEY);
    const worlds = (await this.listWorlds()).filter((world) => world.id !== worldId);
    await this.writeIndex(worlds);
  }

  async registerWorld(id: string, name: string, seed: string): Promise<WorldSummary> {
    const now = Date.now();
    const summary: WorldSummary = {
      id,
      name: name.trim() || "Nouveau monde",
      seed,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: now,
      mode: "creative",
      playTimeTicks: 0,
      timeTicks: 0,
      season: "spring",
      weather: "clear",
      thumbnailKey: this.thumbnailKey(seed),
    };
    await this.upsertSummary(summary);
    return summary;
  }

  async renameWorld(worldId: string, name: string): Promise<void> {
    const worlds = await this.listWorlds();
    const trimmed = name.trim();
    if (!trimmed) return;
    await this.writeIndex(worlds.map((world) =>
      world.id === worldId
        ? { ...world, name: trimmed, updatedAt: Date.now() }
        : world,
    ));
  }

  async duplicateWorld(worldId: string): Promise<WorldSummary | null> {
    const source = await this.load(worldId);
    const sourceSummary = (await this.listWorlds()).find((world) => world.id === worldId);
    if (!source) return null;
    const copyId = `${worldId.replace(/[^a-z0-9-]/gi, "-")}-copy-${Date.now().toString(36)}`;
    const copyName = `${sourceSummary?.name ?? "Monde"} copie`;
    const copy: SaveData = JSON.parse(JSON.stringify(source)) as SaveData;
    await this.save(copy, copyId, copyName);
    return (await this.listWorlds()).find((world) => world.id === copyId) ?? null;
  }

  async markPlayed(worldId: string): Promise<void> {
    const worlds = await this.listWorlds();
    const now = Date.now();
    await this.writeIndex(worlds.map((world) =>
      world.id === worldId
        ? { ...world, lastPlayedAt: now, updatedAt: now }
        : world,
    ));
  }

  private keyFor(worldId: string): string {
    return worldId === DEFAULT_WORLD_ID ? SAVE_SLOT_KEY : `${SAVE_SLOT_KEY}:${worldId}`;
  }

  private summaryFromSave(worldId: string, name: string, data: SaveData): WorldSummary {
    const now = Date.now();
    return {
      id: worldId,
      name,
      seed: data.seed,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: now,
      mode: data.player.gameMode,
      playTimeTicks: Math.max(0, Math.floor(data.time.ticks)),
      timeTicks: data.time.ticks,
      season: seasonForTicks(data.time.ticks),
      weather: data.weather.current,
      thumbnailKey: this.thumbnailKey(data.seed),
      worldOptions: data.worldOptions,
    };
  }

  private async upsertSummary(summary: WorldSummary): Promise<void> {
    const worlds = await this.listWorlds();
    const existing = worlds.find((world) => world.id === summary.id);
    const merged: WorldSummary = {
      ...existing,
      ...summary,
      name: summary.name || existing?.name || "Monde local",
      createdAt: existing?.createdAt ?? summary.createdAt,
      updatedAt: Date.now(),
      lastPlayedAt: Date.now(),
      thumbnailKey: summary.thumbnailKey ?? existing?.thumbnailKey ?? this.thumbnailKey(summary.seed),
    };
    await this.writeIndex([merged, ...worlds.filter((world) => world.id !== summary.id)]);
  }

  private async writeIndex(worlds: WorldSummary[]): Promise<void> {
    const saved = await this.indexStore.set(WORLD_INDEX_KEY, worlds);
    if (!saved) {
      localStorage.setItem(WORLD_INDEX_KEY, JSON.stringify(worlds));
    }
  }

  private readLocalIndex(): WorldSummary[] | null {
    const raw = localStorage.getItem(WORLD_INDEX_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as WorldSummary[];
    } catch {
      return null;
    }
  }

  private thumbnailKey(seed: string): string {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}

function seasonForTicks(ticks: number): SeasonId {
  const day = Math.floor(ticks / WORLD_DAY_TICKS) % 96;
  if (day < 24) return "spring";
  if (day < 48) return "summer";
  if (day < 72) return "autumn";
  return "winter";
}
