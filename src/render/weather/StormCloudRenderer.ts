import * as THREE from "three";
import { SquallLineEvent } from "../../weather/events/SquallLineEvent";
import { WeatherEvent } from "../../weather/events/WeatherEvent";
import { createCloudNoiseAtlas } from "./CloudNoiseAtlas";

const POOL_SIZE = 4;
const MAX_DISTANCE = 10500;
const LOW_RES_SCALE = 0.25;
const JITTER_SEQUENCE = [0.5, 0.125, 0.75, 0.375, 0.875, 0.25, 0.625, 0.0625, 0.5625, 0.1875, 0.8125, 0.4375, 0.9375, 0.3125, 0.6875, 0.0];

interface VolumeSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  cameraLocal: THREE.Vector3;
  worldToLocal: THREE.Matrix4;
}

/**
 * Continuous storm volume.
 *
 * The cloud is a procedural density field ray-marched inside an invisible box.
 * Its density profile explicitly separates the lowered base, tilted updraft,
 * overshooting top and downwind anvil, avoiding visible cloud planes or puffs.
 */
export class StormCloudRenderer {
  private readonly geometry = new THREE.BoxGeometry(2, 2, 2);
  private readonly slots: VolumeSlot[] = [];
  private readonly noiseAtlas = createCloudNoiseAtlas();
  private readonly cloudScene = new THREE.Scene();
  private readonly screenScene = new THREE.Scene();
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly screenQuad: THREE.Mesh;
  private readonly resolveMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private cloudCurrentTarget: THREE.WebGLRenderTarget | null = null;
  private historyReadTarget: THREE.WebGLRenderTarget | null = null;
  private historyWriteTarget: THREE.WebGLRenderTarget | null = null;
  private readonly drawingSize = new THREE.Vector2();
  private readonly previousCameraPosition = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly previousCameraQuaternion = new THREE.Quaternion();
  private activeSlotCount = 0;
  private historyValid = false;
  private frame = 0;

  constructor(_scene: THREE.Scene) {
    this.resolveMaterial = this.createResolveMaterial();
    this.compositeMaterial = this.createCompositeMaterial();
    this.screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.resolveMaterial);
    this.screenQuad.frustumCulled = false;
    this.screenCamera.position.z = 1;
    this.screenScene.add(this.screenQuad);

    for (let i = 0; i < POOL_SIZE; i += 1) {
      const material = this.createMaterial();
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.cloudScene.add(mesh);
      this.slots.push({ mesh, material, cameraLocal: new THREE.Vector3(), worldToLocal: new THREE.Matrix4() });
    }
  }

  update(
    time: number,
    events: readonly WeatherEvent[],
    cameraPosition: THREE.Vector3,
    dayFactor: number,
    qualityLevel = 1,
  ): void {
    let slotIndex = 0;

    for (const event of events) {
      if (slotIndex >= POOL_SIZE) break;
      if (!event.producesLightning && event.intensity < 0.74) continue;

      const distance = Math.hypot(event.x - cameraPosition.x, event.z - cameraPosition.z);
      if (distance > MAX_DISTANCE) continue;

      const farFade = 1 - THREE.MathUtils.smoothstep(distance, 8200, MAX_DISTANCE);
      const opacity = event.intensity * this.lifeFade(event) * farFade;
      if (opacity < 0.012) continue;

      const slot = this.slots[slotIndex];
      const squall = event instanceof SquallLineEvent;
      const forward = this.forward(event);
      const leadingOffset = squall ? event.thickness * 0.08 : event.radius * 0.12;

      const halfWidth = squall
        ? THREE.MathUtils.clamp(event.length * 0.52, 700, 2600)
        : THREE.MathUtils.clamp(event.radius * 0.72, 280, 700);
      const halfDepth = squall
        ? THREE.MathUtils.clamp(event.thickness * 0.72, 260, 680)
        : THREE.MathUtils.clamp(event.radius * 0.72, 280, 700);
      // Un cumulonimbus est BIEN plus haut que large (sinon "soucoupe").
      const height = squall
        ? 440 + event.intensity * 210
        : 800 + event.intensity * 350;
      const bottom = event.cloudBaseY - 50;

      slot.mesh.position.set(
        event.x + forward.x * leadingOffset,
        bottom + height * 0.5,
        event.z + forward.z * leadingOffset,
      );
      slot.mesh.rotation.set(0, Math.atan2(forward.x, forward.z), 0);
      slot.mesh.scale.set(halfWidth, height * 0.5, halfDepth);
      slot.mesh.updateMatrixWorld(true);
      slot.worldToLocal.copy(slot.mesh.matrixWorld).invert();
      slot.mesh.worldToLocal(slot.cameraLocal.copy(cameraPosition));

      const uniforms = slot.material.uniforms;
      uniforms.uCameraLocal.value.copy(slot.cameraLocal);
      uniforms.uTime.value = time;
      uniforms.uOpacity.value = opacity;
      uniforms.uIntensity.value = event.intensity;
      uniforms.uDayFactor.value = THREE.MathUtils.clamp(dayFactor, 0.08, 1);
      uniforms.uSeed.value = event.id * 0.137;
      uniforms.uSquall.value = squall ? 1 : 0;
      const distanceSteps = distance > 4500 ? 20 : distance > 2000 ? 26 : 32;
      const qualityOffset = qualityLevel >= 2 ? 5 : qualityLevel <= 0 ? -4 : 0;
      uniforms.uStepCount.value = THREE.MathUtils.clamp(distanceSteps + qualityOffset, 16, 38);
      slot.mesh.visible = true;
      slotIndex += 1;
    }

    for (let i = slotIndex; i < this.slots.length; i += 1) {
      this.slots[i].mesh.visible = false;
    }
    if (slotIndex === 0 && this.activeSlotCount > 0) this.historyValid = false;
    this.activeSlotCount = slotIndex;
  }

  clear(): void {
    this.activeSlotCount = 0;
    this.historyValid = false;
    for (const slot of this.slots) slot.mesh.visible = false;
  }

  renderFrame(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ): void {
    if (this.activeSlotCount === 0) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    this.ensureTargets(renderer);
    const sceneTarget = this.sceneTarget;
    const cloudCurrentTarget = this.cloudCurrentTarget;
    const historyReadTarget = this.historyReadTarget;
    const historyWriteTarget = this.historyWriteTarget;
    if (!sceneTarget || !cloudCurrentTarget || !historyReadTarget || !historyWriteTarget) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
    const previousClearAlpha = renderer.getClearAlpha();
    camera.updateMatrixWorld();

    renderer.setRenderTarget(sceneTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    const cameraMoved = !this.historyValid
      || camera.position.distanceToSquared(this.previousCameraPosition) > 0.0025
      || 1 - Math.abs(camera.quaternion.dot(this.previousCameraQuaternion)) > 0.000002;
    const jitter = cameraMoved ? 0.5 : JITTER_SEQUENCE[this.frame % JITTER_SEQUENCE.length];
    this.frame += 1;

    const lowWidth = cloudCurrentTarget.width;
    const lowHeight = cloudCurrentTarget.height;
    for (const slot of this.slots) {
      if (!slot.mesh.visible) continue;
      const uniforms = slot.material.uniforms;
      uniforms.uJitter.value = jitter;
      uniforms.uSceneDepth.value = sceneTarget.depthTexture;
      uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
      uniforms.uCameraWorld.value.copy(camera.matrixWorld);
      uniforms.uWorldToLocal.value.copy(slot.worldToLocal);
      uniforms.uLowResolution.value.set(lowWidth, lowHeight);
    }

    renderer.setRenderTarget(cloudCurrentTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.cloudScene, camera);

    const resolveUniforms = this.resolveMaterial.uniforms;
    resolveUniforms.uCurrent.value = cloudCurrentTarget.texture;
    resolveUniforms.uHistory.value = historyReadTarget.texture;
    resolveUniforms.uTexelSize.value.set(1 / lowWidth, 1 / lowHeight);
    resolveUniforms.uCurrentWeight.value = this.historyValid ? (cameraMoved ? 0.82 : 0.14) : 1;
    this.screenQuad.material = this.resolveMaterial;
    renderer.setRenderTarget(historyWriteTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.screenScene, this.screenCamera);

    this.historyReadTarget = historyWriteTarget;
    this.historyWriteTarget = historyReadTarget;
    this.historyValid = true;
    this.previousCameraPosition.copy(camera.position);
    this.previousCameraQuaternion.copy(camera.quaternion);

    this.compositeMaterial.uniforms.uSceneColor.value = sceneTarget.texture;
    this.compositeMaterial.uniforms.uCloudColor.value = historyWriteTarget.texture;
    this.screenQuad.material = this.compositeMaterial;
    renderer.setRenderTarget(null);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.clear(true, true, true);
    renderer.render(this.screenScene, this.screenCamera);
  }

  private ensureTargets(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.drawingSize);
    const width = Math.max(1, Math.floor(this.drawingSize.x));
    const height = Math.max(1, Math.floor(this.drawingSize.y));
    const lowWidth = Math.max(1, Math.ceil(width * LOW_RES_SCALE));
    const lowHeight = Math.max(1, Math.ceil(height * LOW_RES_SCALE));
    if (
      this.sceneTarget?.width === width
      && this.sceneTarget.height === height
      && this.cloudCurrentTarget?.width === lowWidth
      && this.cloudCurrentTarget.height === lowHeight
    ) return;

    this.disposeTargets();
    this.sceneTarget = this.createTarget(width, height, true);
    this.cloudCurrentTarget = this.createTarget(lowWidth, lowHeight, false);
    this.historyReadTarget = this.createTarget(lowWidth, lowHeight, false);
    this.historyWriteTarget = this.createTarget(lowWidth, lowHeight, false);
    this.historyValid = false;

    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const target of [this.cloudCurrentTarget, this.historyReadTarget, this.historyWriteTarget]) {
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
    }
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
  }

  private createTarget(width: number, height: number, withDepth: boolean): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: withDepth,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    if (withDepth) {
      target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
      target.depthTexture.format = THREE.DepthFormat;
      target.depthTexture.minFilter = THREE.NearestFilter;
      target.depthTexture.magFilter = THREE.NearestFilter;
    }
    return target;
  }

  private createResolveMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uCurrent: { value: null },
        uHistory: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uCurrentWeight: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uCurrent;
        uniform sampler2D uHistory;
        uniform vec2 uTexelSize;
        uniform float uCurrentWeight;
        varying vec2 vUv;

        void main() {
          vec4 current = texture2D(uCurrent, vUv);
          vec4 leftSample = texture2D(uCurrent, vUv - vec2(uTexelSize.x, 0.0));
          vec4 rightSample = texture2D(uCurrent, vUv + vec2(uTexelSize.x, 0.0));
          vec4 downSample = texture2D(uCurrent, vUv - vec2(0.0, uTexelSize.y));
          vec4 upSample = texture2D(uCurrent, vUv + vec2(0.0, uTexelSize.y));
          vec4 neighborhoodMin = min(current, min(min(leftSample, rightSample), min(downSample, upSample)));
          vec4 neighborhoodMax = max(current, max(max(leftSample, rightSample), max(downSample, upSample)));
          vec4 range = neighborhoodMax - neighborhoodMin;
          neighborhoodMin -= range * 0.12;
          neighborhoodMax += range * 0.12;
          vec4 history = clamp(texture2D(uHistory, vUv), neighborhoodMin, neighborhoodMax);
          gl_FragColor = mix(history, current, uCurrentWeight);
        }
      `,
    });
  }

  private createCompositeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uSceneColor: { value: null },
        uCloudColor: { value: null },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uSceneColor;
        uniform sampler2D uCloudColor;
        varying vec2 vUv;

        void main() {
          vec4 sceneColor = texture2D(uSceneColor, vUv);
          vec4 cloudColor = texture2D(uCloudColor, vUv);
          gl_FragColor = vec4(mix(sceneColor.rgb, cloudColor.rgb, cloudColor.a), sceneColor.a);
          #include <colorspace_fragment>
        }
      `,
    });
  }

  private disposeTargets(): void {
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget?.dispose();
    this.cloudCurrentTarget?.dispose();
    this.historyReadTarget?.dispose();
    this.historyWriteTarget?.dispose();
    this.sceneTarget = null;
    this.cloudCurrentTarget = null;
    this.historyReadTarget = null;
    this.historyWriteTarget = null;
  }

  private createMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uCameraLocal: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uIntensity: { value: 1 },
        uDayFactor: { value: 1 },
        uSeed: { value: 0 },
        uSquall: { value: 0 },
        uStepCount: { value: 30 },
        uNoiseAtlas: { value: this.noiseAtlas },
        uJitter: { value: 0.5 },
        uSceneDepth: { value: null },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uWorldToLocal: { value: new THREE.Matrix4() },
        uLowResolution: { value: new THREE.Vector2(1, 1) },
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
        uniform float uTime;
        uniform float uOpacity;
        uniform float uIntensity;
        uniform float uDayFactor;
        uniform float uSeed;
        uniform float uSquall;
        uniform float uStepCount;
        uniform sampler2D uNoiseAtlas;
        uniform float uJitter;
        uniform sampler2D uSceneDepth;
        uniform mat4 uInvProjection, uCameraWorld, uWorldToLocal;
        uniform vec2 uLowResolution;
        varying vec3 vLocalPosition;

        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        vec4 sampleNoiseAtlas(vec3 p) {
          p = fract(p);
          float slice = p.z * 32.0;
          float z0 = floor(slice);
          float z1 = mod(z0 + 1.0, 32.0);
          float blend = fract(slice);
          vec2 localUv = (p.xy * 31.0 + 0.5) / 32.0;
          vec2 tile0 = vec2(mod(z0, 8.0), floor(z0 / 8.0));
          vec2 tile1 = vec2(mod(z1, 8.0), floor(z1 / 8.0));
          vec2 atlasSize = vec2(8.0, 4.0);
          vec4 a = texture2D(uNoiseAtlas, (tile0 + localUv) / atlasSize);
          vec4 b = texture2D(uNoiseAtlas, (tile1 + localUv) / atlasSize);
          return mix(a, b, blend);
        }

        vec2 intersectBox(vec3 ro, vec3 rd) {
          vec3 invDir = 1.0 / rd;
          vec3 lo = (-vec3(1.0) - ro) * invDir;
          vec3 hi = ( vec3(1.0) - ro) * invDir;
          vec3 nearV = min(lo, hi);
          vec3 farV = max(lo, hi);
          float nearT = max(max(nearV.x, nearV.y), nearV.z);
          float farT = min(min(farV.x, farV.y), farV.z);
          return vec2(nearT, farT);
        }

        float supercellShape(vec3 p, float h) {
          float phase = uSeed * 19.0;
          // Cisaillement : le sommet penche vers l'aval (+z) avec l'altitude.
          float shear = mix(0.0, 0.34, smoothstep(0.1, 1.0, h));
          vec2 axis = p.xz - vec2(sin(h * 4.0 + phase) * 0.04, shear);

          // Tour : base modérée, bulbe au milieu, se resserre au sommet.
          float towerRadius = mix(0.30, 0.50, smoothstep(0.0, 0.32, h));
          towerRadius = mix(towerRadius, 0.16, smoothstep(0.55, 0.95, h));
          float tower = 1.0 - smoothstep(towerRadius, towerRadius + 0.17, length(axis));
          tower *= smoothstep(0.03, 0.14, h) * (1.0 - smoothstep(0.97, 1.0, h));

          // Enclume : s'évase largement au sommet, étirée vers l'aval, aplatie.
          vec2 anvilP = vec2(axis.x * 0.80, (p.z - 0.42) * 0.62);
          float anvil = 1.0 - smoothstep(0.50, 0.95, length(anvilP));
          anvil *= smoothstep(0.72, 0.82, h) * (1.0 - smoothstep(0.96, 1.0, h));

          // Sommet bombé (overshooting top).
          float overshoot = 1.0 - smoothstep(0.10, 0.26, length(p.xz));
          overshoot *= smoothstep(0.88, 0.93, h) * (1.0 - smoothstep(0.99, 1.0, h));

          return max(tower, max(anvil, overshoot));
        }

        float squallShape(vec3 p, float h) {
          float along = 1.0 - smoothstep(0.76, 1.0, abs(p.x));
          float depth = 1.0 - smoothstep(0.24, 0.92, abs(p.z + 0.18));
          float shelf = along * depth * smoothstep(0.03, 0.10, h) * (1.0 - smoothstep(0.42, 0.68, h));
          float towers = along * (1.0 - smoothstep(0.35, 0.96, abs(p.z - 0.08)));
          towers *= smoothstep(0.10, 0.24, h) * (1.0 - smoothstep(0.88, 1.0, h));
          return max(shelf, towers * 0.78);
        }

        float densityField(vec3 p) {
          float h = p.y * 0.5 + 0.5;
          if (h <= 0.0 || h >= 1.0) return 0.0;

          float shape = mix(supercellShape(p, h), squallShape(p, h), uSquall);
          if (shape < 0.002) return 0.0;

          vec3 drift = vec3(-uTime * 0.0007, uTime * 0.00018, uTime * 0.00042);
          vec3 seedOffset = vec3(uSeed * 0.73, uSeed * 1.17, uSeed * 0.41);
          vec4 broadNoise = sampleNoiseAtlas(p * vec3(0.82, 1.08, 0.82) + drift + seedOffset);
          vec4 fineNoise = sampleNoiseAtlas(p * vec3(3.4, 4.2, 3.4) - drift * 2.0 + seedOffset * 1.9);
          float low = mix(broadNoise.r, broadNoise.b, 0.38);
          float erosion = mix(fineNoise.g, fineNoise.a, smoothstep(0.15, 0.9, h));
          float billow = shape * (0.52 + low * 0.88) - (1.0 - shape) * 0.18;
          billow -= (1.0 - erosion) * mix(0.20, 0.08, shape);

          float edgeFade = 1.0 - smoothstep(0.90, 1.0, max(abs(p.x), abs(p.z)));
          return smoothstep(0.30, 0.62, billow) * edgeFade;
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
            vec4 clipPosition = vec4(screenUv * 2.0 - 1.0, sceneDepth * 2.0 - 1.0, 1.0);
            vec4 viewPosition = uInvProjection * clipPosition;
            viewPosition /= max(0.00001, viewPosition.w);
            vec3 sceneWorld = (uCameraWorld * viewPosition).xyz;
            vec3 sceneLocal = (uWorldToLocal * vec4(sceneWorld, 1.0)).xyz;
            float sceneT = dot(sceneLocal - uCameraLocal, rayDirection);
            if (sceneT > 0.0) endT = min(endT, sceneT);
          }
          if (endT <= startT) discard;

          float stepLength = (endT - startT) / uStepCount;
          float t = startT + stepLength * uJitter;
          vec4 cloud = vec4(0.0);

          for (int i = 0; i < 40; i++) {
            if (float(i) >= uStepCount || t > endT || cloud.a > 0.965) break;
            vec3 p = uCameraLocal + rayDirection * t;
            float density = densityField(p);

            if (density > 0.002) {
              float h = p.y * 0.5 + 0.5;
              float topLight = smoothstep(0.08, 0.96, h);
              float sideLight = clamp(0.5 - p.x * 0.18 - p.z * 0.12, 0.0, 1.0);
              float lighting = 0.24 + topLight * 0.48 + sideLight * 0.18;
              lighting *= mix(0.58, 1.0, uDayFactor);

              vec3 baseColor = mix(vec3(0.12, 0.13, 0.16), vec3(0.74, 0.78, 0.85), topLight);
              vec3 sampleColor = baseColor * lighting;
              float sampleAlpha = 1.0 - exp(-density * stepLength * (2.2 + uIntensity * 1.7));
              sampleAlpha *= uOpacity;

              cloud.rgb += (1.0 - cloud.a) * sampleColor * sampleAlpha;
              cloud.a += (1.0 - cloud.a) * sampleAlpha;
            }
            t += stepLength;
          }

          if (cloud.a < 0.006) discard;
          gl_FragColor = vec4(cloud.rgb / max(cloud.a, 0.001), cloud.a);
        }
      `,
    });
  }

  private forward(event: WeatherEvent): { x: number; z: number } {
    const length = Math.hypot(event.dirX, event.dirZ);
    if (length > 1e-4) return { x: event.dirX / length, z: event.dirZ / length };
    return { x: 1, z: 0 };
  }

  private lifeFade(event: WeatherEvent): number {
    const fadeIn = THREE.MathUtils.smoothstep(event.age, 0, 10);
    const fadeOut = THREE.MathUtils.smoothstep(event.maxAge - event.age, 0, 14);
    return THREE.MathUtils.clamp(Math.min(fadeIn, fadeOut), 0, 1);
  }

  dispose(): void {
    for (const slot of this.slots) {
      this.cloudScene.remove(slot.mesh);
      slot.material.dispose();
    }
    this.screenScene.remove(this.screenQuad);
    this.screenQuad.geometry.dispose();
    this.resolveMaterial.dispose();
    this.compositeMaterial.dispose();
    this.disposeTargets();
    this.geometry.dispose();
    this.noiseAtlas.dispose();
  }
}
