import * as THREE from "three";
import { SEA_LEVEL } from "../../../utils/Constants";
import { EnvironmentDirector } from "../../../environment/EnvironmentDirector";
import type { EnvironmentState } from "../../../environment/EnvironmentState";
import type { QualityPreset } from "../../../game/Settings";
import { FogDensitySampler } from "./FogDensitySampler";
import type { FogVolumeLayer } from "./FogDensitySampler";
import { FogLayerPool } from "./FogLayerPool";
import { FogLodSystem } from "./FogLodSystem";

export interface FogVolumeUpdateContext {
  getHeight?: (x: number, z: number) => number;
  environment?: EnvironmentState | null;
}

export interface FogRendererDebugState {
  enabled: boolean;
  active: boolean;
  authority: "FogVolumeRenderer";
  mode: string;
  densityAtPlayer: number;
  baseY: number;
  topY: number;
  nearestBankDistance: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  terrainInfluence: number;
  horizonVisibility: number;
  stratusFogBlend: number;
  visibleBanks: number;
  visibleLayers: number;
  streamingMs: number;
  renderMs: number;
  legacyRendererActive: boolean;
}

export class FogVolumeRenderer {
  private readonly pool: FogLayerPool;
  private readonly sampler = new FogDensitySampler();
  private readonly lod = new FogLodSystem();
  private time = 0;
  private enabled = true;
  private debugState: FogRendererDebugState = emptyDebug();

  constructor(scene: THREE.Scene) {
    this.pool = new FogLayerPool(scene);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    this.pool.setLayers([], this.time);
    this.debugState = { ...this.debugState, enabled: this.enabled, active: false, visibleBanks: 0, visibleLayers: 0, renderMs: 0 };
  }

  update(
    delta: number,
    director: EnvironmentDirector,
    camera: THREE.Vector3,
    quality: QualityPreset,
    context: FogVolumeUpdateContext = {},
  ): void {
    this.time += delta;
    if (!this.enabled) {
      this.clear();
      return;
    }
    const start = nowMs();
    const environment = context.environment ?? director.state;
    const getHeight = context.getHeight ?? (() => SEA_LEVEL);
    const maxDistance = this.lod.maxDistance(quality);
    const windX = environment?.weather.windX ?? 0;
    const windZ = environment?.weather.windZ ?? 0;
    const layers: FogVolumeLayer[] = [];
    const samples = director.fogRenderSamples(camera.x, camera.z, maxDistance);
    const streamMs = nowMs() - start;
    const renderStart = nowMs();

    for (const sample of samples) {
      const distance = Math.hypot(sample.x - camera.x, sample.z - camera.z);
      const lod = this.lod.settingsFor(distance, sample.density, quality);
      if (layers.length / Math.max(1, lod.slices) > lod.maxBanks) break;
      layers.push(...this.sampler.layersFor(sample, lod, {
        time: this.time,
        cameraX: camera.x,
        cameraZ: camera.z,
        windX,
        windZ,
        sunExposure: environment?.sunExposure ?? 0.4,
        environment,
        getHeight,
      }));
    }

    this.pool.setLayers(layers, this.time);
    const renderMs = nowMs() - renderStart;
    const fog = environment?.fog;
    this.debugState = {
      enabled: this.enabled,
      active: layers.length > 0 || (fog?.density ?? 0) > 0.04,
      authority: "FogVolumeRenderer",
      mode: fog?.mode ?? "none",
      densityAtPlayer: fog?.density ?? 0,
      baseY: fog?.baseY ?? 0,
      topY: fog?.topY ?? 0,
      nearestBankDistance: fog?.nearestBankDistance ?? -1,
      windX: fog?.windX ?? windX,
      windZ: fog?.windZ ?? windZ,
      windSpeed: fog?.windSpeed ?? Math.hypot(windX, windZ),
      terrainInfluence: fog?.terrainInfluence ?? 0,
      horizonVisibility: fog?.horizonVisibility ?? 1,
      stratusFogBlend: fog?.stratusFogBlend ?? 0,
      visibleBanks: samples.length,
      visibleLayers: this.pool.visibleCount,
      streamingMs: streamMs,
      renderMs,
      legacyRendererActive: fog?.legacyRendererActive ?? false,
    };
  }

  debug(): FogRendererDebugState {
    return this.debugState;
  }

  dispose(): void {
    this.pool.dispose();
  }
}

function emptyDebug(): FogRendererDebugState {
  return {
    enabled: true,
    active: false,
    authority: "FogVolumeRenderer",
    mode: "none",
    densityAtPlayer: 0,
    baseY: 0,
    topY: 0,
    nearestBankDistance: -1,
    windX: 0,
    windZ: 0,
    windSpeed: 0,
    terrainInfluence: 0,
    horizonVisibility: 1,
    stratusFogBlend: 0,
    visibleBanks: 0,
    visibleLayers: 0,
    streamingMs: 0,
    renderMs: 0,
    legacyRendererActive: false,
  };
}

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
