import * as THREE from "three";
import { WORLD_DAY_TICKS } from "../utils/Constants";
import { clamp, lerp } from "../utils/MathUtils";
import { Renderer } from "../game/Renderer";
import { Time } from "../game/Time";
import { Player } from "../player/Player";
import { CloudRenderer } from "../render/weather/CloudRenderer";
import { WeatherSystem } from "./WeatherSystem";
import { World } from "./World";
import { WeatherSample } from "../weather/WeatherTypes";
import { deriveCloudLayerState } from "../weather/sky/CloudLayerState";
import { CloudLayerType, WeatherSceneState } from "../weather/scene/WeatherScene";
import { VisibilityController } from "../weather/visibility/VisibilityController";

export class SkySystem {
  readonly clouds: CloudRenderer;
  /** Échantillon du moteur météo régional sous le joueur (injecté par Game). */
  weatherSample: WeatherSample | null = null;
  /** Multi-axis scene supplied by the scenario director. */
  weatherScene: WeatherSceneState | null = null;
  /** Direction monde→soleil normalisée du dernier frame (ombres de nuages). */
  readonly sunDirection = new THREE.Vector3(0, 1, 0);
  private readonly skyDome: THREE.Mesh;
  private readonly stars: THREE.Points;
  private starsMaterial!: THREE.ShaderMaterial;
  private starTime = 0;
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly visibilityController = new VisibilityController();
  private cloudShadeTime = 0;

  constructor(private readonly renderer: Renderer) {
    this.skyDome = this.createSkyDome();
    this.stars = this.createStars();
    this.sun = this.createDisc(0xfff2a6, 64);
    this.moon = this.createDisc(0xd9e7ff, 48);
    this.renderer.scene.add(this.skyDome, this.stars, this.sun, this.moon);
    this.clouds = new CloudRenderer(this.renderer.scene);
  }

  updateWithWorld(delta: number, time: Time, weather: WeatherSystem, player: Player, world: World): number {
    const cameraPosition = this.renderer.camera.position;
    const phase = time.ticks / WORLD_DAY_TICKS;
    const angle = phase * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    // Transition jour/nuit FRANCHE : plein jour dès ~9° d'élévation (sinon le
    // monde reste « à moitié nuit » et les étoiles persistent quand le soleil
    // est déjà levé). Reste 0 quand le soleil est sous l'horizon (vraie nuit).
    const dayFactor = THREE.MathUtils.smoothstep(sunHeight, -0.08, 0.16);
    const dawnFactor = Math.max(0, 1 - Math.abs(sunHeight) * 7) * (phase < 0.5 ? 1 : 0.8);
    const visuals = weather.update(delta, player, world, dayFactor);
    // Couverture combinée : météo legacy OU moteur régional (le plus couvert
    // gagne), pour que `/weather rain` (legacy) et `/weather set cloudy`
    // (moteur) fassent tous deux apparaître les nuages de façon cohérente.
    const sample = this.weatherSample;
    const layers = sample ? deriveCloudLayerState(sample) : null;
    const stratiformCover = layers?.stratiformCover ?? visuals.cloudDensity;
    const sceneState = this.weatherScene;
    const sceneHighCover = sceneState ? this.layerCoverage(sceneState, new Set([
      CloudLayerType.CIRRUS,
      CloudLayerType.CIRROSTRATUS,
    ])) : 0;
    // Fond de cirrus de beau temps : un ciel humide a souvent des voiles hauts
    // fibreux, même sans nuages bas. Disparaît si l'air est sec / ciel couvert.
    const humid = sample ? clamp((sample.humidity - 0.42) / 0.4, 0, 1) : 0;
    const fairCirrus = humid * humid * (3 - 2 * humid) * (1 - stratiformCover) * 0.3;
    const highCover = Math.max(sceneHighCover, fairCirrus);
    const midCover = sceneState ? this.layerCoverage(sceneState, new Set([
      CloudLayerType.ALTOCUMULUS,
      CloudLayerType.ALTOSTRATUS,
    ])) : 0;
    const lowCover = sceneState ? this.layerCoverage(sceneState, new Set([
      CloudLayerType.STRATUS,
      CloudLayerType.STRATOCUMULUS,
      CloudLayerType.NIMBOSTRATUS,
    ])) : stratiformCover;
    const totalCover = Math.max(
      sample?.cloudCover ?? visuals.cloudDensity,
      visuals.cloudDensity,
      stratiformCover,
      highCover * 0.72,
      midCover * 0.92,
      lowCover,
    );
    const sunDir = new THREE.Vector3(Math.cos(angle) * 280, sunHeight * 280, -120);
    const sunDirNormalized = sunDir.clone().normalize();
    this.cloudShadeTime += delta;

    this.skyDome.position.copy(cameraPosition);
    this.stars.position.copy(cameraPosition);
    this.rainbowFollow(cameraPosition, weather, sunDirNormalized);

    const nightTop = new THREE.Color(0x061126);
    const dayTop = new THREE.Color(0x55a9f7);
    const nightHorizon = new THREE.Color(0x101b2d);
    const dayHorizon = new THREE.Color(0xc4e5ff);
    const top = nightTop.clone().lerp(dayTop, dayFactor);
    const horizon = nightHorizon.clone().lerp(dayHorizon, dayFactor);
    const sunset = new THREE.Color(0xffa35f);
    const violet = new THREE.Color(0x6f7fd8);
    horizon.lerp(sunset, dawnFactor * 0.62);
    top.lerp(violet, dawnFactor * 0.18);
    top.lerp(new THREE.Color(0x171d24), visuals.stormDarkening * 0.76);
    horizon.lerp(new THREE.Color(0x313944), visuals.stormDarkening * 0.64);
    top.lerp(new THREE.Color(0xe6f0ff), visuals.lightningFlash * 0.45);

    const precipitation = sample?.precipitation ?? 0;
    const frozenPrecipitation = sample !== null && sample !== undefined && sample.temperature <= 1.2;
    // Voile de précipitation SOMBRE et dépendant du jour/nuit : un ciel d'orage
    // est gris-bleu foncé (pas blanc) et carrément sombre la nuit → les éclairs
    // ressortent. La neige diffuse un peu plus de lumière le jour.
    const dayHaze = new THREE.Color(frozenPrecipitation ? 0x6f7c88 : 0x52606c);
    const nightHaze = new THREE.Color(frozenPrecipitation ? 0x0b111a : 0x090f16);
    const precipitationHaze = nightHaze.lerp(dayHaze, dayFactor);
    horizon.lerp(precipitationHaze, precipitation * (frozenPrecipitation ? 0.6 : 0.72));
    top.lerp(precipitationHaze, precipitation * (frozenPrecipitation ? 0.4 : 0.55));

    const legacyVisibilityLoss = Math.max(
      Math.pow(1 - visuals.visibility, 1.2),
      precipitation * (frozenPrecipitation ? 0.9 : 0.72),
    );
    const resolvedVisibility = sceneState
      ? this.visibilityController.resolve(sceneState, legacyVisibilityLoss)
      : null;
    const visibilityLoss = resolvedVisibility?.loss ?? legacyVisibilityLoss;
    if (sceneState?.visibility.haze) {
      const hazeColor = sceneState.skyState === "SANDSTORM_SKY" || sceneState.skyState === "DUST_HAZE"
        ? new THREE.Color(0x8f7658)
        : new THREE.Color(0x78818a);
      horizon.lerp(hazeColor, sceneState.visibility.haze * 0.58);
      top.lerp(hazeColor, sceneState.visibility.haze * 0.24);
    }
    const material = this.skyDome.material as THREE.ShaderMaterial;
    material.uniforms.topColor.value.copy(top);
    material.uniforms.horizonColor.value.copy(horizon);
    const fogNear = resolvedVisibility?.fogNear ?? lerp(220, 18, visibilityLoss);
    const fogFar = resolvedVisibility?.fogFar ?? lerp(1800, frozenPrecipitation ? 82 : 170, visibilityLoss);
    this.renderer.scene.fog = new THREE.Fog(horizon, fogNear, fogFar);
    this.renderer.scene.background = top;

    const sunOcclusion = this.estimateSunOcclusion(
      cameraPosition,
      sunDirNormalized,
      sample,
      lowCover,
      midCover,
      highCover,
      totalCover,
      visuals.stormDarkening,
      precipitation,
    );
    const sunVisibility = 1 - sunOcclusion;

    // Soleil de plein jour légèrement chaud (pas blanc pur) → rendu ensoleillé.
    const warmLight = new THREE.Color(0xffeec0).lerp(new THREE.Color(0xfff6ea), dayFactor);
    warmLight.lerp(new THREE.Color(0xffb36b), dawnFactor * 0.5);
    this.renderer.sunLight.color.copy(warmLight);
    this.renderer.hemisphereLight.color.copy(top.clone().lerp(new THREE.Color(0xffffff), 0.28));
    this.renderer.hemisphereLight.groundColor.set(dayFactor > 0.25 ? 0x43512d : 0x182033);
    // Avec les ombres réelles, le soleil est plus marqué et le ciel (ambient +
    // hémisphère) sert de remplissage doux dans les zones d'ombre. Remplissage
    // remonté pour que le monde ne soit jamais écrasé en noir, avec une nuit
    // lunaire bleutée (jamais totalement noire). Les nuages adoucissent le soleil.
    this.renderer.ambientLight.intensity = lerp(0.3, 1.02, dayFactor) * (1 - visuals.stormDarkening * 0.28) + dayFactor * totalCover * 0.08 + visuals.lightningFlash * 0.34;
    this.renderer.hemisphereLight.intensity = lerp(0.5, 1.78, dayFactor) * (1 - visuals.stormDarkening * 0.34) * (1 - sunOcclusion * 0.08);
    this.renderer.sunLight.intensity = lerp(0.04, 4.15, dayFactor) * (1 - visuals.stormDarkening * 0.58) * (1 - totalCover * 0.16) * sunVisibility + visuals.lightningFlash * 0.72;
    this.renderer.moonLight.intensity = lerp(0.42, 0.02, dayFactor) * (1 - totalCover * 0.45);

    // La caméra d'ombre suit le joueur (sinon les ombres restent figées près de
    // l'origine du monde). La direction joueur→soleil = sunDir normalisé.
    this.sunDirection.copy(sunDir).normalize();
    this.renderer.updateSunShadow(cameraPosition, this.sunDirection);
    // Halo solaire de Mie (ciel) : couleur chaude au lever/coucher, intensité
    // qui suit le jour et s'éteint la nuit / sous une forte couverture.
    const skyMaterial = this.skyDome.material as THREE.ShaderMaterial;
    skyMaterial.uniforms.sunDirection.value.copy(this.sunDirection);
    (skyMaterial.uniforms.sunGlowColor.value as THREE.Color)
      .setHex(0xfff4dc)
      .lerp(new THREE.Color(0xff9a45), dawnFactor * 0.85);
    const sunGlowStrength =
      (dayFactor * 0.96 + dawnFactor * 0.58) * (1 - totalCover * 0.42) * (1 - visuals.stormDarkening * 0.55) * sunVisibility;
    skyMaterial.uniforms.sunGlowStrength.value = sunGlowStrength;
    // Alimente les god rays (post-traitement) : direction + intensité du soleil.
    this.renderer.setPostSun(this.sunDirection, Math.max(0, sunGlowStrength));
    this.sun.position.copy(cameraPosition).add(sunDir);
    this.sun.material.opacity = clamp(dayFactor * 1.35 - totalCover * 0.62 - sunOcclusion * 0.92, 0, 1);
    this.sun.scale.setScalar(22);

    const moonDir = sunDir.clone().multiplyScalar(-1);
    this.renderer.moonLight.position.copy(moonDir);
    this.moon.position.copy(cameraPosition).add(moonDir);
    this.moon.material.opacity = clamp((1 - dayFactor) * 1.12 - totalCover * 0.62, 0, 1);
    this.moon.scale.setScalar(20);
    // Halo de lune dans le ciel : seulement la nuit, quand la lune est levée.
    const moonDirN = moonDir.clone().normalize();
    skyMaterial.uniforms.moonDirection.value.copy(moonDirN);
    skyMaterial.uniforms.moonGlowStrength.value =
      Math.max(0, 1 - dayFactor) * Math.max(0, moonDirN.y) * (1 - totalCover * 0.6);

    this.starTime += delta;
    this.starsMaterial.uniforms.uTime.value = this.starTime;
    this.starsMaterial.uniforms.uOpacity.value = clamp(Math.pow(1 - dayFactor, 1.35) * (1 - totalCover * 0.88), 0, 1);

    this.clouds.update(delta, {
      cameraPosition,
      sunDirection: sunDir,
      dayFactor,
      dawnFactor,
      stratiformCover,
      highCover,
      midCover,
      lowCover,
      windX: sample ? sample.windX : visuals.wind * 4,
      windZ: sample ? sample.windZ : 0,
      darkening: Math.max(visuals.stormDarkening, (sample?.precipitation ?? 0) * 0.5),
    });
    return dayFactor;
  }

  private layerCoverage(scene: WeatherSceneState, types: ReadonlySet<CloudLayerType>): number {
    let uncovered = 1;
    for (const layer of scene.cloudLayers) {
      if (types.has(layer.type)) uncovered *= 1 - clamp(layer.coverage * layer.opacity, 0, 1);
    }
    return 1 - uncovered;
  }

  private estimateSunOcclusion(
    cameraPosition: THREE.Vector3,
    sunDirection: THREE.Vector3,
    sample: WeatherSample | null,
    lowCover: number,
    midCover: number,
    highCover: number,
    totalCover: number,
    stormDarkening: number,
    precipitation: number,
  ): number {
    if (sunDirection.y <= 0.035) return 0;
    const windX = sample?.windX ?? 0;
    const windZ = sample?.windZ ?? 0;
    const low = this.layerSunShade(cameraPosition, sunDirection, 310, lowCover, 0.0023, windX, windZ, 0.56);
    const mid = this.layerSunShade(cameraPosition, sunDirection, 620, midCover, 0.00145, windX * 0.72, windZ * 0.72, 0.42);
    const high = this.layerSunShade(cameraPosition, sunDirection, 920, highCover, 0.00082, windX * 0.42, windZ * 0.42, 0.2);
    const overcast = Math.max(totalCover - 0.72, 0) * 0.52;
    const weatherVeil = Math.max(stormDarkening * 0.42, precipitation * 0.22);
    return clamp(Math.max(low, mid, high, overcast, weatherVeil), 0, 0.92);
  }

  private layerSunShade(
    cameraPosition: THREE.Vector3,
    sunDirection: THREE.Vector3,
    layerHeight: number,
    cover: number,
    scale: number,
    windX: number,
    windZ: number,
    strength: number,
  ): number {
    if (cover <= 0.015) return 0;
    const travel = Math.max(0, (layerHeight - cameraPosition.y) / Math.max(0.08, sunDirection.y));
    const x = cameraPosition.x + sunDirection.x * travel + windX * this.cloudShadeTime * 0.34;
    const z = cameraPosition.z + sunDirection.z * travel + windZ * this.cloudShadeTime * 0.34;
    const qx = x * scale + this.cloudShadeTime * 0.009;
    const qz = z * scale - this.cloudShadeTime * 0.006;
    const broad = this.fbm2(qx, qz);
    const cells = this.fbm2(qx * 2.75 + 19.1, qz * 2.75 - 7.4);
    const density = broad * 0.68 + cells * 0.32;
    const edge = 0.74 - cover * 0.5;
    const shade = this.smooth01((density - edge) / Math.max(0.08, 0.22 + cover * 0.06));
    return shade * cover * strength;
  }

  private fbm2(x: number, z: number): number {
    let value = 0;
    let amplitude = 0.55;
    let frequency = 1;
    for (let i = 0; i < 4; i += 1) {
      value += this.valueNoise2(x * frequency, z * frequency) * amplitude;
      frequency *= 2.04;
      amplitude *= 0.5;
    }
    return value;
  }

  private valueNoise2(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = this.hash2(ix, iz);
    const b = this.hash2(ix + 1, iz);
    const c = this.hash2(ix, iz + 1);
    const d = this.hash2(ix + 1, iz + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
  }

  private hash2(x: number, z: number): number {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }

  private smooth01(value: number): number {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  dispose(): void {
    this.skyDome.geometry.dispose();
    (this.skyDome.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.clouds.dispose();
  }

  private rainbowFollow(cameraPosition: THREE.Vector3, weather: WeatherSystem, sunDirection: THREE.Vector3): void {
    weather.rainbowGroup.position.copy(cameraPosition);
    weather.setRainbowPose(sunDirection.clone().multiplyScalar(-1), Math.max(0, sunDirection.y));
  }

  private createSkyDome(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(1500, 48, 24);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3d8edc) },
        horizonColor: { value: new THREE.Color(0xa8d5ff) },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        sunGlowColor: { value: new THREE.Color(0xfff2d2) },
        sunGlowStrength: { value: 1 },
        moonDirection: { value: new THREE.Vector3(0, -1, 0) },
        moonGlowColor: { value: new THREE.Color(0xbcd0ff) },
        moonGlowStrength: { value: 0 },
      },
      vertexShader: `
        varying vec3 vSkyDirection;
        void main() {
          vSkyDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunDirection;
        uniform vec3 sunGlowColor;
        uniform float sunGlowStrength;
        uniform vec3 moonDirection;
        uniform vec3 moonGlowColor;
        uniform float moonGlowStrength;
        varying vec3 vSkyDirection;
        void main() {
          vec3 dir = normalize(vSkyDirection);
          float h = dir.y;
          // Gradient vertical de base (assombrissement Rayleigh vers le zénith).
          float t = smoothstep(-0.12, 0.86, h);
          vec3 color = mix(horizonColor, topColor, t);
          color += vec3(0.03, 0.045, 0.07) * smoothstep(0.82, 1.0, h);

          // Diffusion de Mie autour du soleil : glow doux MODÉRÉ + cœur SERRÉ
          // (sinon le soleil devient un énorme disque blanc cramé).
          float cosSun = max(dot(dir, normalize(sunDirection)), 0.0);
          float sunHalo = pow(cosSun, 9.0) * 0.30 + pow(cosSun, 220.0) * 0.55;
          color += sunGlowColor * sunHalo * sunGlowStrength;

          // Réchauffement de l'horizon vers l'azimut du soleil — UNIQUEMENT au
          // lever/coucher (soleil bas). En plein jour il n'y a aucun halo
          // d'horizon (sinon une tache fixe reste vers l'azimut du soleil).
          float lowSun = 1.0 - smoothstep(0.02, 0.22, sunDirection.y);
          float horizonBand = 1.0 - smoothstep(0.0, 0.32, abs(h));
          vec2 dirAz = normalize(dir.xz + vec2(1e-5));
          vec2 sunAz = normalize(sunDirection.xz + vec2(1e-5));
          float azimuth = max(dot(dirAz, sunAz), 0.0);
          color += sunGlowColor * horizonBand * pow(azimuth, 3.0) * sunGlowStrength * 0.5 * lowSun;

          // Halo de lune : froid et discret, visible surtout la nuit.
          float cosMoon = max(dot(dir, normalize(moonDirection)), 0.0);
          float moonHalo = pow(cosMoon, 26.0) * 0.12 + pow(cosMoon, 380.0) * 0.5;
          color += moonGlowColor * moonHalo * moonGlowStrength;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  private createStars(): THREE.Points {
    const count = 1800;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const y = Math.random() * 0.86 + 0.12;
      const radius = Math.sqrt(1 - y * y);
      positions[i * 3] = Math.cos(theta) * radius * 430;
      positions[i * 3 + 1] = y * 430;
      positions[i * 3 + 2] = Math.sin(theta) * radius * 430;
      phases[i] = Math.random() * Math.PI * 2;
      sizes[i] = 1.3 + Math.random() * Math.random() * 3.2; // beaucoup de petites, quelques grosses
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    this.starsMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vTwinkle;
        void main() {
          // Scintillement doux par étoile (phase propre, vitesses variées).
          float tw = 0.55 + 0.45 * sin(uTime * 1.9 + aPhase) * sin(uTime * 0.7 + aPhase * 1.7);
          vTwinkle = clamp(tw, 0.15, 1.0);
          gl_PointSize = aSize * (0.7 + vTwinkle * 0.7) * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vTwinkle;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          float soft = smoothstep(0.25, 0.0, d);
          gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), soft * vTwinkle * uOpacity);
        }
      `,
    });
    const points = new THREE.Points(geometry, this.starsMaterial);
    points.frustumCulled = false;
    return points;
  }

  private createDisc(color: number, size: number): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.42, `#${color.toString(16).padStart(6, "0")}`);
    gradient.addColorStop(0.72, `#${color.toString(16).padStart(6, "0")}99`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.frustumCulled = false;
    return sprite;
  }
}
