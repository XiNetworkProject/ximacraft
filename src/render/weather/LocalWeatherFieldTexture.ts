import * as THREE from "three";
import { WeatherEngine } from "../../weather/WeatherEngine";
import { WeatherEvent } from "../../weather/events/WeatherEvent";
import { SquallLineEvent } from "../../weather/events/SquallLineEvent";
import { WeatherEventType } from "../../weather/WeatherTypes";
import { deriveCloudLayerState } from "../../weather/sky/CloudLayerState";

const SIZE = 48;
const UPDATE_INTERVAL = 0.9;

export class LocalWeatherFieldTexture {
  readonly radius = 6000;
  readonly center = new THREE.Vector2();
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(SIZE * SIZE * 4);
  private timer = 0;
  private initialized = false;
  private pendingRow = SIZE;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.name = `LocalWeatherField${SIZE}`;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  update(delta: number, engine: WeatherEngine, observerX: number, observerZ: number): void {
    this.timer -= delta;
    const moved = !this.initialized || Math.hypot(observerX - this.center.x, observerZ - this.center.y) > 160;
    if (this.pendingRow >= SIZE) {
      if (this.timer > 0 && !moved) return;
      this.timer = UPDATE_INTERVAL;
      this.initialized = true;
      this.center.set(Math.round(observerX / 64) * 64, Math.round(observerZ / 64) * 64);
      this.pendingRow = 0;
    } else if (moved) {
      this.center.set(Math.round(observerX / 64) * 64, Math.round(observerZ / 64) * 64);
      this.pendingRow = 0;
    }

    const events = engine.getActiveEvents();
    const endRow = Math.min(SIZE, this.pendingRow + 8);
    for (let py = this.pendingRow; py < endRow; py += 1) {
      const worldZ = this.center.y + ((py + 0.5) / SIZE * 2 - 1) * this.radius;
      for (let px = 0; px < SIZE; px += 1) {
        const worldX = this.center.x + ((px + 0.5) / SIZE * 2 - 1) * this.radius;
        const local = engine.sampleAt(worldX, worldZ);
        const layers = deriveCloudLayerState(local);
        let coverage = layers.stratiformCover;
        let precipitation = local.precipitation * 0.62;
        let convection = layers.deepConvection;
        let dominant = 0;

        for (const event of events) {
          const influence = this.eventInfluence(event, worldX, worldZ);
          if (influence <= 0) continue;
          const strength = influence * event.intensity * this.lifeFade(event);
          if (event.type === WeatherEventType.CLEARING) {
            coverage *= 1 - strength * 0.92;
            precipitation *= 1 - strength;
            convection *= 1 - strength;
            continue;
          }
          const convectiveEvent = event.type === WeatherEventType.STORM_CELL
            || event.type === WeatherEventType.SQUALL_LINE;
          if (convectiveEvent) {
            // A finite storm owns a 3D volume. It must not become a broad dome
            // layer merely because its cells have cloudCover=1.
            coverage *= 1 - strength * 0.94;
          } else if (event.type === WeatherEventType.COLD_FRONT) {
            coverage = Math.max(coverage, strength * 0.34);
          } else {
            coverage = Math.max(coverage, strength);
          }
          if (event.precip !== "none") precipitation = Math.max(precipitation, strength);
          if (event.producesLightning) convection = Math.max(convection, strength);
          dominant = Math.max(dominant, strength);
        }

        const index = (py * SIZE + px) * 4;
        this.data[index] = Math.round(THREE.MathUtils.clamp(coverage, 0, 1) * 255);
        this.data[index + 1] = Math.round(THREE.MathUtils.clamp(precipitation, 0, 1) * 255);
        this.data[index + 2] = Math.round(THREE.MathUtils.clamp(convection, 0, 1) * 255);
        this.data[index + 3] = Math.round(THREE.MathUtils.clamp(dominant, 0, 1) * 255);
      }
    }
    this.pendingRow = endRow;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private eventInfluence(event: WeatherEvent, x: number, z: number): number {
    const dx = x - event.x;
    const dz = z - event.z;
    if (event instanceof SquallLineEvent) {
      const along = dx * event.dirX + dz * event.dirZ;
      const across = dx * -event.dirZ + dz * event.dirX;
      const band = 1 - this.smoothstep(Math.abs(along) / Math.max(1, event.thickness));
      const end = 1 - this.smoothstep(Math.max(0, Math.abs(across) - event.length * 0.5) / Math.max(1, event.thickness));
      return band * end;
    }
    return 1 - this.smoothstep(Math.hypot(dx, dz) / Math.max(1, event.radius));
  }

  private lifeFade(event: WeatherEvent): number {
    const fadeIn = this.smoothstep(event.age / 10);
    const fadeOut = this.smoothstep((event.maxAge - event.age) / 14);
    return Math.min(fadeIn, fadeOut);
  }

  private smoothstep(value: number): number {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }
}
