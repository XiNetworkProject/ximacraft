import * as THREE from "three";
import type { WeatherEvent } from "../../weather/events/WeatherEvent";
import { WeatherEventType } from "../../weather/WeatherTypes";
import { CloudLayer, CloudLayerType, WeatherSceneState } from "../../weather/scene/WeatherScene";
import { getStratiformNoiseTextures } from "./StratiformNoiseTextures";

/*
 * Rendu volumétrique des couches stratiformes (stratus / stratocumulus /
 * altostratus / nimbostratus).
 *
 * Chaque couche est un grand volume world-space raymarché dans son fragment
 * shader. Le volume SUIT l'observateur en XZ (sa boîte n'est donc jamais visible)
 * mais le champ de densité est échantillonné en COORDONNÉES MONDE ABSOLUES : la
 * masse reste ancrée au monde, ne tourne pas autour du joueur et ne "redémarre"
 * pas quand on avance. Le bruit 3D (forme + détail) est pré-baké une fois puis
 * mis en cache (voir StratiformNoiseTextures).
 *
 * Techniques de raymarching ADAPTÉES (clean-room, aucune copie) depuis
 * SebLague/Clouds (MIT, (c) 2019 Sebastian Lague) et frmlinn/clouds-sim (MIT) :
 * ray-box, densité forme+détail, érosion de bord, Beer-Lambert, phase
 * Henyey-Greenstein double lobe, light-march court, jitter, early-exit.
 * `mhr1235/cl0ud` : inspiration esthétique uniquement. Voir docs/CLOUDS_REFERENCES.md.
 */

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
  noise3D: boolean;
  noiseBakeMs: number;
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

interface KindParams {
  shapeFreq: number;
  detailFreq: number;
  extinction: number;
  maxAlpha: number;
}

const MAX_DECKS = 5;

/** Réglages par genre nuageux (fréquences monde du bruit + extinction + alpha max). */
const KIND_PARAMS: Record<StratiformCloudKind, KindParams> = {
  stratus: { shapeFreq: 0.000235, detailFreq: 0.0016, extinction: 0.6, maxAlpha: 0.86 },
  stratocumulus: { shapeFreq: 0.00032, detailFreq: 0.0022, extinction: 0.66, maxAlpha: 0.9 },
  altostratus: { shapeFreq: 0.000175, detailFreq: 0.0012, extinction: 0.36, maxAlpha: 0.56 },
  nimbostratus: { shapeFreq: 0.000205, detailFreq: 0.0016, extinction: 0.92, maxAlpha: 0.95 },
};

export class StratiformCloudRenderer {
  private readonly geometry = new THREE.BoxGeometry(2, 2, 2, 20, 6, 20);
  private readonly slots: StratiformSlot[] = [];
  private readonly noise = getStratiformNoiseTextures();
  private readonly worldToLocal = new THREE.Matrix4();
  private readonly sunLocal = new THREE.Vector3();
  private readonly sunWorld = new THREE.Vector3();
  private readonly lastDebug: StratiformCloudDebugState = {
    enabled: true,
    active: false,
    visibleCount: 0,
    noise3D: false,
    noiseBakeMs: 0,
    nearest: null,
    layers: [],
  };
  private atmosphere: StratiformAtmosphereState | null = null;
  private enabled = true;

  constructor(private readonly scene: THREE.Scene) {
    this.lastDebug.noise3D = this.noise !== null;
    this.lastDebug.noiseBakeMs = this.noise?.bakeMs ?? 0;
    for (let i = 0; i < MAX_DECKS; i += 1) {
      const material = createStratiformMaterial(this.noise);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1.35;
      this.scene.add(mesh);
      this.slots.push({ mesh, material, spec: null, fade: 0, target: false });
    }
  }

  /** Temps (ms) réellement mesuré pour baker le bruit 3D (0 si fallback 2D). */
  get noiseBakeMs(): number {
    return this.noise?.bakeMs ?? 0;
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

    const stepCount = params.quality === "high" ? 16 : params.quality === "low" ? 7 : 11;
    const lightSteps = params.quality === "high" ? 3 : params.quality === "low" ? 1 : 2;
    const detailStrength = params.quality === "high" ? 0.44 : params.quality === "low" ? 0 : 0.34;
    this.sunWorld.copy(params.sunDirection).normalize();

    for (const slot of this.slots) {
      const spec = slot.spec;
      slot.fade = THREE.MathUtils.clamp(slot.fade + (slot.target ? 1 : -1) * 1.8 * params.delta, 0, 1);
      if (!spec || slot.fade <= 0.001) {
        slot.mesh.visible = false;
        if (!slot.target) slot.spec = null;
        continue;
      }

      const kindParams = KIND_PARAMS[spec.kind];
      const thickness = Math.max(20, spec.topHeight - spec.baseHeight);
      slot.mesh.position.set(spec.x, spec.baseHeight + thickness * 0.5, spec.z);
      slot.mesh.scale.set(spec.width * 0.5, thickness * 0.5, spec.depth * 0.5);
      slot.mesh.rotation.set(0, Math.atan2(spec.directionX, spec.directionZ), 0);
      slot.mesh.updateMatrixWorld(true);

      const cameraLocal = slot.mesh.worldToLocal(params.camera.position.clone());
      this.worldToLocal.copy(slot.mesh.matrixWorld).invert();
      this.sunLocal.copy(this.sunWorld).transformDirection(this.worldToLocal).normalize();

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
      uniforms.uSunDir.value.copy(this.sunWorld);
      uniforms.uSunLocal.value.copy(this.sunLocal);
      uniforms.uDayFactor.value = params.dayFactor;
      uniforms.uStepCount.value = stepCount;
      uniforms.uLightSteps.value = lightSteps;
      uniforms.uDetailStrength.value = detailStrength;
      uniforms.uShapeFreq.value = kindParams.shapeFreq;
      uniforms.uDetailFreq.value = kindParams.detailFreq;
      uniforms.uExtinction.value = kindParams.extinction;
      uniforms.uMaxAlpha.value = kindParams.maxAlpha;
      // Rain band = front progressif (voile -> nimbostratus) le long de l'axe de déplacement.
      uniforms.uFrontTaper.value = spec.source === "rain_band" ? 1 : 0;
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
      noise3D: this.lastDebug.noise3D,
      noiseBakeMs: this.lastDebug.noiseBakeMs,
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
    // Les textures de bruit sont partagées (cache module) : on ne les libère pas ici.
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
  // Le deck SUIT l'observateur en XZ (boîte invisible) — le bruit reste en
  // coordonnées monde absolues, donc la masse ne glisse pas avec le joueur et
  // aucune ancre ne "saute" quand on parcourt plusieurs kilomètres.
  const size = backgroundSize(kind);
  return {
    id: `scene-${kind}`,
    kind,
    x: observer.x,
    z: observer.z,
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
      return { width: 12800, depth: 12200 };
    case "stratocumulus":
      return { width: 13200, depth: 11600 };
    case "altostratus":
      return { width: 16000, depth: 14500 };
    case "nimbostratus":
      return { width: 15000, depth: 12000 };
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

function createStratiformMaterial(noise: ReturnType<typeof getStratiformNoiseTextures>): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uKind: { value: 0 },
    uCoverage: { value: 0 },
    uOpacity: { value: 0 },
    uSeed: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uCameraLocal: { value: new THREE.Vector3() },
    uCameraWorld: { value: new THREE.Vector3() },
    uLocalToWorld: { value: new THREE.Matrix4() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunLocal: { value: new THREE.Vector3(0, 1, 0) },
    uDayFactor: { value: 1 },
    uStepCount: { value: 11 },
    uLightSteps: { value: 2 },
    uDetailStrength: { value: 0.34 },
    uShapeFreq: { value: 0.00023 },
    uDetailFreq: { value: 0.0016 },
    uExtinction: { value: 0.7 },
    uMaxAlpha: { value: 0.9 },
    uFrontTaper: { value: 0 },
  };
  if (noise) {
    uniforms.uShapeNoise = { value: noise.shape };
    uniforms.uDetailNoise = { value: noise.detail };
  }

  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    defines: noise ? { HAS_NOISE3D: "" } : {},
    uniforms,
    vertexShader: /* glsl */ `
      out vec3 vLocalPosition;
      out vec3 vWorldPosition;
      void main() {
        vLocalPosition = position;
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      uniform float uTime, uKind, uCoverage, uOpacity, uSeed, uDayFactor;
      uniform float uStepCount, uLightSteps, uDetailStrength;
      uniform float uShapeFreq, uDetailFreq, uExtinction, uMaxAlpha, uFrontTaper;
      uniform vec2 uWind;
      uniform vec3 uCameraLocal, uCameraWorld, uSunDir, uSunLocal;
      uniform mat4 uLocalToWorld;
      #ifdef HAS_NOISE3D
      uniform sampler3D uShapeNoise;
      uniform sampler3D uDetailNoise;
      #endif

      in vec3 vLocalPosition;
      in vec3 vWorldPosition;
      out vec4 fragColor;

      const float PI = 3.14159265359;

      float saturate(float v) { return clamp(v, 0.0, 1.0); }
      float remap01(float v, float lo, float hi) { return saturate((v - lo) / max(hi - lo, 1e-4)); }

      vec2 boxIntersect(vec3 ro, vec3 rd) {
        vec3 inv = 1.0 / (rd + vec3(1e-6));
        vec3 t0 = (-vec3(1.0) - ro) * inv;
        vec3 t1 = ( vec3(1.0) - ro) * inv;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
      }

      // Jitter type blue-noise (interleaved gradient noise), STABLE dans le temps
      // → casse le banding sans grain qui danse ni scintillement.
      float blueJitter(vec2 fragCoord) {
        return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
      }

      float hg(float g, float c) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-3), 1.5));
      }
      // Double lobe (avant fort + arrière doux) normalisé autour de 1.
      float phase(float c) {
        return mix(hg(0.62, c), hg(-0.22, c), 0.2) * 4.0 * PI;
      }

      float verticalEnvelope(float h, float baseWarp, float topWarp) {
        float base = smoothstep(0.02 + baseWarp, 0.26 + baseWarp, h);
        float top = 1.0 - smoothstep(0.7 + topWarp, 1.03 + topWarp, h);
        return base * top;
      }

      #ifdef HAS_NOISE3D
      vec4 shapeSample(vec3 wp) {
        vec3 drift = vec3(uWind.x, 0.0, uWind.y) * uTime * 0.00035;
        return texture(uShapeNoise, wp * uShapeFreq + drift + uSeed * 0.13);
      }
      float shapeField(vec3 wp, out vec4 low) {
        low = shapeSample(wp);
        vec3 warp = (vec3(low.g, low.a, low.b) - 0.5) * 0.42;
        float hi = texture(uShapeNoise, wp * (uShapeFreq * 2.17) + warp + vec3(11.3, 4.1, 7.7)).r;
        return saturate(low.r * 0.68 + hi * 0.32);
      }
      float coarseDensity(vec3 p, vec3 wp) {
        float h = p.y * 0.5 + 0.5;
        vec4 low;
        float shape = shapeField(wp, low);
        float th = mix(0.7, 0.12, uCoverage);
        float d = smoothstep(th, th + 0.3, shape);
        return d * verticalEnvelope(h, 0.0, 0.0);
      }
      float densityField(vec3 p, vec3 wp, float h) {
        vec4 low;
        float shape = shapeField(wp, low);
        float baseWarp = (low.a - 0.5) * 0.12;
        float topWarp = (low.b - 0.5) * 0.10;
        float th = mix(0.7, 0.12, uCoverage);
        float density = smoothstep(th, th + 0.28, shape);
        float env = verticalEnvelope(h, baseWarp, topWarp);

        if (uKind < 0.5) {
          // Stratus : plafond bas diffus, très peu de relief, base douce non plate.
          density = mix(density, max(density, 0.42 * env), 0.55);
          env *= 0.9;
        } else if (uKind < 1.5) {
          // Stratocumulus : rouleaux + trous irréguliers, relief doux.
          float rolls = sin(wp.x * 0.0016 + wp.z * 0.0009 + (low.r - 0.5) * 5.0 + uTime * 0.01);
          float holes = smoothstep(0.28, 0.86, low.b + uCoverage * 0.4);
          density *= mix(0.5, 1.0, holes);
          density = saturate(density + rolls * 0.05);
        } else if (uKind < 2.5) {
          // Altostratus : voile haut, fin, uniforme (le soleil transparaît).
          density = smoothstep(mix(0.82, 0.24, uCoverage), 1.0, shape * 0.9 + low.a * 0.1) * 0.72;
          env *= 0.62;
        } else {
          // Nimbostratus : couche épaisse, profonde, solide, dessous sombre.
          density = saturate(density * 1.12);
          env = mix(env, max(env, 0.5), 0.4);
        }

        density *= env;
        // Érosion des bords par le bruit de détail (Worley) — bords moins artificiels.
        if (uDetailStrength > 0.001) {
          vec3 dDrift = vec3(uWind.x, 0.0, uWind.y) * uTime * 0.0006;
          float det = dot(texture(uDetailNoise, wp * uDetailFreq - dDrift).rgb, vec3(0.62, 0.28, 0.1));
          float edge = 1.0 - smoothstep(0.08, 0.62, density);
          float amount = uDetailStrength * (uKind > 2.5 ? 0.62 : uKind < 0.5 ? 0.7 : 1.0);
          density = saturate(density - (1.0 - det) * edge * amount);
        }
        return density;
      }
      #else
      // ---- Fallback FBM 2D (WebGL sans Data3DTexture) ----
      float hash2(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32 + uSeed);
        return fract(p.x * p.y);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x),
                   mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm2(vec2 p) {
        float v = 0.0, a = 0.54;
        for (int i = 0; i < 5; i++) { v += noise2(p) * a; p = p * 2.03 + vec2(11.7, -7.1); a *= 0.5; }
        return v;
      }
      float coarseDensity(vec3 p, vec3 wp) {
        float h = p.y * 0.5 + 0.5;
        vec2 drift = uWind * uTime * 0.0014;
        float shape = fbm2(wp.xz * (uShapeFreq * 2.6) + drift);
        float th = mix(0.72, 0.14, uCoverage);
        return smoothstep(th, th + 0.3, shape) * verticalEnvelope(h, 0.0, 0.0);
      }
      float densityField(vec3 p, vec3 wp, float h) {
        vec2 drift = uWind * uTime * 0.0014;
        float broad = fbm2(wp.xz * (uShapeFreq * 2.6) + drift);
        float detail = fbm2(wp.xz * (uShapeFreq * 8.0) - drift * 0.7 + broad * 1.7);
        float baseWarp = (broad - 0.5) * 0.2;
        float topWarp = (detail - 0.5) * 0.12;
        float th = mix(0.72, 0.14, uCoverage);
        float density = smoothstep(th, th + 0.26, broad * 0.72 + detail * 0.28);
        float env = verticalEnvelope(h, baseWarp, topWarp);
        if (uKind > 2.5) env = mix(env, max(env, 0.5), 0.4);
        return density * env;
      }
      #endif

      vec3 kindAlbedo(float h) {
        vec3 dayLight = vec3(0.9, 0.92, 0.93);
        vec3 dayShadow = vec3(0.46, 0.52, 0.58);
        if (uKind > 1.5 && uKind < 2.5) { dayLight = vec3(0.95, 0.96, 0.94); dayShadow = vec3(0.68, 0.72, 0.75); }
        if (uKind > 2.5) { dayLight = vec3(0.62, 0.67, 0.72); dayShadow = vec3(0.2, 0.25, 0.31); }
        vec3 nightLight = vec3(0.16, 0.2, 0.28);
        vec3 nightShadow = vec3(0.03, 0.04, 0.06);
        vec3 light = mix(nightLight, dayLight, uDayFactor);
        vec3 shadow = mix(nightShadow, dayShadow, uDayFactor);
        // Bas = sombre, haut = clair (dessous plus sombre mais jamais bouché).
        return mix(shadow, light, smoothstep(0.0, 0.9, h));
      }

      void main() {
        vec3 ro = uCameraLocal;
        vec3 rd = normalize(vLocalPosition - ro);
        vec2 hit = boxIntersect(ro, rd);
        float t0 = max(hit.x, 0.0);
        float t1 = hit.y;
        if (t1 <= t0) discard;
        float len = min(t1 - t0, 3.2);
        float steps = clamp(uStepCount, 4.0, 18.0);
        float stepSize = len / steps;
        float jitter = blueJitter(gl_FragCoord.xy);

        vec3 rdWorld = normalize(vWorldPosition - uCameraWorld);
        float cosT = dot(rdWorld, uSunDir);
        float ph = phase(cosT);
        float ambientBase = (uKind > 2.5 ? 0.26 : uKind > 1.5 ? 0.5 : 0.34) * mix(0.5, 1.0, uDayFactor);
        float ambientTop = (uKind > 2.5 ? 0.6 : 0.86) * mix(0.55, 1.0, uDayFactor);
        float sunGain = (uKind > 2.5 ? 0.7 : uKind > 1.5 ? 1.2 : 1.0);

        float transmittance = 1.0;
        vec3 accum = vec3(0.0);
        for (int i = 0; i < 18; i++) {
          if (float(i) >= steps || transmittance < 0.02) break;
          float t = t0 + (float(i) + jitter) * stepSize;
          vec3 p = ro + rd * t;
          vec3 wp = (uLocalToWorld * vec4(p, 1.0)).xyz;
          float h = p.y * 0.5 + 0.5;
          float d = densityField(p, wp, h);
          // Fondu horizontal doux vers les bords de la boîte : aucune face/mur
          // latéral visible. Le deck se dissout dans le ciel (SkySystem gris).
          d *= 1.0 - smoothstep(0.68, 0.99, max(abs(p.x), abs(p.z)));
          // Front pluvieux progressif : bord d'attaque fin (voile) -> coeur dense.
          if (uFrontTaper > 0.5) {
            d *= mix(0.1, 1.0, smoothstep(1.0, -0.35, p.z));
          }
          if (d > 0.002) {
            // Light-march court vers le soleil → Beer-Lambert sur l'épaisseur réelle.
            float lightDepth = 0.0;
            for (int ls = 0; ls < 3; ls++) {
              if (float(ls) >= uLightSteps) break;
              float ld = 0.08 + float(ls) * 0.14;
              vec3 sp = p + uSunLocal * ld;
              vec3 swp = (uLocalToWorld * vec4(sp, 1.0)).xyz;
              lightDepth += coarseDensity(sp, swp) * (1.0 - float(ls) * 0.24);
            }
            float sunT = exp(-lightDepth * 2.4);
            float directLight = sunT * ph * (0.4 + 0.6 * saturate(uSunDir.y + 0.2));
            vec3 albedo = kindAlbedo(h);
            float ambient = mix(ambientBase, ambientTop, h);
            vec3 radiance = albedo * (ambient + directLight * sunGain * uDayFactor);
            // Bord côté soleil légèrement plus lumineux.
            radiance += vec3(1.0, 0.98, 0.94) * pow(max(cosT, 0.0), 4.0) * (0.15 + 0.35 * h) * uDayFactor * sunT;
            float a = 1.0 - exp(-d * stepSize * uExtinction * uOpacity * 4.2);
            accum += transmittance * radiance * a;
            transmittance *= 1.0 - a;
          }
        }

        float alpha = 1.0 - transmittance;
        if (alpha < 0.01) discard;
        fragColor = vec4(accum / max(alpha, 1e-3), min(alpha, uMaxAlpha));
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
