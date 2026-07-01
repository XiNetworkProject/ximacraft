import * as THREE from "three";
import type { CumulusFormation, CumulusQuality } from "../../clouds/FairWeatherCumulusField";
import { getStratiformNoiseTextures } from "./StratiformNoiseTextures";

/*
 * CumulusFieldRenderer — rendu VOLUMÉTRIQUE (raymarch inline dans la scène) d'un
 * champ de cumulus de beau temps fourni par FairWeatherCumulusField.
 *
 * Choix d'architecture (audit des renderers existants) :
 *  - CloudVolumeRenderer est l'UNIQUE FrameCompositor (raymarch bas-res + TAA
 *    des masses CONVECTIVES via ConvectiveCloudSystem, budget 8 bakes CPU) — il
 *    ne convient pas à un champ streamé de dizaines de petits cumulus. On ne le
 *    détourne donc pas, on ne le double pas.
 *  - SkyCloudPopulationRenderer / sprites / billboards / dôme fBm : JAMAIS
 *    réactivés (blobs 2D, soucoupes).
 * On réutilise la MÊME technique volumétrique que Stratiform/Convectif — box
 * BackSide raymarchée dans son fragment shader + bruit 3D partagé
 * (StratiformNoiseTextures) — mais dédiée aux cumulus (champ de lobes),
 * frustum-cullée, poolée et budgetée, avec 3 zones de LOD (proche/intermédiaire/
 * horizon) et fondu atmosphérique. Aucun render target par nuage, aucun mesh
 * illimité : un pool fixe de slots réaffectés par frame.
 *
 * Techniques adaptées clean-room (Beer-Lambert, Henyey-Greenstein, jitter
 * blue-noise stable, early-exit, bruit forme+détail) : SebLague/Clouds (MIT) +
 * frmlinn/clouds-sim (MIT). cl0ud = inspiration esthétique. Voir
 * docs/CLOUDS_REFERENCES.md.
 */

export type CumulusZone = "near" | "mid" | "horizon";

export interface CumulusFieldRenderDebug {
  enabled: boolean;
  active: boolean;
  visible: number;
  near: number;
  mid: number;
  horizon: number;
  budget: number;
}

interface CumulusSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  id: number;
  fade: number;
  target: boolean;
  zone: CumulusZone;
}

interface ZoneLod {
  steps: number;
  lightSteps: number;
  detail: number;
}

const MAX_SLOTS = 64;
const LOBE_COUNT = 4;

interface QualityLod {
  nearDistance: number;
  midDistance: number;
  streamRadius: number;
  budget: number;
  near: ZoneLod;
  mid: ZoneLod;
  horizon: ZoneLod;
}

const QUALITY_LOD: Record<CumulusQuality, QualityLod> = {
  low: {
    nearDistance: 1600, midDistance: 3200, streamRadius: 4200, budget: 26,
    near: { steps: 9, lightSteps: 1, detail: 0 },
    mid: { steps: 6, lightSteps: 0, detail: 0 },
    horizon: { steps: 4, lightSteps: 0, detail: 0 },
  },
  balanced: {
    nearDistance: 2100, midDistance: 4200, streamRadius: 6800, budget: 44,
    near: { steps: 16, lightSteps: 2, detail: 0.3 },
    mid: { steps: 9, lightSteps: 1, detail: 0 },
    horizon: { steps: 6, lightSteps: 0, detail: 0 },
  },
  high: {
    nearDistance: 2600, midDistance: 5200, streamRadius: 9200, budget: 64,
    near: { steps: 20, lightSteps: 3, detail: 0.42 },
    mid: { steps: 12, lightSteps: 1, detail: 0.16 },
    horizon: { steps: 7, lightSteps: 0, detail: 0 },
  },
};

export class CumulusFieldRenderer {
  private readonly geometry = new THREE.BoxGeometry(2, 2, 2, 8, 8, 8);
  private readonly noise = getStratiformNoiseTextures();
  private readonly slots: CumulusSlot[] = [];
  private readonly worldToLocal = new THREE.Matrix4();
  private readonly sunWorld = new THREE.Vector3(0, 1, 0);
  private readonly sunLocal = new THREE.Vector3(0, 1, 0);
  private readonly scratchLobes = new Float32Array(LOBE_COUNT * 4);
  private enabled = true;
  private readonly debugInfo: CumulusFieldRenderDebug = {
    enabled: true, active: false, visible: 0, near: 0, mid: 0, horizon: 0, budget: 0,
  };

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < MAX_SLOTS; i += 1) {
      const material = createCumulusMaterial(this.noise);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = 1.3;
      this.scene.add(mesh);
      this.slots.push({ mesh, material, id: -1, fade: 0, target: false, zone: "horizon" });
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.id = -1;
      slot.fade = 0;
      slot.target = false;
      slot.mesh.visible = false;
    }
    this.debugInfo.active = false;
    this.debugInfo.visible = 0;
    this.debugInfo.near = 0;
    this.debugInfo.mid = 0;
    this.debugInfo.horizon = 0;
  }

  update(params: {
    formations: readonly CumulusFormation[];
    camera: THREE.PerspectiveCamera;
    sunDirection: THREE.Vector3;
    dayFactor: number;
    time: number;
    windX: number;
    windZ: number;
    quality: CumulusQuality;
    delta: number;
  }): void {
    this.debugInfo.enabled = this.enabled;
    if (!this.enabled) {
      this.clear();
      return;
    }

    const lod = QUALITY_LOD[params.quality];
    this.debugInfo.budget = lod.budget;
    const formations = params.formations.length > lod.budget
      ? params.formations.slice(0, lod.budget)
      : params.formations;
    const wanted = new Map<number, CumulusFormation>();
    for (const formation of formations) wanted.set(formation.id, formation);

    // Slots déjà assignés à une formation encore présente restent verrouillés.
    for (const slot of this.slots) {
      slot.target = slot.id >= 0 && wanted.has(slot.id);
    }
    for (const formation of formations) {
      if (this.slots.some((slot) => slot.id === formation.id)) continue;
      const free = this.slots.find((slot) => slot.id < 0 || (!slot.target && slot.fade <= 0.02));
      if (!free) continue;
      free.id = formation.id;
      free.fade = 0;
      free.target = true;
    }

    this.sunWorld.copy(params.sunDirection).normalize();
    const airOffsetX = params.windX * params.time;
    const airOffsetZ = params.windZ * params.time;
    let visible = 0;
    let near = 0;
    let mid = 0;
    let horizon = 0;

    for (const slot of this.slots) {
      slot.fade = THREE.MathUtils.clamp(slot.fade + (slot.target ? 1 : -1) * 2.2 * params.delta, 0, 1);
      const formation = slot.target ? wanted.get(slot.id) : undefined;
      if (!formation || slot.fade <= 0.01) {
        slot.mesh.visible = false;
        if (!slot.target && slot.fade <= 0.01) slot.id = -1;
        continue;
      }

      const zone: CumulusZone = formation.distance <= lod.nearDistance
        ? "near"
        : formation.distance <= lod.midDistance
          ? "mid"
          : "horizon";
      slot.zone = zone;
      const zoneLod = lod[zone];
      const thickness = Math.max(60, formation.thickness);

      slot.mesh.position.set(formation.worldX, formation.baseHeight + thickness * 0.5, formation.worldZ);
      slot.mesh.scale.set(formation.radius, thickness * 0.5, formation.radius);
      slot.mesh.updateMatrixWorld(true);
      this.worldToLocal.copy(slot.mesh.matrixWorld).invert();
      this.sunLocal.copy(this.sunWorld).transformDirection(this.worldToLocal).normalize();

      const uniforms = slot.material.uniforms;
      this.writeLobes(formation);
      (uniforms.uLobes.value as THREE.Vector4[]).forEach((vec, i) => {
        vec.set(
          this.scratchLobes[i * 4],
          this.scratchLobes[i * 4 + 1],
          this.scratchLobes[i * 4 + 2],
          this.scratchLobes[i * 4 + 3],
        );
      });
      uniforms.uLobeCount.value = formation.lobes;
      uniforms.uDensity.value = formation.density;
      uniforms.uMaturity.value = formation.maturity;
      uniforms.uCoverage.value = formation.coverage;
      uniforms.uSeed.value = formation.seed * 17.3;
      uniforms.uOpacity.value = slot.fade;
      // Fondu atmosphérique en bordure de streaming → pas de cercle/liseré.
      uniforms.uDistanceFade.value = 1 - THREE.MathUtils.smoothstep(formation.distance, lod.streamRadius * 0.78, lod.streamRadius);
      uniforms.uStepCount.value = zoneLod.steps;
      uniforms.uLightSteps.value = zoneLod.lightSteps;
      uniforms.uDetailStrength.value = zoneLod.detail;
      uniforms.uAirOffset.value.set(airOffsetX, 0, airOffsetZ);
      uniforms.uCameraLocal.value.copy(slot.mesh.worldToLocal(params.camera.position.clone()));
      uniforms.uCameraWorld.value.copy(params.camera.position);
      uniforms.uLocalToWorld.value.copy(slot.mesh.matrixWorld);
      uniforms.uSunDir.value.copy(this.sunWorld);
      uniforms.uSunLocal.value.copy(this.sunLocal);
      uniforms.uDayFactor.value = params.dayFactor;
      slot.mesh.visible = true;

      visible += 1;
      if (zone === "near") near += 1;
      else if (zone === "mid") mid += 1;
      else horizon += 1;
    }

    this.debugInfo.active = visible > 0;
    this.debugInfo.visible = visible;
    this.debugInfo.near = near;
    this.debugInfo.mid = mid;
    this.debugInfo.horizon = horizon;
  }

  debug(): CumulusFieldRenderDebug {
    return { ...this.debugInfo };
  }

  dispose(): void {
    for (const slot of this.slots) {
      this.scene.remove(slot.mesh);
      slot.material.dispose();
    }
    this.geometry.dispose();
  }

  /** Dispose les lobes (cauliflower) déterministes d'une formation en local [-1,1]. */
  private writeLobes(formation: CumulusFormation): void {
    const s = formation.seed;
    // Lobe principal : corps large, base basse.
    this.scratchLobes[0] = 0;
    this.scratchLobes[1] = -0.28;
    this.scratchLobes[2] = 0;
    this.scratchLobes[3] = 0.92;
    const count = Math.min(LOBE_COUNT, formation.lobes);
    for (let i = 1; i < LOBE_COUNT; i += 1) {
      if (i >= count) {
        this.scratchLobes[i * 4 + 3] = 0; // rayon 0 → lobe inactif
        continue;
      }
      const a = frac(s * (7.13 + i * 1.7)) * Math.PI * 2;
      const ring = 0.34 + frac(s * (3.1 + i * 2.9)) * 0.4;
      this.scratchLobes[i * 4] = Math.cos(a) * ring;
      this.scratchLobes[i * 4 + 1] = -0.05 + frac(s * (5.7 + i * 1.3)) * (0.35 + formation.maturity * 0.4);
      this.scratchLobes[i * 4 + 2] = Math.sin(a) * ring;
      this.scratchLobes[i * 4 + 3] = 0.4 + frac(s * (9.4 + i * 0.7)) * 0.24;
    }
  }
}

function frac(v: number): number {
  const s = Math.sin(v * 43758.5453) * 0.5 + 0.5;
  return s - Math.floor(s);
}

function createCumulusMaterial(noise: ReturnType<typeof getStratiformNoiseTextures>): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    uLobes: { value: Array.from({ length: LOBE_COUNT }, () => new THREE.Vector4()) },
    uLobeCount: { value: 3 },
    uDensity: { value: 0.9 },
    uMaturity: { value: 0.4 },
    uCoverage: { value: 0.3 },
    uSeed: { value: 0 },
    uOpacity: { value: 1 },
    uDistanceFade: { value: 1 },
    uStepCount: { value: 14 },
    uLightSteps: { value: 2 },
    uDetailStrength: { value: 0.3 },
    uShapeFreq: { value: 0.0016 },
    uDetailFreq: { value: 0.006 },
    uExtinction: { value: 0.9 },
    uMaxAlpha: { value: 0.96 },
    uAirOffset: { value: new THREE.Vector3() },
    uCameraLocal: { value: new THREE.Vector3() },
    uCameraWorld: { value: new THREE.Vector3() },
    uLocalToWorld: { value: new THREE.Matrix4() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunLocal: { value: new THREE.Vector3(0, 1, 0) },
    uDayFactor: { value: 1 },
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

      uniform vec4 uLobes[${LOBE_COUNT}];
      uniform float uLobeCount, uDensity, uMaturity, uCoverage, uSeed, uOpacity, uDistanceFade;
      uniform float uStepCount, uLightSteps, uDetailStrength;
      uniform float uShapeFreq, uDetailFreq, uExtinction, uMaxAlpha, uDayFactor;
      uniform vec3 uAirOffset, uCameraLocal, uCameraWorld, uSunDir, uSunLocal;
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

      vec2 boxIntersect(vec3 ro, vec3 rd) {
        vec3 inv = 1.0 / (rd + vec3(1e-6));
        vec3 t0 = (-vec3(1.0) - ro) * inv;
        vec3 t1 = ( vec3(1.0) - ro) * inv;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
      }

      float blueJitter(vec2 fragCoord) {
        return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
      }

      float hg(float g, float c) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-3), 1.5));
      }
      float phase(float c) { return mix(hg(0.6, c), hg(-0.2, c), 0.22) * 4.0 * PI; }

      float lobeField(vec3 p) {
        float d = 0.0;
        for (int i = 0; i < ${LOBE_COUNT}; i++) {
          if (float(i) >= uLobeCount) break;
          vec4 lobe = uLobes[i];
          if (lobe.w <= 0.001) continue;
          float e = 1.0 - length((p - lobe.xyz) / max(lobe.w, 0.001));
          d = max(d, e);
        }
        return saturate(d);
      }

      #ifdef HAS_NOISE3D
      float shapeNoise(vec3 air) { return texture(uShapeNoise, air * uShapeFreq + uSeed * 0.11).r; }
      float detailNoise(vec3 air) { return dot(texture(uDetailNoise, air * uDetailFreq).rgb, vec3(0.62, 0.28, 0.1)); }
      #else
      float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32 + uSeed); return fract(p.x * p.y); }
      float noise2(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
      }
      float shapeNoise(vec3 air) { return noise2(air.xz * uShapeFreq * 2.4 + air.y * 0.002) * 0.7 + 0.3; }
      float detailNoise(vec3 air) { return noise2(air.xz * uDetailFreq * 1.6); }
      #endif

      float cumulusDensity(vec3 p, vec3 wp) {
        float h = p.y * 0.5 + 0.5;
        float shape = lobeField(p);
        if (shape <= 0.0) return 0.0;
        // Base plate (humilis/mediocris), sommet arrondi.
        float base = smoothstep(0.0, 0.1, h);
        float top = 1.0 - smoothstep(0.82, 1.03, h);
        float d = shape * base * top;
        // Bruit échantillonné en ESPACE DE MASSE D'AIR → colle au nuage (pas de
        // texture qui glisse) et reste ancré monde.
        vec3 air = wp - uAirOffset;
        float billow = shapeNoise(air);
        d = saturate(d * (0.5 + 0.85 * billow));
        if (uDetailStrength > 0.001) {
          float det = detailNoise(air);
          float edge = 1.0 - smoothstep(0.1, 0.62, d);
          d = saturate(d - (1.0 - det) * edge * uDetailStrength);
        }
        return d * uDensity;
      }

      float coarseDensity(vec3 p, vec3 wp) {
        float h = p.y * 0.5 + 0.5;
        float shape = lobeField(p);
        float env = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.82, 1.03, h));
        return saturate(shape * env * (0.5 + 0.85 * shapeNoise(wp - uAirOffset))) * uDensity;
      }

      vec3 cumulusAlbedo(float h) {
        vec3 lit = mix(vec3(0.16, 0.2, 0.28), vec3(0.98, 0.99, 1.0), uDayFactor);
        vec3 shade = mix(vec3(0.03, 0.04, 0.06), vec3(0.5, 0.55, 0.62), uDayFactor);
        return mix(shade, lit, smoothstep(0.0, 0.85, h));
      }

      void main() {
        vec3 ro = uCameraLocal;
        vec3 rd = normalize(vLocalPosition - ro);
        vec2 hit = boxIntersect(ro, rd);
        float t0 = max(hit.x, 0.0);
        float t1 = hit.y;
        if (t1 <= t0) discard;
        float len = min(t1 - t0, 3.2);
        float steps = clamp(uStepCount, 4.0, 20.0);
        float stepSize = len / steps;
        float jitter = blueJitter(gl_FragCoord.xy);

        vec3 rdWorld = normalize(vWorldPosition - uCameraWorld);
        float cosT = dot(rdWorld, uSunDir);
        float ph = phase(cosT);
        float ambientBase = 0.32 * mix(0.5, 1.0, uDayFactor);
        float ambientTop = 0.9 * mix(0.55, 1.0, uDayFactor);

        float transmittance = 1.0;
        vec3 accum = vec3(0.0);
        for (int i = 0; i < 20; i++) {
          if (float(i) >= steps || transmittance < 0.02) break;
          float t = t0 + (float(i) + jitter) * stepSize;
          vec3 p = ro + rd * t;
          vec3 wp = (uLocalToWorld * vec4(p, 1.0)).xyz;
          float h = p.y * 0.5 + 0.5;
          float d = cumulusDensity(p, wp);
          if (d > 0.002) {
            float lightDepth = 0.0;
            for (int ls = 0; ls < 3; ls++) {
              if (float(ls) >= uLightSteps) break;
              float ld = 0.1 + float(ls) * 0.16;
              vec3 sp = p + uSunLocal * ld;
              lightDepth += coarseDensity(sp, (uLocalToWorld * vec4(sp, 1.0)).xyz) * (1.0 - float(ls) * 0.24);
            }
            float sunT = exp(-lightDepth * 2.6);
            float directLight = sunT * ph * (0.4 + 0.6 * saturate(uSunDir.y + 0.2));
            vec3 albedo = cumulusAlbedo(h);
            float ambient = mix(ambientBase, ambientTop, h);
            vec3 radiance = albedo * (ambient + directLight * 1.15 * uDayFactor);
            radiance += vec3(1.0, 0.98, 0.94) * pow(max(cosT, 0.0), 4.0) * (0.15 + 0.35 * h) * uDayFactor * sunT;
            float a = 1.0 - exp(-d * stepSize * uExtinction * uOpacity * 4.4);
            accum += transmittance * radiance * a;
            transmittance *= 1.0 - a;
          }
        }

        float alpha = (1.0 - transmittance) * uDistanceFade;
        if (alpha < 0.01) discard;
        fragColor = vec4(accum / max(1.0 - transmittance, 1e-3), min(alpha, uMaxAlpha));
      }
    `,
  });
}
