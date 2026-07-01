import { BlockRegistry } from "./BlockRegistry";
import { BlockId } from "./BlockTypes";

export type LocalLightSample = {
  intensity: number;
  r: number;
  g: number;
  b: number;
  sources: number;
};

type LightReadableWorld = {
  getBlock(x: number, y: number, z: number): BlockId | number;
};

const NO_LOCAL_LIGHT: LocalLightSample = { intensity: 0, r: 1, g: 1, b: 1, sources: 0 };

export class LightingEngine {
  private readonly sampleCache = new Map<string, LocalLightSample>();
  private readonly maxCacheEntries = 5000;

  constructor(private readonly blocks: BlockRegistry) {}

  getEmission(blockId: BlockId): number {
    return this.blocks.get(blockId).lightLevel ?? 0;
  }

  isLightSource(blockId: BlockId | number): boolean {
    return this.getEmission(blockId as BlockId) > 0;
  }

  clearCache(): void {
    this.sampleCache.clear();
  }

  sampleLocalLight(world: LightReadableWorld, x: number, y: number, z: number, radius = 7): LocalLightSample {
    const r = Math.max(1, Math.min(10, Math.round(radius)));
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const key = `${ix >> 1}:${iy >> 1}:${iz >> 1}:${r}`;
    const cached = this.sampleCache.get(key);
    if (cached) return cached;

    let intensity = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let sources = 0;
    const radiusSq = r * r;

    for (let dy = -r; dy <= r; dy += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > radiusSq) continue;
          const blockId = world.getBlock(ix + dx, iy + dy, iz + dz) as BlockId;
          const emission = this.getEmission(blockId);
          if (emission <= 0) continue;

          const dist = Math.sqrt(distSq);
          const falloff = Math.pow(Math.max(0, 1 - dist / (r + 1)), 1.65);
          const strength = (emission / 15) * falloff;
          if (strength <= 0.001) continue;

          const tint = this.emissionTint(blockId);
          intensity += strength;
          red += tint.r * strength;
          green += tint.g * strength;
          blue += tint.b * strength;
          sources += 1;
        }
      }
    }

    const sample = intensity <= 0
      ? NO_LOCAL_LIGHT
      : {
          intensity: Math.min(1.6, intensity),
          r: red / intensity,
          g: green / intensity,
          b: blue / intensity,
          sources,
        };

    if (this.sampleCache.size > this.maxCacheEntries) {
      this.sampleCache.clear();
    }
    this.sampleCache.set(key, sample);
    return sample;
  }

  private emissionTint(blockId: BlockId): { r: number; g: number; b: number } {
    const key = this.blocks.get(blockId).key;
    if (key.includes("sea_lantern")) return { r: 0.62, g: 0.95, b: 1.05 };
    if (key.includes("furnace") || key.includes("campfire")) return { r: 1.18, g: 0.58, b: 0.28 };
    if (key.includes("lantern")) return { r: 1.12, g: 0.78, b: 0.42 };
    if (key.includes("crying_obsidian")) return { r: 0.58, g: 0.32, b: 1.08 };
    if (key.includes("glowstone")) return { r: 1.12, g: 0.92, b: 0.5 };
    return { r: 1, g: 0.86, b: 0.62 };
  }
}
