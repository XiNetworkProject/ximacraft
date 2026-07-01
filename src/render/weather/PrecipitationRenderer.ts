import * as THREE from "three";
import { PrecipKind, WeatherSample } from "../../weather/WeatherTypes";
import {
  PrecipitationLighting,
  precipitationColor,
  precipitationOpacity,
} from "./PrecipitationLightModel";
import { PrecipitationKind, PrecipitationState } from "../../weather/scene/WeatherScene";

type PrecipVisualKind = "none" | "drizzle" | "rain" | "snow" | "hail" | "sleet" | "dust";

const RAIN_SEGMENTS = 20000;
const SNOW_POINTS = 16000;
const AREA = 42;
const HEIGHT = 56;

/** Dense, camera-centred precipitation animated entirely on the GPU. */
export class PrecipitationRenderer {
  private readonly rainGeometry = new THREE.BufferGeometry();
  private readonly rainMaterial: THREE.ShaderMaterial;
  private readonly rainLines: THREE.LineSegments;
  private readonly flakeGeometry = new THREE.BufferGeometry();
  private readonly flakeMaterial: THREE.ShaderMaterial;
  private readonly flakes: THREE.Points;
  private readonly flakeTexture = this.createFlakeTexture();
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.buildRainGeometry();
    this.rainMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2() },
        uFall: { value: 78 },
        uLength: { value: 1 },
        uArea: { value: AREA },
        uHeight: { value: HEIGHT },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0x9fb3c2) },
      },
      vertexShader: `
        attribute float aEnd;
        attribute float aSpeed;
        uniform float uTime;
        uniform vec2 uWind;
        uniform float uFall;
        uniform float uLength;
        uniform float uArea;
        uniform float uHeight;
        varying float vRainAlpha;
        void main() {
          float travel = uTime * uFall * aSpeed;
          vec3 p = position;
          p.y = mod(position.y - travel, uHeight);
          p.x = mod(position.x + uTime * uWind.x + uArea, uArea * 2.0) - uArea;
          p.z = mod(position.z + uTime * uWind.y + uArea, uArea * 2.0) - uArea;
          if (aEnd > 0.5) {
            p.x -= uWind.x * uLength * 0.035;
            p.y -= uLength;
            p.z -= uWind.y * uLength * 0.035;
          }
          vRainAlpha = mix(0.45, 1.18, fract(aSpeed * 17.37 + position.x * 0.013 + position.z * 0.019));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vRainAlpha;
        void main() { gl_FragColor = vec4(uColor, uOpacity * vRainAlpha); }
      `,
    });
    this.rainLines = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.rainLines.renderOrder = 4;
    scene.add(this.rainLines);

    this.buildFlakeGeometry();
    this.flakeMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      alphaTest: 0.025,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2() },
        uFall: { value: 6 },
        uArea: { value: AREA },
        uHeight: { value: HEIGHT },
        uSize: { value: 1.65 },
        uSway: { value: 1 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0xdce6ed) },
        uMap: { value: this.flakeTexture },
        uHail: { value: 0 },
        uDust: { value: 0 },
      },
      vertexShader: `
        attribute float aSpeed;
        attribute float aPhase;
        attribute float aAmp;
        attribute float aSize;
        uniform float uTime;
        uniform vec2 uWind;
        uniform float uFall;
        uniform float uArea;
        uniform float uHeight;
        uniform float uSize;
        uniform float uSway;
        varying float vFade;
        void main() {
          vec3 p = position;
          float t = uTime;
          p.y = mod(position.y - t * uFall * aSpeed, uHeight);
          // Virevoltement : 2 fréquences par flocon → tumbling irrégulier.
          float amp = aAmp * uSway;
          float swayX = sin(t * 1.3 + aPhase) * amp + sin(t * 0.55 + aPhase * 2.3) * amp * 0.5;
          float swayZ = cos(t * 1.05 + aPhase * 1.7) * amp * 0.85 + cos(t * 0.5 + aPhase) * amp * 0.4;
          p.x = mod(position.x + t * uWind.x + swayX + uArea, uArea * 2.0) - uArea;
          p.z = mod(position.z + t * uWind.y + swayZ + uArea, uArea * 2.0) - uArea;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(uSize * aSize * 92.0 / max(24.0, -mv.z), 0.45, 3.6);
          // Variation lente d'orientation, sans scintillement blanc lumineux.
          vFade = 0.78 + 0.12 * sin(t * 1.25 + aPhase * 2.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uHail;
        uniform float uDust;
        varying float vFade;
        void main() {
          vec2 centered = gl_PointCoord * 2.0 - 1.0;
          float hailAlpha = 1.0 - smoothstep(0.48, 1.0, length(centered));
          float textureSnow = texture2D(uMap, gl_PointCoord).a;
          float radius = length(centered);
          float core = 1.0 - smoothstep(0.08, 0.34, radius);
          float armA = 1.0 - smoothstep(0.055, 0.15, abs(centered.x));
          float armB = 1.0 - smoothstep(0.055, 0.15, abs(centered.x * 0.5 + centered.y * 0.866));
          float armC = 1.0 - smoothstep(0.055, 0.15, abs(centered.x * 0.5 - centered.y * 0.866));
          float snowAlpha = max(textureSnow, max(core, max(armA, max(armB, armC)) * (1.0 - smoothstep(0.35, 0.92, radius))));
          float dustAlpha = (1.0 - smoothstep(0.05, 1.0, length(centered))) * 0.48;
          float solidAlpha = mix(snowAlpha, hailAlpha, uHail);
          float alpha = mix(solidAlpha, dustAlpha, uDust) * uOpacity * vFade;
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });
    this.flakes = new THREE.Points(this.flakeGeometry, this.flakeMaterial);
    this.flakes.frustumCulled = false;
    this.flakes.visible = false;
    this.flakes.renderOrder = 4;
    scene.add(this.flakes);
  }

  get debugState(): { rain: boolean; flakes: boolean; drawCount: number; opacity: number } {
    return {
      rain: this.rainLines.visible,
      flakes: this.flakes.visible,
      drawCount: this.flakeGeometry.drawRange.count,
      opacity: Number(this.flakeMaterial.uniforms.uOpacity.value),
    };
  }

  update(
    delta: number,
    sample: WeatherSample,
    cameraPosition: THREE.Vector3,
    enabled = true,
    forced: Readonly<{ kind: PrecipKind; intensity: number }> | null = null,
    lighting: PrecipitationLighting = { dayFactor: 1, lightning: 0 },
    scenePrecip: Readonly<PrecipitationState> | null = null,
  ): void {
    this.time += delta;
    const sceneVisible = scenePrecip && (scenePrecip.reachesGround || scenePrecip.kind === PrecipitationKind.DUST || scenePrecip.kind === PrecipitationKind.SAND);
    const kind = enabled ? (forced?.kind ?? (sceneVisible ? this.kindForScene(scenePrecip) : this.kindFor(sample))) : "none";
    const intensity = THREE.MathUtils.clamp(Math.max(
      sample.precipitation,
      forced?.intensity ?? 0,
      sceneVisible ? scenePrecip.intensity : 0,
    ), 0, 1);
    this.updateRain(kind, intensity, sample, cameraPosition, lighting);
    this.updateFlakes(kind, intensity, sample, cameraPosition, lighting);
  }

  private updateRain(kind: PrecipVisualKind, intensity: number, sample: WeatherSample, camera: THREE.Vector3, lighting: PrecipitationLighting): void {
    const active = (kind === "rain" || kind === "drizzle" || kind === "sleet") && intensity > 0.02;
    this.rainLines.visible = active;
    if (!active) return;
    this.rainLines.position.set(camera.x, camera.y - 10, camera.z);
    this.rainGeometry.setDrawRange(0, Math.floor(RAIN_SEGMENTS * (0.32 + intensity * 0.68)) * 2);
    this.rainMaterial.uniforms.uTime.value = this.time;
    this.rainMaterial.uniforms.uWind.value.set(sample.windX * 0.1, sample.windZ * 0.1);
    const drizzle = kind === "drizzle";
    const sleet = kind === "sleet";
    this.rainMaterial.uniforms.uFall.value = drizzle ? 26 + intensity * 36 : sleet ? 42 + intensity * 54 : 52 + intensity * 88;
    this.rainMaterial.uniforms.uLength.value = drizzle ? 0.16 + intensity * 0.38 : sleet ? 0.28 + intensity * 0.75 : 0.42 + intensity * 2.05;
    this.rainMaterial.uniforms.uOpacity.value = precipitationOpacity("rain", intensity * (drizzle ? 0.58 : 1), lighting);
    precipitationColor("rain", lighting, this.rainMaterial.uniforms.uColor.value as THREE.Color);
  }

  private updateFlakes(kind: PrecipVisualKind, intensity: number, sample: WeatherSample, camera: THREE.Vector3, lighting: PrecipitationLighting): void {
    const active = (kind === "snow" || kind === "hail" || kind === "sleet" || kind === "dust") && intensity > 0.02;
    this.flakes.visible = active;
    if (!active) return;
    const hail = kind === "hail";
    const dust = kind === "dust";
    const sleet = kind === "sleet";
    this.flakes.position.set(camera.x, camera.y - 8, camera.z);
    this.flakeGeometry.setDrawRange(0, Math.floor(SNOW_POINTS * (0.34 + intensity * 0.66)));
    this.flakeMaterial.uniforms.uTime.value = this.time;
    this.flakeMaterial.uniforms.uWind.value.set(sample.windX * (dust ? 0.5 : hail || sleet ? 0.09 : 0.18), sample.windZ * (dust ? 0.5 : hail || sleet ? 0.09 : 0.18));
    this.flakeMaterial.uniforms.uFall.value = dust ? 0.5 : hail ? 28 + intensity * 44 : sleet ? 18 + intensity * 28 : 3.0 + intensity * 7.5;
    this.flakeMaterial.uniforms.uSize.value = dust ? 3 + intensity * 4 : hail || sleet ? 0.82 + intensity * 0.36 : 0.54 + intensity * 0.54;
    // Grêle = chute droite (peu de virevoltement) ; neige = forte turbulence.
    this.flakeMaterial.uniforms.uSway.value = dust ? 2.4 : hail || sleet ? 0.12 : 1.0;
    this.flakeMaterial.uniforms.uHail.value = hail || sleet ? 1 : 0;
    this.flakeMaterial.uniforms.uDust.value = dust ? 1 : 0;
    this.flakeMaterial.uniforms.uOpacity.value = dust
      ? 0.12 + intensity * 0.24
      : precipitationOpacity(hail || sleet ? "hail" : "snow", intensity, lighting);
    if (dust) (this.flakeMaterial.uniforms.uColor.value as THREE.Color).set(0x9b7b57);
    else precipitationColor(hail || sleet ? "hail" : "snow", lighting, this.flakeMaterial.uniforms.uColor.value as THREE.Color);
  }

  private buildRainGeometry(): void {
    const positions = new Float32Array(RAIN_SEGMENTS * 6);
    const ends = new Float32Array(RAIN_SEGMENTS * 2);
    const speeds = new Float32Array(RAIN_SEGMENTS * 2);
    for (let i = 0; i < RAIN_SEGMENTS; i += 1) {
      const x = (Math.random() - 0.5) * AREA * 2;
      const y = Math.random() * HEIGHT;
      const z = (Math.random() - 0.5) * AREA * 2;
      const speed = 0.72 + Math.random() * 0.38;
      positions.set([x, y, z, x, y, z], i * 6);
      ends[i * 2 + 1] = 1;
      speeds[i * 2] = speeds[i * 2 + 1] = speed;
    }
    this.rainGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.rainGeometry.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));
    this.rainGeometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  }

  private buildFlakeGeometry(): void {
    const positions = new Float32Array(SNOW_POINTS * 3);
    const speeds = new Float32Array(SNOW_POINTS);
    const phases = new Float32Array(SNOW_POINTS);
    const amps = new Float32Array(SNOW_POINTS);
    const sizes = new Float32Array(SNOW_POINTS);
    for (let i = 0; i < SNOW_POINTS; i += 1) {
      positions.set([(Math.random() - 0.5) * AREA * 2, Math.random() * HEIGHT, (Math.random() - 0.5) * AREA * 2], i * 3);
      speeds[i] = 0.6 + Math.random() * 0.55;
      phases[i] = Math.random() * Math.PI * 2;
      amps[i] = 0.35 + Math.random() * 1.35;
      sizes[i] = 0.38 + Math.random() * 0.62;
    }
    this.flakeGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.flakeGeometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    this.flakeGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    this.flakeGeometry.setAttribute("aAmp", new THREE.BufferAttribute(amps, 1));
    this.flakeGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  }

  private kindFor(sample: WeatherSample): PrecipVisualKind {
    if (sample.precipitation < 0.03) return "none";
    if (sample.temperature <= 1.2) return "snow";
    if (sample.thunderRisk > 0.58 && sample.precipitation > 0.52 && sample.temperature < 18) return "hail";
    return "rain";
  }

  private kindForScene(precip: Readonly<PrecipitationState>): PrecipVisualKind {
    switch (precip.kind) {
      case PrecipitationKind.NONE:
        return "none";
      case PrecipitationKind.DRIZZLE:
        return "drizzle";
      case PrecipitationKind.SNOW_FLURRIES:
      case PrecipitationKind.LIGHT_SNOW:
      case PrecipitationKind.STEADY_SNOW:
      case PrecipitationKind.SNOW_SHOWER:
      case PrecipitationKind.SNOW_SQUALL:
      case PrecipitationKind.BLOWING_SNOW:
        return "snow";
      case PrecipitationKind.HAIL:
      case PrecipitationKind.GRAUPEL:
        return "hail";
      case PrecipitationKind.SLEET:
      case PrecipitationKind.FREEZING_RAIN:
        return "sleet";
      case PrecipitationKind.DUST:
      case PrecipitationKind.SAND:
        return "dust";
      default:
        return "rain";
    }
  }

  private createFlakeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(32, 32);
    ctx.strokeStyle = "rgba(214,224,232,0.78)";
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";
    for (let arm = 0; arm < 6; arm += 1) {
      ctx.save();
      ctx.rotate((arm * Math.PI) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -25);
      ctx.moveTo(0, -13);
      ctx.lineTo(-6, -18);
      ctx.moveTo(0, -13);
      ctx.lineTo(6, -18);
      ctx.moveTo(0, -20);
      ctx.lineTo(-4.5, -23.5);
      ctx.moveTo(0, -20);
      ctx.lineTo(4.5, -23.5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = "rgba(214,224,232,0.74)";
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  dispose(): void {
    this.scene.remove(this.rainLines, this.flakes);
    this.rainGeometry.dispose();
    this.flakeGeometry.dispose();
    this.rainMaterial.dispose();
    this.flakeMaterial.dispose();
    this.flakeTexture.dispose();
  }
}
