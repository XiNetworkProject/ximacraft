import * as THREE from "three";
import type {
  DistantPrecipitationFieldDebug,
  DistantPrecipitationFieldState,
  DistantPrecipitationMode,
  DistantPrecipitationPatch,
  DistantPrecipitationQuality,
} from "../../weather/precipitation/DistantPrecipitationField";

export interface DistantPrecipitationRenderDebug extends DistantPrecipitationFieldDebug {
  drawCount: number;
}

interface QualityBudget {
  drawCount: number;
  streaksPerPatch: number;
  hazePerPatch: number;
}

const MAX_PARTICLES = 4200;

const QUALITY: Record<DistantPrecipitationQuality, QualityBudget> = {
  low: { drawCount: 1000, streaksPerPatch: 72, hazePerPatch: 8 },
  balanced: { drawCount: 2200, streaksPerPatch: 130, hazePerPatch: 14 },
  high: { drawCount: 3800, streaksPerPatch: 190, hazePerPatch: 22 },
};

/**
 * World-space distant rain visualisation.
 *
 * It deliberately avoids the old vertical curtain mesh: this renderer only
 * draws bounded, irregular precipitation patches produced by
 * DistantPrecipitationField. Large soft particles create the far blue-grey veil;
 * thin broken particles create mid-distance streaks. Near-camera rain remains
 * the responsibility of PrecipitationRenderer.
 */
export class DistantPrecipitationRenderer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly sizes = new Float32Array(MAX_PARTICLES);
  private readonly alphas = new Float32Array(MAX_PARTICLES);
  private readonly seeds = new Float32Array(MAX_PARTICLES);
  private readonly modes = new Float32Array(MAX_PARTICLES);
  private readonly bottoms = new Float32Array(MAX_PARTICLES);
  private readonly heights = new Float32Array(MAX_PARTICLES);
  private readonly fallSpeeds = new Float32Array(MAX_PARTICLES);
  private readonly tiltX = new Float32Array(MAX_PARTICLES);
  private readonly tiltZ = new Float32Array(MAX_PARTICLES);
  private enabled = true;
  private drawCount = 0;
  private lastField: DistantPrecipitationFieldDebug = {
    enabled: true,
    active: false,
    mode: "off",
    patchesVisible: 0,
    nearestPatchDistance: null,
    rainBandIntensity: 0,
    windTilt: 0,
    localRainBlend: 0,
  };

  constructor(private readonly scene: THREE.Scene) {
    this.addAttribute("position", this.positions, 3);
    this.addAttribute("aSize", this.sizes, 1);
    this.addAttribute("aAlpha", this.alphas, 1);
    this.addAttribute("aSeed", this.seeds, 1);
    this.addAttribute("aMode", this.modes, 1);
    this.addAttribute("aBottom", this.bottoms, 1);
    this.addAttribute("aHeight", this.heights, 1);
    this.addAttribute("aFallSpeed", this.fallSpeeds, 1);
    this.addAttribute("aTiltX", this.tiltX, 1);
    this.addAttribute("aTiltZ", this.tiltZ, 1);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uDayFactor: { value: 1 },
        uCameraPosition: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSeed;
        attribute float aMode;
        attribute float aBottom;
        attribute float aHeight;
        attribute float aFallSpeed;
        attribute float aTiltX;
        attribute float aTiltZ;
        uniform float uTime;
        uniform vec3 uCameraPosition;
        varying float vAlpha;
        varying float vSeed;
        varying float vMode;
        varying float vTilt;
        varying float vNear;
        varying float vHeightFade;

        void main() {
          vec3 p = position;
          float height = max(8.0, aHeight);
          float fall = mod(uTime * aFallSpeed * (0.72 + aSeed * 0.46) + aSeed * height, height);
          if (aMode < 1.5) {
            float wrapped = mod(position.y - aBottom - fall + height, height);
            p.y = aBottom + wrapped;
            float drift = position.y - p.y;
            p.x += aTiltX * drift * 0.038;
            p.z += aTiltZ * drift * 0.038;
          } else {
            p.x += sin(uTime * 0.17 + aSeed * 11.0) * aTiltX * 0.28;
            p.z += cos(uTime * 0.14 + aSeed * 13.0) * aTiltZ * 0.28;
          }

          float distanceToCamera = distance(p.xz, uCameraPosition.xz);
          vNear = 1.0 - smoothstep(1800.0, 6600.0, distanceToCamera);
          vHeightFade = smoothstep(aBottom, aBottom + 22.0, p.y) * (1.0 - smoothstep(aBottom + height - 20.0, aBottom + height, p.y));
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * 640.0 / max(120.0, -mvPosition.z), 1.1, aMode > 0.5 ? 72.0 : 26.0);
          vAlpha = aAlpha;
          vSeed = aSeed;
          vMode = aMode;
          vTilt = clamp((aTiltX + aTiltZ) * 0.035, -0.6, 0.6);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uDayFactor;
        varying float vAlpha;
        varying float vSeed;
        varying float vMode;
        varying float vTilt;
        varying float vNear;
        varying float vHeightFade;

        float hash(vec2 p) {
          return fract(sin(dot(p + vSeed, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float alpha = 0.0;
          vec3 color = vec3(0.42, 0.50, 0.58);

          if (vMode < 0.5) {
            p.x += p.y * vTilt;
            float broken = step(0.16, hash(floor(gl_FragCoord.xy * vec2(0.09, 0.22))));
            float streak = 1.0 - smoothstep(0.028, 0.12, abs(p.x));
            float ends = smoothstep(1.0, 0.2, abs(p.y));
            alpha = streak * ends * (0.52 + broken * 0.48);
            color = mix(vec3(0.20, 0.25, 0.30), vec3(0.56, 0.63, 0.69), vNear);
          } else if (vMode < 1.5) {
            float r = length(vec2(p.x * 0.82, p.y));
            float mist = 1.0 - smoothstep(0.08, 1.0, r);
            float breakup = 0.62 + hash(floor(gl_FragCoord.xy * 0.045)) * 0.38;
            alpha = mist * breakup;
            color = mix(vec3(0.16, 0.20, 0.25), vec3(0.50, 0.58, 0.64), vNear);
          } else {
            float r = length(vec2(p.x * 0.74, p.y));
            float virga = 1.0 - smoothstep(0.12, 1.0, r);
            alpha = virga * (0.44 + hash(floor(gl_FragCoord.xy * 0.06)) * 0.3);
            color = vec3(0.46, 0.54, 0.60);
          }

          alpha *= vAlpha * vHeightFade;
          alpha *= mix(0.72, 1.05, uDayFactor);
          if (alpha < 0.006) discard;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.48));
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2.15;
    this.points.visible = false;
    this.scene.add(this.points);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    this.drawCount = 0;
    this.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }

  update(params: {
    field: DistantPrecipitationFieldState;
    fieldDebug: DistantPrecipitationFieldDebug;
    camera: THREE.PerspectiveCamera;
    quality: DistantPrecipitationQuality;
    time: number;
    dayFactor: number;
  }): void {
    this.lastField = params.fieldDebug;
    this.material.uniforms.uTime.value = params.time;
    this.material.uniforms.uDayFactor.value = params.dayFactor;
    this.material.uniforms.uCameraPosition.value.copy(params.camera.position);

    if (!this.enabled || !params.field.active) {
      this.clear();
      return;
    }

    const budget = QUALITY[params.quality];
    let count = 0;
    for (const patch of params.field.patches) {
      if (count >= budget.drawCount) break;
      count = this.writePatch(patch, count, budget, params.field.mode);
    }

    this.drawCount = Math.min(count, budget.drawCount);
    this.geometry.setDrawRange(0, this.drawCount);
    this.points.visible = this.drawCount > 0;
    this.markDirty();
  }

  debug(): DistantPrecipitationRenderDebug {
    return {
      ...this.lastField,
      enabled: this.enabled,
      active: this.enabled && this.drawCount > 0 && this.lastField.active,
      drawCount: this.drawCount,
    };
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }

  private writePatch(
    patch: DistantPrecipitationPatch,
    start: number,
    budget: QualityBudget,
    fieldMode: DistantPrecipitationMode,
  ): number {
    const localSuppression = fieldMode === "local" ? 0.58 : 1;
    const streakTarget = Math.floor(budget.streaksPerPatch * patch.density * localSuppression);
    const hazeTarget = Math.floor(budget.hazePerPatch * (0.45 + patch.opacity) * (fieldMode === "far" ? 1.2 : 1));
    let count = start;
    for (let i = 0; i < streakTarget && count < budget.drawCount && count < MAX_PARTICLES; i += 1) {
      const p = this.samplePatchPoint(patch, i, 0);
      if (!p) continue;
      this.writeParticle(count, patch, p.x, p.y, p.z, 0, 2.6 + rand(patch.seed, i, 11) * 5.4, patch.opacity * (0.16 + rand(patch.seed, i, 12) * 0.18));
      count += 1;
    }
    for (let i = 0; i < hazeTarget && count < budget.drawCount && count < MAX_PARTICLES; i += 1) {
      const p = this.samplePatchPoint(patch, i, 40);
      if (!p) continue;
      const mode = patch.virga ? 2 : 1;
      const size = patch.virga ? 46 + rand(patch.seed, i, 43) * 80 : 72 + rand(patch.seed, i, 43) * 125;
      this.writeParticle(count, patch, p.x, p.y, p.z, mode, size, patch.opacity * (patch.virga ? 0.035 : 0.052));
      count += 1;
    }
    return count;
  }

  private samplePatchPoint(patch: DistantPrecipitationPatch, index: number, saltOffset: number): { x: number; y: number; z: number } | null {
    const ax = randSigned(patch.seed, index, saltOffset + 1);
    const dz = randSigned(patch.seed, index, saltOffset + 2);
    const ellipse = ax * ax + dz * dz;
    if (ellipse > 1.08) return null;
    const edgeFade = 1 - THREE.MathUtils.smoothstep(ellipse, 0.64, 1.08);
    if (rand(patch.seed, index, saltOffset + 3) > 0.38 + edgeFade * 0.62) return null;
    const localX = ax * patch.radiusX;
    const localZ = dz * patch.radiusZ;
    const x = patch.x + patch.rightX * localX + patch.forwardX * localZ;
    const z = patch.z + patch.rightZ * localX + patch.forwardZ * localZ;
    const y = THREE.MathUtils.lerp(patch.bottomY, patch.topY, rand(patch.seed, index, saltOffset + 4));
    return { x, y, z };
  }

  private writeParticle(index: number, patch: DistantPrecipitationPatch, x: number, y: number, z: number, mode: number, size: number, alpha: number): void {
    const p = index * 3;
    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = z;
    this.sizes[index] = size;
    this.alphas[index] = alpha;
    this.seeds[index] = patch.seed;
    this.modes[index] = mode;
    this.bottoms[index] = patch.bottomY;
    this.heights[index] = Math.max(8, patch.topY - patch.bottomY);
    this.fallSpeeds[index] = patch.fallSpeed;
    this.tiltX[index] = patch.windTiltX;
    this.tiltZ[index] = patch.windTiltZ;
  }

  private addAttribute(name: string, array: Float32Array, itemSize: number): void {
    this.geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage));
  }

  private markDirty(): void {
    for (const key of ["position", "aSize", "aAlpha", "aSeed", "aMode", "aBottom", "aHeight", "aFallSpeed", "aTiltX", "aTiltZ"]) {
      this.geometry.getAttribute(key).needsUpdate = true;
    }
  }
}

function rand(seed: number, index: number, salt: number): number {
  const v = Math.sin(seed * 917.13 + index * 37.719 + salt * 17.173) * 43758.5453123;
  return v - Math.floor(v);
}

function randSigned(seed: number, index: number, salt: number): number {
  return rand(seed, index, salt) * 2 - 1;
}
