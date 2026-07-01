import * as THREE from "three";
import { SquallLineEvent } from "../../weather/events/SquallLineEvent";
import { WeatherEvent } from "../../weather/events/WeatherEvent";

const MAX_STREAKS = 4800;
const MAX_DISTANCE = 7600;
const GROUND_Y = 52;

const KIND_VALUE = {
  rain: 0,
  snow: 1,
  hail: 2,
} as const;

/**
 * Distant precipitation made from a 3D field of animated streaks/flakes.
 * There is no rectangular curtain mesh, so the edge remains naturally ragged.
 */
export class RainCurtainRenderer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_STREAKS * 3);
  private readonly sizes = new Float32Array(MAX_STREAKS);
  private readonly alphas = new Float32Array(MAX_STREAKS);
  private readonly kinds = new Float32Array(MAX_STREAKS);
  private readonly seeds = new Float32Array(MAX_STREAKS);
  private readonly proximities = new Float32Array(MAX_STREAKS);
  private time = 0;
  private enabled = false;
  private lastCount = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aKind", new THREE.BufferAttribute(this.kinds, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(this.seeds, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aProximity", new THREE.BufferAttribute(this.proximities, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uTime: { value: 0 },
        uWindX: { value: 0 },
        uWindZ: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aKind;
        attribute float aSeed;
        attribute float aProximity;
        uniform float uTime;
        uniform float uWindX;
        uniform float uWindZ;
        varying float vAlpha;
        varying float vKind;
        varying float vSeed;
        varying float vShear;
        varying float vProximity;

        void main() {
          float fallSpeed = mix(26.0, 7.0, step(0.5, aKind));
          fallSpeed = mix(fallSpeed, 38.0, step(1.5, aKind));
          vec3 animated = position;
          float range = max(18.0, position.y - 48.0);
          animated.y = 48.0 + mod(position.y - 48.0 - uTime * fallSpeed * (0.75 + aSeed * 0.5), range);
          animated.x += uWindX * (position.y - animated.y) * 0.018;
          animated.z += uWindZ * (position.y - animated.y) * 0.018;

          vec4 mvPosition = modelViewMatrix * vec4(animated, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * 520.0 / max(90.0, -mvPosition.z), 1.5, 82.0);
          vAlpha = aAlpha;
          vKind = aKind;
          vSeed = aSeed;
          vShear = clamp((uWindX + uWindZ) * 0.014, -0.42, 0.42);
          vProximity = aProximity;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vKind;
        varying float vSeed;
        varying float vShear;
        varying float vProximity;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float alpha;
          vec3 color;

          if (vKind < 0.5) {
            p.x += p.y * vShear;
            float streak = 1.0 - smoothstep(0.035, 0.16, abs(p.x));
            float ends = smoothstep(1.0, 0.45, abs(p.y));
            alpha = streak * ends * vAlpha;
            color = mix(vec3(0.075, 0.10, 0.13), vec3(0.56, 0.63, 0.68), vProximity);
          } else if (vKind < 1.5) {
            float wobble = sin((p.y + vSeed) * 8.0) * 0.12;
            float flake = 1.0 - smoothstep(0.18, 0.82, length(vec2(p.x + wobble, p.y)));
            alpha = flake * vAlpha;
            color = vec3(0.90, 0.94, 1.0);
          } else if (vKind < 2.5) {
            float pellet = 1.0 - smoothstep(0.18, 0.62, length(p));
            float glint = hash(floor(gl_FragCoord.xy * 0.25) + vSeed);
            alpha = pellet * vAlpha;
            color = mix(vec3(0.68, 0.76, 0.86), vec3(0.95), glint * 0.45);
          } else {
            float mist = 1.0 - smoothstep(0.12, 1.0, length(p));
            float breakup = 0.68 + hash(floor(gl_FragCoord.xy * 0.08) + vSeed) * 0.32;
            alpha = mist * breakup * vAlpha;
            color = mix(vec3(0.09, 0.115, 0.14), vec3(0.58, 0.63, 0.66), vProximity);
          }

          if (alpha < 0.005) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
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
    this.lastCount = 0;
    this.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }

  get debugState(): { enabled: boolean; visible: boolean; drawCount: number } {
    return { enabled: this.enabled, visible: this.points.visible, drawCount: this.lastCount };
  }

  update(dt: number, events: readonly WeatherEvent[], cameraPosition: THREE.Vector3, windX: number, windZ: number): void {
    if (!this.enabled) {
      this.clear();
      return;
    }
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uWindX.value = windX;
    this.material.uniforms.uWindZ.value = windZ;

    let count = 0;
    for (const event of events) {
      if (count >= MAX_STREAKS) break;
      if (event.precip === "none") continue;

      const distance = Math.hypot(event.x - cameraPosition.x, event.z - cameraPosition.z);
      if (distance > MAX_DISTANCE) continue;

      const isSquall = event instanceof SquallLineEvent;
      const forward = this.forward(event);
      const right = { x: -forward.z, z: forward.x };
      const halfWidth = isSquall
        ? Math.min(event.length * 0.5, 2300)
        : THREE.MathUtils.clamp(event.radius * 0.92, 300, 980);
      const halfDepth = isSquall
        ? Math.min(event.thickness * 0.58, 520)
        : THREE.MathUtils.clamp(event.radius * 0.52, 220, 620);
      const leadingOffset = isSquall ? event.thickness * 0.12 : event.radius * 0.18;
      const farFade = 1 - THREE.MathUtils.smoothstep(distance, 5800, MAX_DISTANCE);
      const life = this.lifeFade(event);
      const proximity = 1 - THREE.MathUtils.smoothstep(distance, event.radius * 0.3, event.radius * 1.15);
      const desired = Math.round((isSquall ? 1800 : 1400) * event.intensity * farFade);

      for (let i = 0; i < desired && count < MAX_STREAKS; i += 1) {
        const acrossN = this.rand(event, i, 1) * 2 - 1;
        const depthN = this.rand(event, i, 2) * 2 - 1;
        const edge = Math.max(Math.abs(acrossN), Math.abs(depthN));
        if (this.rand(event, i, 3) < THREE.MathUtils.smoothstep(edge, 0.55, 1)) continue;

        const across = acrossN * halfWidth;
        const depth = depthN * halfDepth;
        const top = event.cloudBaseY + this.rand(event, i, 4) * 16;
        const y = THREE.MathUtils.lerp(GROUND_Y + 4, top, this.rand(event, i, 5));
        const x = event.x + forward.x * (leadingOffset + depth) + right.x * across;
        const z = event.z + forward.z * (leadingOffset + depth) + right.z * across;
        const p = count * 3;

        this.positions[p] = x;
        this.positions[p + 1] = y;
        this.positions[p + 2] = z;
        this.sizes[count] =
          event.precip === "rain"
            ? 3.5 + this.rand(event, i, 6) * 5.5
            : event.precip === "snow"
              ? 2.8 + this.rand(event, i, 6) * 4
              : 2 + this.rand(event, i, 6) * 3;
        this.alphas[count] = life * event.intensity * farFade * (0.16 + this.rand(event, i, 7) * 0.22);
        this.kinds[count] = KIND_VALUE[event.precip];
        this.seeds[count] = this.rand(event, i, 8);
        this.proximities[count] = proximity;
        count += 1;
      }

      // Broad low-alpha precipitation haze. It is optically dark from outside
      // and becomes a lighter grey veil once the observer enters the core.
      const hazeCount = Math.round((isSquall ? 180 : 120) * event.intensity * farFade);
      for (let i = 0; i < hazeCount && count < MAX_STREAKS; i += 1) {
        const across = (this.rand(event, i, 21) * 2 - 1) * halfWidth;
        const depth = (this.rand(event, i, 22) * 2 - 1) * halfDepth;
        const top = event.cloudBaseY + 10;
        const p = count * 3;
        this.positions[p] = event.x + forward.x * (leadingOffset + depth) + right.x * across;
        this.positions[p + 1] = THREE.MathUtils.lerp(GROUND_Y + 8, top, this.rand(event, i, 23));
        this.positions[p + 2] = event.z + forward.z * (leadingOffset + depth) + right.z * across;
        this.sizes[count] = 60 + this.rand(event, i, 24) * 85;
        this.alphas[count] = life * event.intensity * farFade * (0.025 + this.rand(event, i, 25) * 0.035);
        this.kinds[count] = 3;
        this.seeds[count] = this.rand(event, i, 26);
        this.proximities[count] = proximity;
        count += 1;
      }
    }

    this.geometry.setDrawRange(0, count);
    this.points.visible = count > 0;
    this.lastCount = count;
    for (const key of ["position", "aSize", "aAlpha", "aKind", "aSeed", "aProximity"]) {
      this.geometry.getAttribute(key).needsUpdate = true;
    }
  }

  private forward(event: WeatherEvent): { x: number; z: number } {
    const length = Math.hypot(event.dirX, event.dirZ);
    if (length > 1e-4) return { x: event.dirX / length, z: event.dirZ / length };
    return { x: 1, z: 0 };
  }

  private lifeFade(event: WeatherEvent): number {
    const fadeIn = THREE.MathUtils.smoothstep(event.age, 0, 8);
    const fadeOut = THREE.MathUtils.smoothstep(event.maxAge - event.age, 0, 12);
    return THREE.MathUtils.clamp(Math.min(fadeIn, fadeOut), 0, 1);
  }

  private rand(event: WeatherEvent, index: number, salt: number): number {
    const value = Math.sin(event.id * 19.19 + index * 61.71 + salt * 11.13) * 43758.5453;
    return value - Math.floor(value);
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
