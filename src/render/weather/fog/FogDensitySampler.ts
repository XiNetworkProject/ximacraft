import { FogBankRenderSample } from "../../../environment/FogBankSystem";
import type { EnvironmentState } from "../../../environment/EnvironmentState";
import { FogHeightField, FogHeightProfile } from "./FogHeightField";
import { FogLodSettings } from "./FogLodSystem";
import { FogNoiseField } from "./FogNoiseField";

export interface FogVolumeLayer {
  id: string;
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationY: number;
  opacity: number;
  color: number;
  seed: number;
}

export interface FogDensityContext {
  time: number;
  cameraX: number;
  cameraZ: number;
  windX: number;
  windZ: number;
  sunExposure: number;
  environment: EnvironmentState | null;
  getHeight: (x: number, z: number) => number;
}

export class FogDensitySampler {
  private readonly noise = new FogNoiseField();
  private readonly heights = new FogHeightField();

  layersFor(sample: FogBankRenderSample, lod: FogLodSettings, context: FogDensityContext): FogVolumeLayer[] {
    const profile = this.heights.profileFor(sample, context.getHeight, context.environment);
    const layers: FogVolumeLayer[] = [];
    const distance = Math.hypot(sample.x - context.cameraX, sample.z - context.cameraZ);
    const distanceFade = Math.min(1, Math.max(0, lod.distanceFade));
    const sunFade = 1 - Math.min(0.62, context.sunExposure * (sample.kind === "radiation" ? 0.78 : 0.42));
    const density = sample.density * distanceFade * sunFade;
    if (density <= 0.025) return layers;

    const heightSpan = Math.max(2, profile.topY - profile.baseY);
    for (let i = 0; i < lod.slices; i += 1) {
      const t = (i + 0.5) / lod.slices;
      const seed = this.seedFor(sample, i);
      const drift = context.time * 0.006;
      const n = this.noise.fbm3(sample.x * 0.004 + seed * 7 + drift, t * 3.7, sample.z * 0.004 - seed * 3 - drift, 4);
      const side = (n - 0.5) * sample.radius * 0.2;
      const along = (this.noise.smooth3(seed * 11, t * 4, context.time * 0.01) - 0.5) * sample.radius * 0.28;
      const windShear = heightSpan * t * 0.22;
      const windLen = Math.hypot(context.windX, context.windZ) || 1;
      const wx = context.windX / windLen;
      const wz = context.windZ / windLen;
      const px = -wz;
      const pz = wx;
      const radiusFade = 1 - t * (sample.kind === "valley" ? 0.32 : 0.48);
      const radiusNoise = 0.78 + n * 0.34;
      const layerDensity = density * verticalDensity(t, profile, sample.kind) * (0.7 + n * 0.55);
      if (layerDensity <= 0.018) continue;
      layers.push({
        id: `${sample.id}:${i}`,
        x: sample.x + px * side + wx * (along + windShear),
        y: profile.baseY + heightSpan * t + (n - 0.5) * Math.min(3.5, heightSpan * 0.22),
        z: sample.z + pz * side + wz * (along + windShear),
        scaleX: sample.radius * (sample.kind === "valley" ? 1.24 : sample.kind === "river" ? 0.92 : 1.05) * radiusFade * radiusNoise,
        scaleY: Math.max(1.6, heightSpan / lod.slices * (0.82 + n * 0.55)),
        scaleZ: sample.radius * (sample.kind === "river" ? 0.44 : sample.kind === "valley" ? 0.72 : 0.62) * radiusFade * (0.86 + n * 0.22),
        rotationY: seed * Math.PI * 2 + t * 1.7 + context.time * 0.006 * (seed > 0.5 ? 1 : -1),
        opacity: Math.min(0.38, layerDensity) * sunFade,
        color: colorFor(sample.kind, context.environment),
        seed,
      });
    }
    return layers;
  }

  heightProfileFor(sample: FogBankRenderSample, context: FogDensityContext): FogHeightProfile {
    return this.heights.profileFor(sample, context.getHeight, context.environment);
  }

  private seedFor(sample: FogBankRenderSample, layer: number): number {
    let h = 2166136261;
    const key = `${sample.id}:${layer}`;
    for (let i = 0; i < key.length; i += 1) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }
}

function verticalDensity(t: number, profile: FogHeightProfile, kind: string): number {
  const lowBias = kind === "river" || kind === "valley" || kind === "freezing" ? 1.18 : 0.92;
  const cap = Math.max(0, 1 - t * t * (kind === "advection" ? 0.58 : 0.86));
  const valley = 0.72 + profile.valleyFactor * 0.36;
  return Math.max(0, lowBias * cap * valley);
}

function colorFor(kind: string, environment: EnvironmentState | null): number {
  if (kind === "freezing") return 0xeaf4ff;
  if (kind === "river") return environment?.temperature !== undefined && environment.temperature < 3 ? 0xe8f4ff : 0xdce8ee;
  if (kind === "valley") return 0xd8dee4;
  if (kind === "radiation") return 0xe0e6ea;
  return 0xd5dce2;
}
