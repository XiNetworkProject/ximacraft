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

export class FogVolumeRenderer {
  private readonly pool: FogLayerPool;
  private readonly sampler = new FogDensitySampler();
  private readonly lod = new FogLodSystem();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.pool = new FogLayerPool(scene);
  }

  update(
    delta: number,
    director: EnvironmentDirector,
    camera: THREE.Vector3,
    quality: QualityPreset,
    context: FogVolumeUpdateContext = {},
  ): void {
    this.time += delta;
    const environment = context.environment ?? director.state;
    const getHeight = context.getHeight ?? (() => SEA_LEVEL);
    const maxDistance = this.lod.maxDistance(quality);
    const windX = environment?.weather.windX ?? 0;
    const windZ = environment?.weather.windZ ?? 0;
    const layers: FogVolumeLayer[] = [];

    for (const sample of director.fogRenderSamples(camera.x, camera.z, maxDistance)) {
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
  }

  dispose(): void {
    this.pool.dispose();
  }
}
