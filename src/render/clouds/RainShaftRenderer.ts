import * as THREE from "three";
import { PrecipKind } from "../../weather/WeatherTypes";

export interface RainShaftSpec {
  x: number;
  z: number;
  baseHeight: number;
  width: number;
  depth: number;
  intensity: number;
  windX: number;
  windZ: number;
  kind: PrecipKind;
  dayFactor: number;
  lightning: number;
}

interface RainShaftSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  worldToLocal: THREE.Matrix4;
  cameraLocal: THREE.Vector3;
}

const MAX_SHAFTS = 4;
const GROUND_HEIGHT = 42;

/** Distant precipitation volume attached to the underside of convective clouds. */
export class RainShaftRenderer {
  private readonly geometry = new THREE.BoxGeometry(2, 2, 2);
  private readonly slots: RainShaftSlot[] = [];

  get activeCount(): number {
    return this.slots.reduce((count, slot) => count + (slot.mesh.visible ? 1 : 0), 0);
  }

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < MAX_SHAFTS; i += 1) {
      const material = this.createMaterial();
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.slots.push({
        mesh,
        material,
        worldToLocal: new THREE.Matrix4(),
        cameraLocal: new THREE.Vector3(),
      });
    }
  }

  update(specs: readonly RainShaftSpec[], cameraPosition: THREE.Vector3, time: number): void {
    let slotIndex = 0;
    for (const spec of specs) {
      if (slotIndex >= this.slots.length) break;
      if (spec.intensity < 0.08) continue;
      const slot = this.slots[slotIndex];
      const height = Math.max(40, spec.baseHeight - GROUND_HEIGHT);
      const windLength = Math.hypot(spec.windX, spec.windZ);
      const windX = windLength > 0.01 ? spec.windX / windLength : 0;
      const windZ = windLength > 0.01 ? spec.windZ / windLength : 0;
      const slant = Math.min(220, windLength * height * 0.012);
      slot.mesh.position.set(
        spec.x + windX * slant * 0.5,
        GROUND_HEIGHT + height * 0.5,
        spec.z + windZ * slant * 0.5,
      );
      slot.mesh.scale.set(spec.width * 0.48, height * 0.5, spec.depth * 0.48);
      slot.mesh.updateMatrixWorld(true);
      slot.worldToLocal.copy(slot.mesh.matrixWorld).invert();
      slot.mesh.worldToLocal(slot.cameraLocal.copy(cameraPosition));
      slot.material.uniforms.uCameraLocal.value.copy(slot.cameraLocal);
      slot.material.uniforms.uIntensity.value = spec.intensity;
      slot.material.uniforms.uWind.value.set(windX, windZ);
      slot.material.uniforms.uTime.value = time;
      slot.material.uniforms.uKind.value = spec.kind === "snow" ? 1 : spec.kind === "hail" ? 2 : 0;
      slot.material.uniforms.uDayFactor.value = spec.dayFactor;
      slot.material.uniforms.uLightning.value = spec.lightning;
      slot.mesh.visible = true;
      slotIndex += 1;
    }
    for (let i = slotIndex; i < this.slots.length; i += 1) this.slots[i].mesh.visible = false;
  }

  setDepthContext(
    depthTexture: THREE.Texture,
    camera: THREE.PerspectiveCamera,
    lowWidth: number,
    lowHeight: number,
  ): void {
    for (const slot of this.slots) {
      if (!slot.mesh.visible) continue;
      const uniforms = slot.material.uniforms;
      uniforms.uSceneDepth.value = depthTexture;
      uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
      uniforms.uCameraWorld.value.copy(camera.matrixWorld);
      uniforms.uWorldToLocal.value.copy(slot.worldToLocal);
      uniforms.uLowResolution.value.set(lowWidth, lowHeight);
    }
  }

  private createMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      blending: THREE.NormalBlending,
      toneMapped: false,
      uniforms: {
        uCameraLocal: { value: new THREE.Vector3() },
        uSceneDepth: { value: null },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uWorldToLocal: { value: new THREE.Matrix4() },
        uLowResolution: { value: new THREE.Vector2(1, 1) },
        uWind: { value: new THREE.Vector2() },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uKind: { value: 0 },
        uDayFactor: { value: 1 },
        uLightning: { value: 0 },
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
        uniform vec3 uCameraLocal;
        uniform sampler2D uSceneDepth;
        uniform mat4 uInvProjection, uCameraWorld, uWorldToLocal;
        uniform vec2 uLowResolution;
        uniform vec2 uWind;
        uniform float uIntensity;
        uniform float uTime;
        uniform float uKind;
        uniform float uDayFactor;
        uniform float uLightning;
        varying vec3 vLocalPosition;

        vec2 intersectBox(vec3 ro, vec3 rd) {
          vec3 invDir = 1.0 / rd;
          vec3 lo = (-vec3(1.0) - ro) * invDir;
          vec3 hi = (vec3(1.0) - ro) * invDir;
          vec3 nearV = min(lo, hi);
          vec3 farV = max(lo, hi);
          return vec2(max(max(nearV.x, nearV.y), nearV.z), min(min(farV.x, farV.y), farV.z));
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                     mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
        }

        float shaftDensity(vec3 p) {
          float height = p.y * 0.5 + 0.5;
          vec2 slanted = p.xz - uWind * (0.5 - height) * 0.24;
          float edgeNoise = valueNoise(slanted * 3.2 + vec2(uTime * 0.015, -uTime * 0.01));
          float radial = length(slanted / vec2(0.98, 0.82));
          float curtain = 1.0 - smoothstep(0.6 + edgeNoise * 0.12, 1.02 + edgeNoise * 0.08, radial);
          float macro = hash21(floor((slanted + 1.0) * vec2(7.0, 5.0)));
          float cells = hash21(floor((slanted + 1.0) * vec2(43.0, 31.0)));
          float macroCoverage = smoothstep(0.18, 0.82, macro);
          float streak = smoothstep(0.3, 0.94, cells) * mix(0.24, 1.0, macroCoverage);
          float verticalPulse = 0.68 + 0.32 * sin((height - uTime * 0.38) * 95.0 + cells * 8.0);
          float verticalFade = smoothstep(0.0, 0.08, height) * (1.0 - smoothstep(0.9, 1.0, height));
          float raggedColumns = smoothstep(0.18, 0.82, valueNoise(slanted * vec2(5.0, 3.8) + 17.0));
          return curtain * verticalFade * (0.025 + macroCoverage * 0.13 + streak * verticalPulse * 0.62)
            * mix(0.48, 1.0, raggedColumns) * uIntensity;
        }

        void main() {
          vec3 rayDirection = normalize(vLocalPosition - uCameraLocal);
          vec2 hit = intersectBox(uCameraLocal, rayDirection);
          float startT = max(hit.x, 0.0);
          float endT = hit.y;
          if (endT <= startT) discard;

          vec2 screenUv = gl_FragCoord.xy / uLowResolution;
          float sceneDepth = texture2D(uSceneDepth, screenUv).r;
          if (sceneDepth < 0.999999) {
            vec4 clip = vec4(screenUv * 2.0 - 1.0, sceneDepth * 2.0 - 1.0, 1.0);
            vec4 viewPosition = uInvProjection * clip;
            viewPosition /= max(0.00001, viewPosition.w);
            vec3 sceneWorld = (uCameraWorld * viewPosition).xyz;
            vec3 sceneLocal = (uWorldToLocal * vec4(sceneWorld, 1.0)).xyz;
            float sceneT = dot(sceneLocal - uCameraLocal, rayDirection);
            if (sceneT > 0.0) endT = min(endT, sceneT);
          }
          if (endT <= startT) discard;

          float stepLength = (endT - startT) / 22.0;
          float t = startT + stepLength * 0.5;
          float transmittance = 1.0;
          for (int i = 0; i < 22; i++) {
            vec3 p = uCameraLocal + rayDirection * t;
            float density = shaftDensity(p);
            transmittance *= exp(-density * stepLength * 2.2);
            if (transmittance < 0.08) break;
            t += stepLength;
          }
          float alpha = (1.0 - transmittance) * 0.9;
          if (alpha < 0.004) discard;
          bool inside = all(lessThan(abs(uCameraLocal), vec3(1.0)));
          float day = clamp(uDayFactor, 0.0, 1.0);
          vec3 rainColor = inside
            ? mix(vec3(0.2, 0.28, 0.36), vec3(0.48, 0.57, 0.65), day)
            : mix(vec3(0.035, 0.045, 0.065), vec3(0.075, 0.095, 0.125), day);
          vec3 snowColor = inside
            ? mix(vec3(0.34, 0.42, 0.5), vec3(0.56, 0.64, 0.7), day)
            : mix(vec3(0.11, 0.14, 0.19), vec3(0.22, 0.27, 0.32), day);
          vec3 hailColor = inside
            ? mix(vec3(0.4, 0.46, 0.54), vec3(0.64, 0.7, 0.77), day)
            : mix(vec3(0.14, 0.17, 0.23), vec3(0.24, 0.27, 0.33), day);
          vec3 color = uKind > 1.5 ? hailColor : uKind > 0.5 ? snowColor : rainColor;
          color = mix(color, vec3(0.68, 0.78, 0.9), clamp(uLightning, 0.0, 1.0) * 0.7);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
  }

  dispose(): void {
    for (const slot of this.slots) {
      this.scene.remove(slot.mesh);
      slot.material.dispose();
    }
    this.geometry.dispose();
  }
}
