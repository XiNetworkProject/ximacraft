import { clamp01, smoothstep } from "../WeatherMath";
import { PrecipKind, WeatherEventType, WeatherSample } from "../WeatherTypes";

export type DistantPrecipitationMode = "off" | "far" | "mid" | "local";
export type DistantPrecipitationQuality = "low" | "balanced" | "high";

export interface DistantPrecipitationEventLike {
  id: number;
  type: WeatherEventType;
  x: number;
  z: number;
  radius: number;
  intensity: number;
  speed: number;
  dirX: number;
  dirZ: number;
  cloudBaseY: number;
  precip: PrecipKind;
  producesLightning: boolean;
}

export interface DistantPrecipitationPatch {
  id: number;
  eventId: number;
  x: number;
  z: number;
  bottomY: number;
  topY: number;
  radiusX: number;
  radiusZ: number;
  density: number;
  opacity: number;
  distance: number;
  mode: Exclude<DistantPrecipitationMode, "off">;
  virga: boolean;
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
  windTiltX: number;
  windTiltZ: number;
  fallSpeed: number;
  seed: number;
}

export interface DistantPrecipitationFieldState {
  active: boolean;
  mode: DistantPrecipitationMode;
  patches: DistantPrecipitationPatch[];
  nearestPatchDistance: number | null;
  rainBandIntensity: number;
  windTilt: number;
  localRainBlend: number;
}

export interface DistantPrecipitationFieldDebug {
  enabled: boolean;
  active: boolean;
  mode: DistantPrecipitationMode;
  patchesVisible: number;
  nearestPatchDistance: number | null;
  rainBandIntensity: number;
  windTilt: number;
  localRainBlend: number;
}

interface QualityBudget {
  maxPatches: number;
  maxDistance: number;
  patchSamples: number;
}

const QUALITY: Record<DistantPrecipitationQuality, QualityBudget> = {
  low: { maxPatches: 8, maxDistance: 6800, patchSamples: 7 },
  balanced: { maxPatches: 14, maxDistance: 8600, patchSamples: 10 },
  high: { maxPatches: 22, maxDistance: 10400, patchSamples: 14 },
};

const EMPTY_STATE: DistantPrecipitationFieldState = {
  active: false,
  mode: "off",
  patches: [],
  nearestPatchDistance: null,
  rainBandIntensity: 0,
  windTilt: 0,
  localRainBlend: 0,
};

export class DistantPrecipitationField {
  private enabled = true;
  private state: DistantPrecipitationFieldState = EMPTY_STATE;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    this.state = EMPTY_STATE;
  }

  update(params: {
    events: readonly DistantPrecipitationEventLike[];
    observerX: number;
    observerZ: number;
    sample: WeatherSample;
    time: number;
    quality: DistantPrecipitationQuality;
    localRainBlend?: number;
  }): DistantPrecipitationFieldState {
    if (!this.enabled) {
      this.clear();
      return this.state;
    }

    const budget = QUALITY[params.quality];
    const localRainBlend = params.localRainBlend ?? DistantPrecipitationField.localRainBlend(params.sample);
    const patches: DistantPrecipitationPatch[] = [];
    let nearestPatchDistance = Infinity;
    let rainBandIntensity = 0;
    let strongestMode: DistantPrecipitationMode = "off";
    const windSpeed = Math.hypot(params.sample.windX, params.sample.windZ);
    const windTilt = clamp01(windSpeed / 24);

    for (const event of params.events) {
      if (patches.length >= budget.maxPatches) break;
      if (!isRainBand(event)) continue;

      rainBandIntensity = Math.max(rainBandIntensity, event.intensity);
      const eventDistance = Math.hypot(event.x - params.observerX, event.z - params.observerZ);
      const mode = modeForDistance(eventDistance, event.radius, localRainBlend);
      strongestMode = combineMode(strongestMode, mode);

      const farFade = 1 - smoothstep(clamp01((eventDistance - budget.maxDistance * 0.76) / (budget.maxDistance * 0.24)));
      if (farFade <= 0.01) continue;
      const localFade = 1 - smoothstep(clamp01((localRainBlend - 0.18) / 0.54)) * 0.72;
      const dir = normalize(event.dirX, event.dirZ, 0, 1);
      const right = { x: -dir.z, z: dir.x };
      const seed = stableEventSeed(event);
      const halfWidth = Math.max(1700, event.radius * 1.55);
      const halfDepth = Math.max(850, event.radius * 0.62);
      const base = Math.max(92, event.cloudBaseY + 14);
      const sourceCount = Math.min(budget.patchSamples, budget.maxPatches - patches.length);

      for (let i = 0; i < sourceCount && patches.length < budget.maxPatches; i += 1) {
        const acrossN = hashSigned(seed, i, 1);
        const depthN = hashSigned(seed, i, 2) * 0.9 - 0.08;
        const sdf = Math.max(Math.abs(acrossN), Math.abs(depthN));
        const core = 1 - smoothstep(clamp01((sdf - 0.46) / 0.54));
        const drySlot = hash01(seed, i, 3);
        if (drySlot > 0.48 + core * 0.5) continue;

        const ribbonNoise = 0.68 + hash01(seed, i, 4) * 0.44;
        const density = clamp01((0.3 + core * 0.7) * event.intensity * ribbonNoise);
        const patchDistanceX = dir.x * (depthN * halfDepth) + right.x * (acrossN * halfWidth);
        const patchDistanceZ = dir.z * (depthN * halfDepth) + right.z * (acrossN * halfWidth);
        const x = event.x + patchDistanceX + params.sample.windX * params.time * 0.035;
        const z = event.z + patchDistanceZ + params.sample.windZ * params.time * 0.035;
        const distance = Math.hypot(x - params.observerX, z - params.observerZ);
        const nearMask = smoothstep(clamp01((distance - 260) / 1200));
        const distanceHaze = 1 - smoothstep(clamp01((distance - budget.maxDistance * 0.74) / (budget.maxDistance * 0.26)));
        const opacity = clamp01(density * farFade * localFade * nearMask * distanceHaze);
        if (opacity <= 0.025) continue;

        nearestPatchDistance = Math.min(nearestPatchDistance, distance);
        const veryFar = distance > Math.max(4200, event.radius * 1.25);
        const virga = veryFar && hash01(seed, i, 5) > 0.38;
        patches.push({
          id: seed * 100 + i,
          eventId: event.id,
          x,
          z,
          bottomY: virga ? 70 + hash01(seed, i, 6) * 46 : 48,
          topY: base + 24 + hash01(seed, i, 7) * 44,
          radiusX: 420 + hash01(seed, i, 8) * 980,
          radiusZ: 320 + hash01(seed, i, 9) * 720,
          density,
          opacity,
          distance,
          mode,
          virga,
          forwardX: dir.x,
          forwardZ: dir.z,
          rightX: right.x,
          rightZ: right.z,
          windTiltX: params.sample.windX * (0.04 + windTilt * 0.035),
          windTiltZ: params.sample.windZ * (0.04 + windTilt * 0.035),
          fallSpeed: 26 + event.intensity * 36 + hash01(seed, i, 10) * 18,
          seed: hash01(seed, i, 11),
        });
      }
    }

    patches.sort((a, b) => a.distance - b.distance);
    const bounded = patches.slice(0, budget.maxPatches);
    this.state = {
      active: bounded.length > 0,
      mode: bounded.length > 0 ? strongestMode : "off",
      patches: bounded,
      nearestPatchDistance: Number.isFinite(nearestPatchDistance) ? nearestPatchDistance : null,
      rainBandIntensity,
      windTilt,
      localRainBlend,
    };
    return this.state;
  }

  debug(): DistantPrecipitationFieldDebug {
    return {
      enabled: this.enabled,
      active: this.state.active,
      mode: this.state.mode,
      patchesVisible: this.state.patches.length,
      nearestPatchDistance: this.state.nearestPatchDistance,
      rainBandIntensity: this.state.rainBandIntensity,
      windTilt: this.state.windTilt,
      localRainBlend: this.state.localRainBlend,
    };
  }

  snapshot(): DistantPrecipitationFieldState {
    return this.state;
  }

  static localRainBlend(sample: Pick<WeatherSample, "precipitation" | "temperature">): number {
    if (sample.temperature <= 1.2) return 0;
    return smoothstep(clamp01((sample.precipitation - 0.03) / 0.14));
  }
}

export function isRainBand(event: DistantPrecipitationEventLike): boolean {
  return event.type === WeatherEventType.RAIN_BAND
    && event.precip === "rain"
    && !event.producesLightning
    && event.intensity > 0.02;
}

function modeForDistance(distance: number, radius: number, localRainBlend: number): Exclude<DistantPrecipitationMode, "off"> {
  if (localRainBlend > 0.12 || distance < radius * 0.9) return "local";
  if (distance < radius * 1.75) return "mid";
  return "far";
}

function combineMode(a: DistantPrecipitationMode, b: DistantPrecipitationMode): DistantPrecipitationMode {
  const rank: Record<DistantPrecipitationMode, number> = { off: 0, far: 1, mid: 2, local: 3 };
  return rank[b] > rank[a] ? b : a;
}

function normalize(x: number, z: number, fallbackX: number, fallbackZ: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  return length > 1e-5 ? { x: x / length, z: z / length } : { x: fallbackX, z: fallbackZ };
}

function stableEventSeed(event: DistantPrecipitationEventLike): number {
  const x = Math.round(event.x / 8);
  const z = Math.round(event.z / 8);
  const radius = Math.round(event.radius / 16);
  const intensity = Math.round(event.intensity * 100);
  const dx = Math.round(event.dirX * 31);
  const dz = Math.round(event.dirZ * 31);
  return Math.abs((x * 73856093) ^ (z * 19349663) ^ (radius * 83492791) ^ (intensity * 2654435761) ^ (dx * 4099) ^ (dz * 9176));
}

function hash01(seed: number, index: number, salt: number): number {
  const v = Math.sin(seed * 91.17 + index * 37.719 + salt * 13.371) * 43758.5453123;
  return v - Math.floor(v);
}

function hashSigned(seed: number, index: number, salt: number): number {
  return hash01(seed, index, salt) * 2 - 1;
}
