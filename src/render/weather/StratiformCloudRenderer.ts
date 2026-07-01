import * as THREE from "three";
import type { WeatherEvent } from "../../weather/events/WeatherEvent";
import { WeatherEventType } from "../../weather/WeatherTypes";
import { CloudLayer, CloudLayerType, WeatherSceneState } from "../../weather/scene/WeatherScene";

export type StratiformCloudKind = "stratus" | "stratocumulus" | "altostratus" | "nimbostratus";
export type StratiformQuality = "low" | "balanced" | "high";

export interface StratiformLayerSpec {
  id: string;
  kind: StratiformCloudKind;
  x: number;
  z: number;
  baseHeight: number;
  topHeight: number;
  width: number;
  depth: number;
  coverage: number;
  opacity: number;
  directionX: number;
  directionZ: number;
  speed: number;
  seed: number;
  source: "scene" | "rain_band";
}

export interface StratiformLayerDebug {
  id: string;
  kind: StratiformCloudKind;
  source: "scene" | "rain_band";
  baseHeight: number;
  topHeight: number;
  coverage: number;
  opacity: number;
  distance: number;
  directionX: number;
  directionZ: number;
  speed: number;
}

export interface StratiformCloudDebugState {
  enabled: boolean;
  active: boolean;
  visibleCount: number;
  nearest: StratiformLayerDebug | null;
  layers: StratiformLayerDebug[];
}

export interface StratiformAtmosphereState {
  kind: StratiformCloudKind;
  coverage: number;
  opacity: number;
  distance: number;
  overhead: boolean;
}

interface StratiformSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  spec: StratiformLayerSpec | null;
  fade: number;
  target: boolean;
}

export interface StratiformCloudUpdateParams {
  scene: WeatherSceneState;
  events: readonly WeatherEvent[];
  camera: THREE.PerspectiveCamera;
  observerX: number;
  observerZ: number;
  dayFactor: number;
  sunDirection: THREE.Vector3;
  time: number;
  quality: StratiformQuality;
  delta: number;
}

const MAX_DECKS = 5;
const BACKGROUND_ANCHOR_STEP = 2048;

export class StratiformCloudRenderer {
  private readonly geometry = new THREE.BoxGeometry(2, 2, 2, 18, 4, 18);
  private readonly slots: StratiformSlot[] = [];
  private readonly lastDebug: StratiformCloudDebugState = {
    enabled: true,
    active: false,
    visibleCount: 0,
    nearest: null,
    layers: [],
  };
  private atmosphere: StratiformAtmosphereState | null = null;
  private enabled = true;

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < MAX_DECKS; i += 1) {
      const material = createStratiformMaterial();
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1.35;
      this.scene.add(mesh);
      this.slots.push({ mesh, material, spec: null, fade: 0, target: false });
    }
  }

  update(params: StratiformCloudUpdateParams): void {
    if (!this.enabled) {
      this.clearVisible();
      return;
    }

    const specs = resolveStratiformLayerSpecs(
      params.scene,
      params.events,
      { x: params.observerX, z: params.observerZ },
    ).slice(0, MAX_DECKS);
    const wanted = new Set(specs.map((spec) => spec.id));

    for (const slot of this.slots) {
      slot.target = slot.spec !== null && wanted.has(slot.spec.id);
    }
    for (const spec of specs) {
      let slot = this.slots.find((candidate) => candidate.spec?.id === spec.id);
      if (!slot) {
        slot = this.slots.find((candidate) => !candidate.spec || (!candidate.target && candidate.fade <= 0.01));
        if (!slot) continue;
        slot.spec = spec;
        slot.fade = 0;
      } else {
        slot.spec = spec;
      }
      slot.target = true;
    }

    const stepCount = params.quality === "high" ? 13 : params.quality === "low" ? 7 : 10;
    for (const slot of this.slots) {
      const spec = slot.spec;
      slot.fade = THREE.MathUtils.clamp(slot.fade + (slot.target ? 1 : -1) * 1.8 * params.delta, 0, 1);
      if (!spec || slot.fade <= 0.001) {
        slot.mesh.visible = false;
        if (!slot.target) slot.spec = null;
        continue;
      }

      const thickness = Math.max(20, spec.topHeight - spec.baseHeight);
      slot.mesh.position.set(spec.x, spec.baseHeight + thickness * 0.5, spec.z);
      slot.mesh.scale.set(spec.width * 0.5, thickness * 0.5, spec.depth * 0.5);
      slot.mesh.rotation.set(0, Math.atan2(spec.directionX, spec.directionZ), 0);
      slot.mesh.updateMatrixWorld(true);

      const cameraLocal = slot.mesh.worldToLocal(params.camera.position.clone());
      const uniforms = slot.material.uniforms;
      uniforms.uTime.value = params.time;
      uniforms.uKind.value = kindIndex(spec.kind);
      uniforms.uCoverage.value = spec.coverage;
      uniforms.uOpacity.value = spec.opacity * slot.fade;
      uniforms.uSeed.value = spec.seed;
      uniforms.uWind.value.set(spec.directionX * spec.speed, spec.directionZ * spec.speed);
      uniforms.uCameraLocal.value.copy(cameraLocal);
      uniforms.uCameraWorld.value.copy(params.camera.position);
      uniforms.uLocalToWorld.value.copy(slot.mesh.matrixWorld);
      uniforms.uSunDirection.value.copy(params.sunDirection).normalize();
      uniforms.uDayFactor.value = params.dayFactor;
      uniforms.uStepCount.value = stepCount;
      uniforms.uThickness.value = thickness;
      slot.mesh.visible = true;
    }

    this.refreshDebug(params.observerX, params.observerZ);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearVisible();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.spec = null;
      slot.fade = 0;
      slot.target = false;
      slot.mesh.visible = false;
    }
    this.refreshDebug(0, 0);
  }

  debugState(): StratiformCloudDebugState {
    return {
      enabled: this.lastDebug.enabled,
      active: this.lastDebug.active,
      visibleCount: this.lastDebug.visibleCount,
      nearest: this.lastDebug.nearest ? { ...this.lastDebug.nearest } : null,
      layers: this.lastDebug.layers.map((layer) => ({ ...layer })),
    };
  }

  atmosphereState(): StratiformAtmosphereState | null {
    return this.atmosphere ? { ...this.atmosphere } : null;
  }

  dispose(): void {
    for (const slot of this.slots) {
      this.scene.remove(slot.mesh);
      slot.material.dispose();
    }
    this.geometry.dispose();
  }

  private clearVisible(): void {
    for (const slot of this.slots) {
      slot.mesh.visible = false;
      slot.target = false;
      slot.fade = 0;
    }
    this.lastDebug.enabled = this.enabled;
    this.lastDebug.active = false;
    this.lastDebug.visibleCount = 0;
    this.lastDebug.nearest = null;
    this.lastDebug.layers = [];
    this.atmosphere = null;
  }

  private refreshDebug(observerX: number, observerZ: number): void {
    const layers: StratiformLayerDebug[] = [];
    for (const slot of this.slots) {
      if (!slot.spec || !slot.mesh.visible || slot.fade <= 0.01) continue;
      const spec = slot.spec;
      layers.push({
        id: spec.id,
        kind: spec.kind,
        source: spec.source,
        baseHeight: spec.baseHeight,
        topHeight: spec.topHeight,
        coverage: spec.coverage,
        opacity: spec.opacity * slot.fade,
        distance: distanceToDeck(spec, observerX, observerZ),
        directionX: spec.directionX,
        directionZ: spec.directionZ,
        speed: spec.speed,
      });
    }
    layers.sort((a, b) => a.distance - b.distance);
    const nearest = layers[0] ?? null;
    this.lastDebug.enabled = this.enabled;
    this.lastDebug.active = layers.length > 0;
    this.lastDebug.visibleCount = layers.length;
    this.lastDebug.nearest = nearest;
    this.lastDebug.layers = layers;
    this.atmosphere = nearest
      ? {
          kind: nearest.kind,
          coverage: nearest.coverage,
          opacity: nearest.opacity,
          distance: nearest.distance,
          overhead: nearest.distance <= 1,
        }
      : null;
  }
}

export function resolveStratiformLayerSpecs(
  scene: WeatherSceneState,
  events: readonly Pick<WeatherEvent, "id" | "type" | "x" | "z" | "radius" | "intensity" | "dirX" | "dirZ" | "speed" | "cloudBaseY" | "precip">[],
  observer: { x: number; z: number },
): StratiformLayerSpec[] {
  const specs: StratiformLayerSpec[] = [];
  for (const layer of scene.cloudLayers) {
    const spec = specFromSceneLayer(layer, observer);
    if (spec) specs.push(spec);
  }
  for (const event of events) {
    if (event.type !== WeatherEventType.RAIN_BAND || event.precip !== "rain") continue;
    const dirLen = Math.hypot(event.dirX, event.dirZ) || 1;
    const dx = event.dirX / dirLen;
    const dz = event.dirZ / dirLen;
    const base = Math.max(180, event.cloudBaseY + 75);
    specs.push({
      id: `rain-band-${event.id}`,
      kind: "nimbostratus",
      x: event.x,
      z: event.z,
      baseHeight: base,
      topHeight: Math.max(base + 520, event.cloudBaseY + 900),
      width: Math.max(5200, event.radius * 4.5),
      depth: Math.max(2600, event.radius * 1.85),
      coverage: clamp01(0.82 + event.intensity * 0.17),
      opacity: clamp01(0.72 + event.intensity * 0.22),
      directionX: dx,
      directionZ: dz,
      speed: Math.max(0.5, event.speed),
      seed: hash01(event.id * 97.17 + event.radius * 0.13),
      source: "rain_band",
    });
  }
  return specs
    .filter((spec) => spec.coverage * spec.opacity > 0.035)
    .sort((a, b) => {
      const source = (b.source === "rain_band" ? 1 : 0) - (a.source === "rain_band" ? 1 : 0);
      if (source !== 0) return source;
      return b.coverage * b.opacity - a.coverage * a.opacity;
    });
}

function specFromSceneLayer(layer: CloudLayer, observer: { x: number; z: number }): StratiformLayerSpec | null {
  const kind = kindForLayer(layer.type);
  if (!kind) return null;
  const visible = clamp01(layer.coverage * layer.opacity);
  if (!isRenderableSceneLayer(kind, layer, visible)) return null;
  const dirLen = Math.hypot(layer.movementX, layer.movementZ);
  const dirX = dirLen > 0.01 ? layer.movementX / dirLen : 1;
  const dirZ = dirLen > 0.01 ? layer.movementZ / dirLen : 0;
  const anchorX = Math.round(observer.x / BACKGROUND_ANCHOR_STEP) * BACKGROUND_ANCHOR_STEP;
  const anchorZ = Math.round(observer.z / BACKGROUND_ANCHOR_STEP) * BACKGROUND_ANCHOR_STEP;
  const size = backgroundSize(kind);
  return {
    id: `scene-${kind}`,
    kind,
    x: anchorX,
    z: anchorZ,
    baseHeight: layer.baseHeight,
    topHeight: Math.max(layer.topHeight, layer.baseHeight + 48),
    width: size.width,
    depth: size.depth,
    coverage: clamp01(layer.coverage),
    opacity: clamp01(layer.opacity),
    directionX: dirX,
    directionZ: dirZ,
    speed: dirLen,
    seed: hash01(layer.baseHeight * 17.1 + layer.topHeight * 0.31 + kindIndex(kind) * 47.3),
    source: "scene",
  };
}

function isRenderableSceneLayer(kind: StratiformCloudKind, layer: CloudLayer, visible: number): boolean {
  switch (kind) {
    case "stratus":
      return layer.coverage >= 0.68 && visible >= 0.42;
    case "stratocumulus":
      return layer.coverage >= 0.6 && visible >= 0.44;
    case "altostratus":
      return layer.coverage >= 0.64 && visible >= 0.36;
    case "nimbostratus":
      return layer.coverage >= 0.58 && visible >= 0.34;
  }
}

function kindForLayer(type: CloudLayerType): StratiformCloudKind | null {
  switch (type) {
    case CloudLayerType.STRATUS:
      return "stratus";
    case CloudLayerType.STRATOCUMULUS:
      return "stratocumulus";
    case CloudLayerType.ALTOSTRATUS:
    case CloudLayerType.CIRROSTRATUS:
      return "altostratus";
    case CloudLayerType.NIMBOSTRATUS:
      return "nimbostratus";
    default:
      return null;
  }
}

function backgroundSize(kind: StratiformCloudKind): { width: number; depth: number } {
  switch (kind) {
    case "stratus":
      return { width: 9800, depth: 9400 };
    case "stratocumulus":
      return { width: 10500, depth: 8800 };
    case "altostratus":
      return { width: 14000, depth: 12500 };
    case "nimbostratus":
      return { width: 13500, depth: 9800 };
  }
}

function distanceToDeck(spec: StratiformLayerSpec, x: number, z: number): number {
  const dx = x - spec.x;
  const dz = z - spec.z;
  const along = dx * spec.directionX + dz * spec.directionZ;
  const across = dx * -spec.directionZ + dz * spec.directionX;
  const ex = Math.abs(across) / Math.max(1, spec.width * 0.5);
  const ez = Math.abs(along) / Math.max(1, spec.depth * 0.5);
  const outside = Math.max(ex, ez) - 1;
  return Math.max(0, outside) * Math.min(spec.width, spec.depth) * 0.5;
}

function kindIndex(kind: StratiformCloudKind): number {
  switch (kind) {
    case "stratus": return 0;
    case "stratocumulus": return 1;
    case "altostratus": return 2;
    case "nimbostratus": return 3;
  }
}

function createStratiformMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uKind: { value: 0 },
      uCoverage: { value: 0 },
      uOpacity: { value: 0 },
      uSeed: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      uCameraLocal: { value: new THREE.Vector3() },
      uCameraWorld: { value: new THREE.Vector3() },
      uLocalToWorld: { value: new THREE.Matrix4() },
      uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      uDayFactor: { value: 1 },
      uStepCount: { value: 10 },
      uThickness: { value: 120 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocalPosition;
      void main() {
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime, uKind, uCoverage, uOpacity, uSeed, uDayFactor, uStepCount, uThickness;
      uniform vec2 uWind;
      uniform vec3 uCameraLocal, uCameraWorld, uSunDirection;
      uniform mat4 uLocalToWorld;
      varying vec3 vLocalPosition;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32 + uSeed);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.54;
        for (int i = 0; i < 5; i++) {
          v += noise(p) * a;
          p = p * 2.03 + vec2(11.7, -7.1);
          a *= 0.5;
        }
        return v;
      }
      vec2 boxIntersect(vec3 ro, vec3 rd) {
        vec3 inv = 1.0 / (rd + vec3(0.000001));
        vec3 t0 = (-vec3(1.0) - ro) * inv;
        vec3 t1 = ( vec3(1.0) - ro) * inv;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        float nearT = max(max(tmin.x, tmin.y), tmin.z);
        float farT = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(nearT, farT);
      }
      float deckDensity(vec3 p, vec3 worldPos) {
        float y = p.y * 0.5 + 0.5;
        vec2 drift = uWind * uTime * 0.0014;
        float broadScale = mix(0.00062, 0.00115, step(0.5, uKind));
        float broad = fbm(worldPos.xz * broadScale + drift + uSeed * 3.1);
        float detail = fbm(worldPos.xz * broadScale * 3.2 - drift * 0.7 + broad * 1.7);
        float rolls = sin((worldPos.x * 0.0022 + worldPos.z * 0.0011) + broad * 3.2 + uTime * 0.015);
        float baseWarp = (broad - 0.5) * (uKind < 2.5 ? 0.22 : 0.12);
        float topWarp = (detail - 0.5) * 0.14;
        float vertical = smoothstep(0.02 + baseWarp, 0.23 + baseWarp, y)
          * (1.0 - smoothstep(0.78 + topWarp, 1.04 + topWarp, y));
        float underside = 1.0 - smoothstep(0.08 + baseWarp, 0.32 + baseWarp, y);
        float edge = 1.0 - smoothstep(0.68, 1.0, max(abs(p.x), abs(p.z)));
        float baseField = broad * 0.72 + detail * 0.28;
        float threshold = mix(0.82, 0.18, uCoverage);
        float density = smoothstep(threshold, threshold + 0.24, baseField + 0.08);

        if (uKind > 0.5 && uKind < 1.5) {
          float cellular = fbm(worldPos.xz * 0.0025 + vec2(rolls, -rolls) * 0.35 + drift * 1.8);
          float holes = smoothstep(0.28, 0.78, cellular + uCoverage * 0.42);
          density = smoothstep(mix(0.74, 0.22, uCoverage), mix(0.88, 0.42, uCoverage), baseField + rolls * 0.09) * holes;
        } else if (uKind > 1.5 && uKind < 2.5) {
          density = smoothstep(mix(0.86, 0.24, uCoverage), 1.0, broad * 0.84 + detail * 0.12);
          vertical *= 0.58;
        } else if (uKind > 2.5) {
          density = smoothstep(mix(0.78, 0.08, uCoverage), 0.95, broad * 0.88 + detail * 0.16);
          vertical *= 1.12;
          underside = max(underside, 0.45);
        }

        float flatBase = mix(0.82, 1.12, underside);
        return density * vertical * edge * flatBase;
      }
      vec3 sampleColor(float y, float density) {
        vec3 dayLight = vec3(0.86, 0.88, 0.88);
        vec3 dayShadow = vec3(0.42, 0.48, 0.53);
        vec3 nightLight = vec3(0.18, 0.22, 0.30);
        vec3 nightShadow = vec3(0.045, 0.055, 0.075);
        if (uKind > 1.5 && uKind < 2.5) {
          dayLight = vec3(0.93, 0.94, 0.91);
          dayShadow = vec3(0.62, 0.67, 0.70);
        }
        if (uKind > 2.5) {
          dayLight = vec3(0.58, 0.64, 0.68);
          dayShadow = vec3(0.24, 0.29, 0.34);
        }
        vec3 light = mix(nightLight, dayLight, uDayFactor);
        vec3 shadow = mix(nightShadow, dayShadow, uDayFactor);
        float sunLift = clamp(uSunDirection.y * 0.5 + 0.5, 0.0, 1.0);
        float lit = clamp(0.28 + y * 0.38 + sunLift * 0.22, 0.0, 1.0);
        vec3 color = mix(shadow, light, lit);
        color = mix(color, shadow, density * (uKind > 2.5 ? 0.38 : 0.18));
        return color;
      }

      void main() {
        vec3 ro = uCameraLocal;
        vec3 rd = normalize(vLocalPosition - ro);
        vec2 hit = boxIntersect(ro, rd);
        float t0 = max(hit.x, 0.0);
        float t1 = hit.y;
        if (t1 <= t0) discard;
        float len = min(t1 - t0, 3.2);
        float jitter = hash(gl_FragCoord.xy + uTime * 13.7 + uSeed);
        float steps = clamp(uStepCount, 4.0, 14.0);
        float stepSize = len / steps;
        vec3 accum = vec3(0.0);
        float alpha = 0.0;
        for (int i = 0; i < 14; i++) {
          if (float(i) >= steps) break;
          float t = t0 + (float(i) + jitter) * stepSize;
          vec3 p = ro + rd * t;
          vec3 worldPos = (uLocalToWorld * vec4(p, 1.0)).xyz;
          float d = deckDensity(p, worldPos);
          float localAlpha = d * stepSize * uOpacity * (uKind > 2.5 ? 0.86 : 0.62);
          localAlpha = clamp(localAlpha, 0.0, 0.32);
          vec3 col = sampleColor(p.y * 0.5 + 0.5, d);
          accum += (1.0 - alpha) * localAlpha * col;
          alpha += (1.0 - alpha) * localAlpha;
        }
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(accum / max(alpha, 0.0001), clamp(alpha, 0.0, 0.88));
      }
    `,
  });
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hash01(v: number): number {
  const s = Math.sin(v * 12.9898) * 43758.5453123;
  return s - Math.floor(s);
}
