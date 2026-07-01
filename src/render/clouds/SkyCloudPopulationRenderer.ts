import * as THREE from "three";
import { clusterOpacity } from "../../clouds/CloudPopulation";
import { CloudCluster, CloudPopulationBand, WeatherSceneState } from "../../weather/scene/WeatherScene";

const MAX_PUFFS = 540;

/** GPU point-impostor field for persistent MID and HORIZON cloud clusters. */
export class SkyCloudPopulationRenderer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_PUFFS * 3);
  private readonly sizes = new Float32Array(MAX_PUFFS * 2);
  private readonly seeds = new Float32Array(MAX_PUFFS);
  private readonly opacities = new Float32Array(MAX_PUFFS);
  private readonly developments = new Float32Array(MAX_PUFFS);
  private time = 0;
  private count = 0;
  /**
   * Sprites/points « stickers 2D » : ancien rendu des cumulus lointains.
   * Désactivé par défaut (mode `new`), gardé pour comparaison A/B.
   */
  private enabled = true;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(this.seeds, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aOpacity", new THREE.BufferAttribute(this.opacities, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aDevelopment", new THREE.BufferAttribute(this.developments, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uDayFactor: { value: 1 },
        uDarkening: { value: 0 },
        uViewportHeight: { value: 720 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uHazeColor: { value: new THREE.Color(0xa8c4e0) },
        uHazeDensity: { value: 0.00012 },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSize;
        attribute float aSeed;
        attribute float aOpacity;
        attribute float aDevelopment;
        uniform float uViewportHeight;
        varying float vAspect;
        varying float vSeed;
        varying float vOpacity;
        varying float vDevelopment;
        varying float vDistance;

        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float birthScale = mix(0.22, 1.0, smoothstep(0.0, 1.0, aOpacity));
          gl_PointSize = clamp(aSize.x * birthScale * uViewportHeight / max(80.0, -mv.z), 3.0, 240.0);
          gl_Position = projectionMatrix * mv;
          vAspect = clamp(aSize.y / max(1.0, aSize.x), 0.48, 1.85);
          vSeed = aSeed;
          vOpacity = aOpacity;
          vDevelopment = aDevelopment;
          vDistance = -mv.z;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        uniform float uDayFactor;
        uniform float uDarkening;
        uniform vec3 uSunDir;
        uniform vec3 uHazeColor;
        uniform float uHazeDensity;
        varying float vAspect;
        varying float vSeed;
        varying float vOpacity;
        varying float vDevelopment;
        varying float vDistance;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
        }
        float blob(vec2 p, vec2 c, vec2 r) {
          vec2 q = (p - c) / r;
          return exp(-dot(q, q) * 2.1);
        }

        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          p.y /= vAspect;
          float phase = vSeed * 61.7;
          float growth = smoothstep(0.0, 1.0, vDevelopment);
          float slow = uTime * 0.012;
          float mass = blob(p, vec2(0.0, -0.42), vec2(0.96, 0.28));
          mass += blob(p, vec2(-0.48, -0.16), vec2(0.44, 0.42));
          mass += blob(p, vec2(0.44, -0.15), vec2(0.48, 0.4));
          mass += blob(p, vec2(-0.18, 0.1 + growth * 0.1), vec2(0.5, 0.56 + growth * 0.12));
          mass += blob(p, vec2(0.2 + sin(phase) * 0.1, 0.34 + growth * 0.2), vec2(0.35, 0.38 + growth * 0.18));
          mass += blob(p, vec2(-0.32 + cos(phase) * 0.08, 0.48 + growth * 0.18), vec2(0.24, 0.25 + growth * 0.12)) * growth;
          float cauliflower = noise(p * 8.4 + vec2(phase * 0.3, slow * 1.8));
          float scallop = noise(p * 15.0 + vec2(phase * 0.9, -slow * 2.4));
          float erosion = noise(p * 5.5 + vec2(phase, slow)) * 0.16
            + noise(p * 12.0 - vec2(slow * 0.7, phase)) * 0.06
            + cauliflower * growth * 0.035
            + scallop * 0.025;
          float density = mass * 0.48 - erosion;
          float baseClip = smoothstep(-0.88, -0.72, p.y) * (1.0 - smoothstep(0.95, 1.08, p.y));
          float alpha = smoothstep(0.17, 0.4, density) * baseClip * vOpacity;
          if (alpha < 0.008) discard;

          float vertical = smoothstep(-0.7, 0.72, p.y);
          // Bases plus claires (un cumulus de beau temps est gris-blanc lumineux,
          // pas une soucoupe sombre vue d'en bas).
          vec3 shadow = mix(vec3(0.10, 0.115, 0.15), vec3(0.66, 0.68, 0.70), uDayFactor);
          vec3 light = mix(vec3(0.30, 0.33, 0.40), vec3(0.97, 0.98, 0.95), uDayFactor);
          float sunSide = clamp(0.55 + p.x * uSunDir.x * 0.22 + vertical * max(uSunDir.y, 0.0) * 0.28, 0.0, 1.0);
          vec3 color = mix(shadow, light, 0.56 + vertical * 0.3 + sunSide * 0.18);
          color += light * pow(sunSide, 5.0) * 0.08 * uDayFactor;
          color = mix(color, shadow, smoothstep(0.38, 0.72, density) * (1.0 - vertical) * 0.18);
          color *= 1.0 - uDarkening * (0.22 + (1.0 - vertical) * 0.18);
          // Perspective aérienne : les nuages lointains se fondent dans la brume
          // de l'horizon (ils ne « stampent » plus à l'horizon).
          float haze = 1.0 - exp(-max(vDistance, 0.0) * uHazeDensity);
          color = mix(color, uHazeColor, haze * 0.85);
          gl_FragColor = vec4(color, alpha * mix(0.54, 0.78, density) * mix(0.76, 1.0, growth));
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  update(
    dt: number,
    clusters: readonly CloudCluster[],
    sceneState: WeatherSceneState,
    camera: THREE.Camera,
    dayFactor: number,
    sunDirection: THREE.Vector3,
  ): void {
    if (!this.enabled) {
      if (this.count !== 0 || this.points.visible) {
        this.count = 0;
        this.geometry.setDrawRange(0, 0);
        this.points.visible = false;
      }
      return;
    }
    this.time += dt;
    let count = 0;
    const cameraPosition = camera.position;
    for (const cluster of clusters) {
      if (count >= MAX_PUFFS) break;
      if (cluster.band !== CloudPopulationBand.HORIZON_FIELD && cluster.band !== CloudPopulationBand.MID_FIELD) continue;
      const opacity = clusterOpacity(cluster);
      if (opacity <= 0.004) continue;
      const horizonBand = cluster.band === CloudPopulationBand.HORIZON_FIELD;
      const distance = Math.hypot(cluster.x - cameraPosition.x, cluster.z - cameraPosition.z);
      const farBlend = smoothstep(distance, horizonBand ? 3400 : 4600, horizonBand ? 7800 : 7200);
      const distanceFade = 1 - smoothstep(distance, horizonBand ? 6600 : 7600, horizonBand ? 9200 : 8600);
      const clusterOpacityWithDistance = opacity * distanceFade;
      if (clusterOpacityWithDistance <= 0.012) continue;
      const puffCount = horizonBand ? (farBlend > 0.74 ? 1 : farBlend > 0.46 ? 2 : 3) : cluster.type === "TOWERING" ? 8 : 6;
      for (let puff = 0; puff < puffCount && count < MAX_PUFFS; puff += 1) {
        const localSeed = hash01(cluster.seed * 127.13 + puff * 19.37);
        const localSeedB = hash01(cluster.seed * 311.41 + puff * 37.11);
        const angle = cluster.seed * 31.7 + puff * 2.39996 + (localSeed - 0.5) * 0.9;
        const spread = cluster.targetSize * (puff === 0 ? 0 : lerp(0.26, 0.68, localSeed));
        const p = count * 3;
        this.positions[p] = cluster.x + Math.cos(angle) * spread;
        const verticalRise = horizonBand
          ? 0.1 + (localSeedB - 0.5) * 0.1
          : cluster.type === "TOWERING"
            ? 0.18 + puff * 0.13 + localSeedB * 0.12
            : 0.14 + puff * 0.045 + (localSeedB - 0.5) * 0.12;
        this.positions[p + 1] = cluster.baseHeight + cluster.targetSize * verticalRise;
        this.positions[p + 2] = cluster.z + Math.sin(angle) * spread;
        const s = count * 2;
        const scale = horizonBand ? lerp(2.25, 1.18, farBlend) : 2.02;
        const heightScale = cluster.type === "TOWERING" ? 2.9 : cluster.type === "SCATTERED" ? 1.42 : 1.05;
        const anvilSpread = cluster.type === "TOWERING" && puff > 4 ? 1.35 : 1;
        this.sizes[s] = cluster.targetSize * scale * (puff === 0 ? 1 : lerp(0.56, 0.96, localSeed)) * anvilSpread;
        this.sizes[s + 1] = cluster.targetSize * heightScale * (puff === 0 ? 0.82 : lerp(0.52, 0.9, localSeedB)) * (horizonBand ? 0.58 : 1);
        this.seeds[count] = cluster.seed + puff * 0.173;
        const hazeOpacity = horizonBand ? lerp(0.6, 0.28, farBlend) : 0.84;
        this.opacities[count] = clamp01(clusterOpacityWithDistance * hazeOpacity * (puff === 0 ? 1 : lerp(0.66, 0.92, localSeed)));
        this.developments[count] = clamp01((cluster.type === "TOWERING" ? 0.94 : cluster.type === "SCATTERED" ? 0.56 : 0.24) + (localSeed - 0.5) * 0.16);
        count += 1;
      }
    }

    this.count = count;
    this.geometry.setDrawRange(0, count);
    this.points.visible = count > 0;
    for (const name of ["position", "aSize", "aSeed", "aOpacity", "aDevelopment"]) {
      this.geometry.getAttribute(name).needsUpdate = true;
    }
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uDayFactor.value = dayFactor;
    this.material.uniforms.uDarkening.value = Math.max(
      sceneState.precipitation.intensity * 0.55,
      sceneState.convectiveState.cellActive ? 0.42 : 0,
    );
    this.material.uniforms.uViewportHeight.value = Math.max(320, window.innerHeight * window.devicePixelRatio);
    (this.material.uniforms.uSunDir.value as THREE.Vector3).copy(sunDirection).normalize();
  }

  /** Active/désactive les sprites (A/B). En `new` mode ils sont coupés. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.points.visible = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Couleur de brume d'horizon pour la perspective aérienne des nuages. */
  setHaze(color: THREE.Color): void {
    (this.material.uniforms.uHazeColor.value as THREE.Color).copy(color);
  }

  get visibleCount(): number {
    return this.count;
  }

  dispose(): void {
    this.points.parent?.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(value: number, edge0: number, edge1: number): number {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash01(v: number): number {
  return fract(Math.sin(v * 12.9898) * 43758.5453);
}

function fract(v: number): number {
  return v - Math.floor(v);
}
