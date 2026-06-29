import { GAME_ASSET_MANIFEST, GameAssetEntry } from "../assets/AssetManifest";

export class EntityAssetManager {
  private readonly cache = new Map<string, GameAssetEntry>();

  constructor(entries: GameAssetEntry[] = GAME_ASSET_MANIFEST) {
    for (const entry of entries) {
      if (entry.kind === "model" || entry.kind === "audio") this.cache.set(entry.id, entry);
    }
  }

  get(id: string): GameAssetEntry | undefined {
    return this.cache.get(id);
  }

  list(prefix = ""): GameAssetEntry[] {
    return [...this.cache.values()].filter((entry) => !prefix || entry.id.startsWith(prefix));
  }

  debug(): string {
    const models = this.list().filter((entry) => entry.kind === "model").length;
    const audio = this.list().filter((entry) => entry.kind === "audio").length;
    return `Entity assets models=${models} audio=${audio} licensedEntries=${this.cache.size}`;
  }
}
