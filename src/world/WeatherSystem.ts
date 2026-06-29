import * as THREE from "three";
import { clamp, lerp } from "../utils/MathUtils";
import { Player } from "../player/Player";
import { World } from "./World";
import { MoonPhase, WeatherSaveData, WeatherType } from "./WeatherTypes";
import { WeatherSample, WeatherType as RegionalWeatherType } from "../weather/WeatherTypes";

type WeatherVisuals = {
  cloudDensity: number;
  visibility: number;
  stormDarkening: number;
  precipitation: number;
  lightningFlash: number;
  wind: number;
  rainbow: number;
};

type WeatherCell = {
  type: WeatherType;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  intensity: number;
  age: number;
  duration: number;
};

const RAIN_DROP_COUNT = 420;
const SNOW_FLAKE_COUNT = 320;
const HAIL_STONE_COUNT = 180;
const RAIN_SPLASH_COUNT = 110;
const SNOW_PUFF_COUNT = 70;
const HAIL_IMPACT_COUNT = 70;
const AIR_MOTE_COUNT = 160;
const SNOW_COVER_COUNT = 180;
const WEATHER_CELL_COUNT = 4;
const ANVIL_SPRITE_COUNT = 7;
const PRECIPITATION_AREA = 92;

const defaultDuration: Record<WeatherType, number> = {
  clear: 240,
  cloudy: 240,
  overcast: 220,
  rain: 260,
  storm: 180,
  thunderstorm: 160,
  snow: 300,
  blizzard: 160,
  hail: 90,
  fog: 180,
  rainbow: 90,
  mist: 150,
};

export class WeatherSystem {
  current: WeatherType = "clear";
  target: WeatherType = "clear";
  intensity = 0;
  targetIntensity = 0;
  durationRemaining = 180;
  cloudDensity = 0.2;
  wind = 0.18;
  visibility = 1;
  moonPhase: MoonPhase = "full";
  automatic = true;
  private regionalMode = false;
  private regionalRainbowSignal = 0;
  lightningFlash = 0;
  private rainbowPower = 0;
  private lightningCooldown = 4;
  private readonly rain: THREE.LineSegments;
  private readonly rainPositions: Float32Array;
  private readonly rainSpeeds: Float32Array;
  private readonly snow: THREE.Points;
  private readonly snowPositions: Float32Array;
  private readonly snowSeeds: Float32Array;
  private readonly hail: THREE.Points;
  private readonly hailPositions: Float32Array;
  private readonly hailSpeeds: Float32Array;
  private readonly rainSplashes: THREE.Points;
  private readonly rainSplashPositions: Float32Array;
  private readonly rainSplashLife: Float32Array;
  private readonly snowPuffs: THREE.Points;
  private readonly snowPuffPositions: Float32Array;
  private readonly snowPuffLife: Float32Array;
  private readonly hailImpacts: THREE.Points;
  private readonly hailImpactPositions: Float32Array;
  private readonly hailImpactLife: Float32Array;
  private readonly airMotes: THREE.Points;
  private readonly airMotePositions: Float32Array;
  private readonly airMoteSeeds: Float32Array;
  private readonly anvilGroup = new THREE.Group();
  private readonly anvilSprites: THREE.Sprite[] = [];
  private readonly cells: WeatherCell[] = [];
  private readonly snowCover: THREE.InstancedMesh;
  private readonly snowCoverStrength: Float32Array;
  private readonly lightningLight = new THREE.PointLight(0xaed4ff, 0, 260);
  readonly rainbowGroup = new THREE.Group();
  private rainbowMaterialRef: THREE.ShaderMaterial | null = null;
  onThunder: ((delaySeconds: number, power: number) => void) | null = null;
  private autoTimer = 12;
  private manualOverrideRemaining = 0;
  private rainSplashCursor = 0;
  private snowPuffCursor = 0;
  private hailImpactCursor = 0;
  private snowCoverCursor = 0;
  private readonly lightningBolt: THREE.LineSegments;
  private lightningBoltLife = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.rainPositions = new Float32Array(RAIN_DROP_COUNT * 2 * 3);
    this.rainSpeeds = new Float32Array(RAIN_DROP_COUNT);
    this.seedRain();
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));
    const rainMaterial = new THREE.LineBasicMaterial({
      color: 0x8eb8df,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rainGeometry, rainMaterial);
    this.rain.frustumCulled = false;

    this.snowPositions = new Float32Array(SNOW_FLAKE_COUNT * 3);
    this.snowSeeds = new Float32Array(SNOW_FLAKE_COUNT);
    this.seedSnow();
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute("position", new THREE.BufferAttribute(this.snowPositions, 3));
    const snowMaterial = new THREE.PointsMaterial({
      color: 0xf4f8ff,
      size: 0.16,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.snow = new THREE.Points(snowGeometry, snowMaterial);
    this.snow.frustumCulled = false;

    this.hailPositions = new Float32Array(HAIL_STONE_COUNT * 3);
    this.hailSpeeds = new Float32Array(HAIL_STONE_COUNT);
    this.seedHail();
    const hailGeometry = new THREE.BufferGeometry();
    hailGeometry.setAttribute("position", new THREE.BufferAttribute(this.hailPositions, 3));
    const hailMaterial = new THREE.PointsMaterial({
      color: 0xd8eef7,
      size: 0.11,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.hail = new THREE.Points(hailGeometry, hailMaterial);
    this.hail.frustumCulled = false;

    this.rainSplashPositions = this.createHiddenPoints(RAIN_SPLASH_COUNT);
    this.rainSplashLife = new Float32Array(RAIN_SPLASH_COUNT);
    const rainSplashGeometry = new THREE.BufferGeometry();
    rainSplashGeometry.setAttribute("position", new THREE.BufferAttribute(this.rainSplashPositions, 3));
    const rainSplashMaterial = new THREE.PointsMaterial({
      color: 0xbadfff,
      size: 0.1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rainSplashes = new THREE.Points(rainSplashGeometry, rainSplashMaterial);
    this.rainSplashes.frustumCulled = false;

    this.snowPuffPositions = this.createHiddenPoints(SNOW_PUFF_COUNT);
    this.snowPuffLife = new Float32Array(SNOW_PUFF_COUNT);
    const snowPuffGeometry = new THREE.BufferGeometry();
    snowPuffGeometry.setAttribute("position", new THREE.BufferAttribute(this.snowPuffPositions, 3));
    const snowPuffMaterial = new THREE.PointsMaterial({
      color: 0xf6fbff,
      size: 0.2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.snowPuffs = new THREE.Points(snowPuffGeometry, snowPuffMaterial);
    this.snowPuffs.frustumCulled = false;

    this.hailImpactPositions = this.createHiddenPoints(HAIL_IMPACT_COUNT);
    this.hailImpactLife = new Float32Array(HAIL_IMPACT_COUNT);
    const hailImpactGeometry = new THREE.BufferGeometry();
    hailImpactGeometry.setAttribute("position", new THREE.BufferAttribute(this.hailImpactPositions, 3));
    const hailImpactMaterial = new THREE.PointsMaterial({
      color: 0xe8f7ff,
      size: 0.14,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.hailImpacts = new THREE.Points(hailImpactGeometry, hailImpactMaterial);
    this.hailImpacts.frustumCulled = false;

    this.airMotePositions = new Float32Array(AIR_MOTE_COUNT * 3);
    this.airMoteSeeds = new Float32Array(AIR_MOTE_COUNT);
    for (let i = 0; i < AIR_MOTE_COUNT; i += 1) {
      const base = i * 3;
      this.airMotePositions[base] = (Math.random() - 0.5) * 70;
      this.airMotePositions[base + 1] = Math.random() * 26 - 6;
      this.airMotePositions[base + 2] = (Math.random() - 0.5) * 70;
      this.airMoteSeeds[i] = Math.random() * Math.PI * 2;
    }
    const airMoteGeometry = new THREE.BufferGeometry();
    airMoteGeometry.setAttribute("position", new THREE.BufferAttribute(this.airMotePositions, 3));
    const airMoteMaterial = new THREE.PointsMaterial({
      color: 0xe6f2ff,
      size: 0.06,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    this.airMotes = new THREE.Points(airMoteGeometry, airMoteMaterial);
    this.airMotes.frustumCulled = false;

    this.snowCoverStrength = new Float32Array(SNOW_COVER_COUNT);
    const snowCoverMaterial = new THREE.MeshBasicMaterial({
      map: this.createSnowCoverTexture(),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.snowCover = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), snowCoverMaterial, SNOW_COVER_COUNT);
    this.snowCover.frustumCulled = false;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SNOW_COVER_COUNT; i += 1) this.snowCover.setMatrixAt(i, hidden);

    const lightningGeometry = new THREE.BufferGeometry();
    lightningGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(96 * 2 * 3), 3));
    const lightningMaterial = new THREE.LineBasicMaterial({
      color: 0xdceeff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.lightningBolt = new THREE.LineSegments(lightningGeometry, lightningMaterial);
    this.lightningBolt.frustumCulled = false;
    this.createWeatherCells();
    this.createAnvilSprites();
    // Les enclumes legacy "popaient"/respawnaient au loin : remplacées par le
    // dôme de nuages shader (CloudRenderer). On garde la logique des cellules
    // (elle alimente cloudDensity/wind) mais on masque leurs sprites.
    this.anvilGroup.visible = false;

    this.scene.add(
      this.snowCover,
      this.anvilGroup,
      this.airMotes,
      this.rain,
      this.snow,
      this.hail,
      this.rainSplashes,
      this.snowPuffs,
      this.hailImpacts,
      this.lightningBolt,
    );
    this.scene.add(this.lightningLight);
    this.createRainbow();
    this.scene.add(this.rainbowGroup);
  }

  update(delta: number, player: Player, world: World, dayFactor: number): WeatherVisuals {
    if (this.regionalMode) {
      this.lightningFlash = Math.max(0, this.lightningFlash - delta * 5);
      this.updateRainbow(delta, dayFactor);
      return this.getVisuals();
    }
    this.manualOverrideRemaining = Math.max(0, this.manualOverrideRemaining - delta);
    this.durationRemaining -= delta;
    if (this.durationRemaining <= 0 && this.automatic) {
      this.chooseNextAutomaticWeather(player, world);
    } else if (this.durationRemaining <= 0) {
      this.setWeather("clear", defaultDuration.clear, 0);
    }

    this.intensity = lerp(this.intensity, this.targetIntensity, Math.min(1, delta * 0.08));
    this.cloudDensity = lerp(this.cloudDensity, this.getTargetCloudDensity(), Math.min(1, delta * 0.05));
    this.visibility = lerp(this.visibility, this.getTargetVisibility(), Math.min(1, delta * 0.08));
    this.wind = lerp(this.wind, this.getTargetWind(), Math.min(1, delta * 0.04));
    this.updateWeatherCells(delta, player);

    if (Math.abs(this.intensity - this.targetIntensity) < 0.03) {
      this.current = this.target;
    }

    this.updateParticles(delta, player, world);
    this.updateLightning(delta, player, world);
    this.updateRainbow(delta, dayFactor);

    return this.getVisuals();
  }

  setWeather(
    type: WeatherType,
    duration = defaultDuration[type],
    intensity = this.defaultIntensity(type),
    manualOverride = true,
  ): void {
    this.target = type;
    this.current = type;
    const requestedIntensity = clamp(intensity, 0, 1);
    this.targetIntensity = requestedIntensity;
    this.durationRemaining = duration;
    if (manualOverride) {
      this.intensity = requestedIntensity;
      this.cloudDensity = this.getTargetCloudDensity();
      this.visibility = this.getTargetVisibility();
      this.wind = this.getTargetWind();
      this.manualOverrideRemaining = Math.max(25, duration);
    }
    if (type === "rainbow") {
      this.rainbowPower = 1;
    }
  }

  setRegionalMode(enabled: boolean): void {
    this.regionalMode = enabled;
    this.automatic = !enabled;
    this.anvilGroup.visible = !enabled;
    this.rain.visible = false;
    this.snow.visible = false;
    this.hail.visible = false;
    this.rainSplashes.visible = false;
    this.snowPuffs.visible = false;
    this.hailImpacts.visible = false;
    this.snowCover.visible = false;
  }

  syncRegional(sample: WeatherSample): void {
    if (!this.regionalMode) return;
    let type: WeatherType = "clear";
    if (sample.precipitation > 0.08 && sample.temperature <= 1.2) {
      type = sample.windSpeed > 16 ? "blizzard" : "snow";
    } else if (sample.thunderRisk > 0.58 && sample.precipitation > 0.18) {
      type = "thunderstorm";
    } else if (sample.precipitation > 0.58) {
      type = "storm";
    } else if (sample.precipitation > 0.08) {
      type = "rain";
    } else if (sample.weatherType === RegionalWeatherType.FOG) {
      type = "fog";
    } else if (sample.cloudCover > 0.72) {
      type = "overcast";
    } else if (sample.cloudCover > 0.38) {
      type = "cloudy";
    }
    this.current = type;
    this.target = type;
    this.intensity = Math.max(sample.precipitation, sample.thunderRisk * 0.86, sample.cloudCover * 0.42);
    this.targetIntensity = this.intensity;
    this.cloudDensity = sample.cloudCover;
    this.wind = clamp(sample.windSpeed / 28, 0, 1);
    this.visibility = clamp(1 - sample.precipitation * (sample.temperature <= 1.2 ? 0.8 : 0.58), 0.08, 1);
    const rainLit = clamp((sample.precipitation - 0.025) / 0.18, 0, 1) * (1 - clamp((sample.precipitation - 0.42) / 0.28, 0, 1));
    const brokenClouds = 1 - clamp((sample.cloudCover - 0.62) / 0.34, 0, 1);
    this.regionalRainbowSignal = rainLit * brokenClouds * (1 - sample.thunderRisk * 0.55);
    this.durationRemaining = 999999;
  }

  setRainbowPose(oppositeSun: THREE.Vector3, sunHeight: number): void {
    void sunHeight; // l'arc se place géométriquement (point antisolaire), pas par hauteur.
    if (!this.rainbowMaterialRef) return;
    const antisolar = this.rainbowMaterialRef.uniforms.uAntisolar.value as THREE.Vector3;
    antisolar.copy(oppositeSun);
    if (antisolar.lengthSq() < 0.0001) {
      antisolar.set(0, -1, 0);
    } else {
      antisolar.normalize();
    }
  }

  setIntensity(type: WeatherType, intensity: number): void {
    this.setWeather(type, this.durationRemaining > 0 ? this.durationRemaining : defaultDuration[type], intensity);
  }

  setCloudDensity(value: number): void {
    this.cloudDensity = clamp(value, 0, 1);
  }

  setWind(value: number): void {
    this.wind = clamp(value, 0, 1);
  }

  serialize(): WeatherSaveData {
    return {
      current: this.current,
      target: this.target,
      intensity: this.intensity,
      targetIntensity: this.targetIntensity,
      durationRemaining: this.durationRemaining,
      cloudDensity: this.cloudDensity,
      wind: this.wind,
      visibility: this.visibility,
      moonPhase: this.moonPhase,
      automatic: this.automatic,
    };
  }

  restore(data?: WeatherSaveData): void {
    if (!data) return;
    this.current = data.current;
    this.target = data.target;
    this.intensity = data.intensity;
    this.targetIntensity = data.targetIntensity;
    this.durationRemaining = data.durationRemaining;
    this.cloudDensity = data.cloudDensity;
    this.wind = data.wind;
    this.visibility = data.visibility;
    this.moonPhase = data.moonPhase;
    this.automatic = data.automatic;
  }

  dispose(): void {
    this.scene.remove(this.rain);
    this.scene.remove(this.snow);
    this.scene.remove(this.hail);
    this.scene.remove(this.rainSplashes);
    this.scene.remove(this.snowPuffs);
    this.scene.remove(this.hailImpacts);
    this.scene.remove(this.airMotes);
    this.scene.remove(this.anvilGroup);
    this.scene.remove(this.lightningBolt);
    this.scene.remove(this.snowCover);
    this.scene.remove(this.lightningLight);
    this.scene.remove(this.rainbowGroup);
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
    this.snow.geometry.dispose();
    (this.snow.material as THREE.Material).dispose();
    this.hail.geometry.dispose();
    (this.hail.material as THREE.Material).dispose();
    this.rainSplashes.geometry.dispose();
    (this.rainSplashes.material as THREE.Material).dispose();
    this.snowPuffs.geometry.dispose();
    (this.snowPuffs.material as THREE.Material).dispose();
    this.hailImpacts.geometry.dispose();
    (this.hailImpacts.material as THREE.Material).dispose();
    this.airMotes.geometry.dispose();
    (this.airMotes.material as THREE.Material).dispose();
    this.anvilSprites.forEach((sprite) => {
      const material = sprite.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    });
    this.lightningBolt.geometry.dispose();
    (this.lightningBolt.material as THREE.Material).dispose();
    this.snowCover.geometry.dispose();
    const snowCoverMaterial = this.snowCover.material as THREE.MeshBasicMaterial;
    snowCoverMaterial.map?.dispose();
    snowCoverMaterial.dispose();
    this.rainbowGroup.children.forEach((child) => {
      if (child instanceof THREE.Sprite) {
        const material = child.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
      } else if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }

  private getVisuals(): WeatherVisuals {
    const stormy = this.current === "storm" || this.current === "thunderstorm" || this.current === "blizzard";
    const precipitation =
      this.current === "rain" ||
      this.current === "storm" ||
      this.current === "thunderstorm" ||
      this.current === "snow" ||
      this.current === "blizzard" ||
      this.current === "hail"
        ? this.intensity
        : 0;
    return {
      cloudDensity: this.cloudDensity,
      visibility: this.visibility,
      stormDarkening: stormy ? this.intensity : this.current === "overcast" ? this.intensity * 0.7 : 0,
      precipitation,
      lightningFlash: this.lightningFlash,
      wind: this.wind,
      rainbow: this.rainbowPower,
    };
  }

  private chooseNextAutomaticWeather(player: Player, world: World): void {
    this.autoTimer -= 1;
    const biome = world.getBiomeAt(player.position.x, player.position.z);
    const altitude = player.position.y;
    const wet = biome.id === "forest" || biome.id === "beach" ? 0.25 : 0;
    const cold = biome.id === "snow" || altitude > 82 || biome.temperature < 0.34;
    const dry = biome.id === "desert" ? 0.45 : 0;
    const roll = Math.random();

    if (this.current === "rain" || this.current === "storm") {
      this.setWeather(roll < 0.22 ? "rainbow" : "cloudy", 120, roll < 0.22 ? 1 : 0.35, false);
      return;
    }
    if (cold && roll < 0.36) {
      this.setWeather(this.wind > 0.65 ? "blizzard" : "snow", 260, 0.55 + Math.random() * 0.35, false);
      return;
    }
    if (roll < 0.22 + wet - dry) {
      this.setWeather("rain", 240, 0.45 + Math.random() * 0.35, false);
      return;
    }
    if (roll < 0.3 + wet && biome.humidity > 0.58) {
      this.setWeather("fog", 170, 0.35 + Math.random() * 0.35, false);
      return;
    }
    if (roll < 0.08 && biome.id !== "desert") {
      this.setWeather("storm", 150, 0.6 + Math.random() * 0.3, false);
      return;
    }
    this.setWeather(roll < 0.42 ? "cloudy" : "clear", 220, roll < 0.42 ? 0.3 : 0, false);
  }

  private createWeatherCells(): void {
    for (let i = 0; i < WEATHER_CELL_COUNT; i += 1) {
      const cell: WeatherCell = {
        type: "cloudy",
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        radius: 220,
        intensity: 0.5,
        age: 0,
        duration: 300,
      };
      this.respawnWeatherCell(cell, 0, 0, i * 80);
      this.cells.push(cell);
    }
  }

  private respawnWeatherCell(cell: WeatherCell, originX: number, originZ: number, ageOffset = 0): void {
    const roll = Math.random();
    let type: WeatherType = "cloudy";
    if (roll > 0.86) type = "thunderstorm";
    else if (roll > 0.74) type = "storm";
    else if (roll > 0.63) type = "rain";
    else if (roll > 0.52) type = "snow";
    else if (roll > 0.45) type = "hail";
    else if (roll > 0.34) type = "overcast";
    else if (roll > 0.24) type = "mist";

    const angle = Math.random() * Math.PI * 2;
    const distance = 280 + Math.random() * 620;
    const driftAngle = angle + Math.PI + (Math.random() - 0.5) * 0.95;
    const speed = 4.5 + Math.random() * 12;
    const severe = this.isSevereCell(type);
    cell.type = type;
    cell.x = originX + Math.cos(angle) * distance;
    cell.z = originZ + Math.sin(angle) * distance;
    cell.vx = Math.cos(driftAngle) * speed + (Math.random() - 0.5) * 2.5;
    cell.vz = Math.sin(driftAngle) * speed + (Math.random() - 0.5) * 2.5;
    cell.radius = severe ? 230 + Math.random() * 220 : 150 + Math.random() * 260;
    cell.intensity = clamp((severe ? 0.62 : 0.34) + Math.random() * 0.36, 0, 1);
    cell.age = -ageOffset;
    cell.duration = 260 + Math.random() * 540;
  }

  private createAnvilSprites(): void {
    const texture = this.createAnvilTexture();
    for (let i = 0; i < ANVIL_SPRITE_COUNT; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        color: 0xffffff,
      });
      const sprite = new THREE.Sprite(material);
      sprite.frustumCulled = false;
      sprite.visible = false;
      this.anvilSprites.push(sprite);
      this.anvilGroup.add(sprite);
    }
    texture.dispose();
  }

  private createAnvilTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const tower = context.createRadialGradient(240, 154, 18, 240, 154, 120);
    tower.addColorStop(0, "rgba(255,255,255,0.72)");
    tower.addColorStop(0.45, "rgba(180,190,202,0.52)");
    tower.addColorStop(1, "rgba(80,92,110,0)");
    context.fillStyle = tower;
    context.beginPath();
    context.ellipse(240, 154, 108, 72, 0, 0, Math.PI * 2);
    context.fill();

    const cap = context.createLinearGradient(0, 34, 512, 126);
    cap.addColorStop(0, "rgba(170,180,192,0)");
    cap.addColorStop(0.18, "rgba(205,214,226,0.42)");
    cap.addColorStop(0.5, "rgba(235,240,248,0.7)");
    cap.addColorStop(0.84, "rgba(118,130,148,0.46)");
    cap.addColorStop(1, "rgba(70,82,100,0)");
    context.fillStyle = cap;
    context.beginPath();
    context.ellipse(264, 94, 238, 54, -0.05, 0, Math.PI * 2);
    context.fill();

    context.globalCompositeOperation = "lighter";
    for (let i = 0; i < 34; i += 1) {
      const x = 64 + Math.random() * 390;
      const y = 64 + Math.random() * 126;
      const rx = 28 + Math.random() * 86;
      const ry = 16 + Math.random() * 38;
      context.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.14})`;
      context.beginPath();
      context.ellipse(x, y, rx, ry, (Math.random() - 0.5) * 0.35, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";

    const fade = context.createLinearGradient(0, 0, 0, canvas.height);
    fade.addColorStop(0, "rgba(255,255,255,0)");
    fade.addColorStop(0.16, "rgba(255,255,255,0.9)");
    fade.addColorStop(0.76, "rgba(255,255,255,0.82)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    context.globalCompositeOperation = "destination-in";
    context.fillStyle = fade;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  private updateWeatherCells(delta: number, player: Player): void {
    let strongestType: WeatherType | null = null;
    let strongestPower = 0;
    let cloudInfluence = 0;
    let windInfluence = 0;

    this.cells.forEach((cell, index) => {
      cell.age += delta;
      cell.x += cell.vx * delta;
      cell.z += cell.vz * delta;

      const dx = cell.x - player.position.x;
      const dz = cell.z - player.position.z;
      const distance = Math.hypot(dx, dz);
      const movingAway = dx * cell.vx + dz * cell.vz > 0;
      if (cell.age > cell.duration || (distance > 980 && movingAway)) {
        this.respawnWeatherCell(cell, player.position.x, player.position.z);
      }

      const refreshedDx = cell.x - player.position.x;
      const refreshedDz = cell.z - player.position.z;
      const refreshedDistance = Math.hypot(refreshedDx, refreshedDz);
      const innerPower = clamp(1 - refreshedDistance / cell.radius, 0, 1) * cell.intensity;
      const rimPower = clamp(1 - Math.abs(refreshedDistance - cell.radius * 1.08) / (cell.radius * 0.85), 0, 1) * cell.intensity;
      cloudInfluence = Math.max(cloudInfluence, innerPower, rimPower * (this.isSevereCell(cell.type) ? 0.82 : 0.55));
      windInfluence = Math.max(windInfluence, (innerPower + rimPower * 0.45) * (this.isSevereCell(cell.type) ? 1 : 0.6));

      if (innerPower > strongestPower && this.isWeatherCellPrecipitating(cell.type)) {
        strongestType = cell.type;
        strongestPower = innerPower;
      }

      const sprite = this.anvilSprites[index];
      if (!sprite) return;
      const material = sprite.material as THREE.SpriteMaterial;
      const severe = this.isSevereCell(cell.type);
      const maxDistance = severe ? 860 : 620;
      const visible = refreshedDistance < maxDistance && (severe || rimPower > 0.08 || innerPower > 0.04);
      sprite.visible = visible;
      if (!visible) {
        material.opacity = 0;
        return;
      }

      const distanceFade = clamp(1 - refreshedDistance / maxDistance, 0, 1);
      const power = Math.max(innerPower, rimPower);
      material.opacity = clamp((0.16 + power * 0.62) * distanceFade, 0, severe ? 0.86 : 0.48);
      material.color.set(severe ? 0xa5adbb : cell.type === "snow" ? 0xe8f2ff : 0xcbd4df);
      sprite.position.set(cell.x, player.position.y + 88 + power * 22, cell.z);
      const scale = severe ? 180 + cell.radius * 0.38 : 96 + cell.radius * 0.24;
      sprite.scale.set(scale, scale * (severe ? 0.48 : 0.36), 1);
    });

    this.cloudDensity = Math.max(this.cloudDensity, clamp(0.12 + cloudInfluence * 0.9, 0, 1));
    this.wind = Math.max(this.wind, clamp(0.16 + windInfluence * 0.78, 0, 1));

    if (!this.automatic || this.manualOverrideRemaining > 0) return;

    if (strongestType && strongestPower > 0.2) {
      this.target = strongestType;
      this.targetIntensity = clamp(0.28 + strongestPower * 0.9, 0, 1);
      this.durationRemaining = Math.max(this.durationRemaining, 42);
      return;
    }

    if (cloudInfluence > 0.24 && this.durationRemaining < 80) {
      this.target = cloudInfluence > 0.62 ? "overcast" : "cloudy";
      this.targetIntensity = clamp(cloudInfluence, 0.25, 0.85);
      this.durationRemaining = Math.max(this.durationRemaining, 55);
    }
  }

  private updateParticles(delta: number, player: Player, world: World): void {
    const rainMaterial = this.rain.material as THREE.LineBasicMaterial;
    const snowMaterial = this.snow.material as THREE.PointsMaterial;
    const hailMaterial = this.hail.material as THREE.PointsMaterial;

    this.rain.visible = false;
    this.snow.visible = false;
    this.hail.visible = false;
    rainMaterial.opacity = 0;
    snowMaterial.opacity = 0;
    hailMaterial.opacity = 0;
    this.updateAirMotes(delta, player);
    this.updateGroundEffects(delta);

    if (!this.isPrecipitating() || this.intensity <= 0.02) {
      return;
    }

    if (this.current === "rain" || this.current === "storm" || this.current === "thunderstorm") {
      this.updateRain(delta, player, world);
      return;
    }
    if (this.current === "snow" || this.current === "blizzard") {
      this.updateSnow(delta, player, world);
      return;
    }
    if (this.current === "hail") {
      this.updateHail(delta, player, world);
    }
  }

  private updateLightning(delta: number, player: Player, world: World): void {
    this.lightningFlash = Math.max(0, this.lightningFlash - delta * 5.8);
    this.lightningLight.intensity = this.lightningFlash * 5.4;
    this.lightningLight.position.set(player.position.x + 24, player.position.y + 62, player.position.z - 34);
    this.lightningBoltLife = Math.max(0, this.lightningBoltLife - delta * 6.2);
    (this.lightningBolt.material as THREE.LineBasicMaterial).opacity = this.lightningBoltLife;

    const storm = this.current === "storm" || this.current === "thunderstorm";
    if (!storm || this.intensity < 0.35) return;
    this.lightningCooldown -= delta;
    if (this.lightningCooldown <= 0 && Math.random() < delta * (this.current === "thunderstorm" ? 0.75 : 0.34)) {
      this.lightningFlash = 0.78 + Math.random() * 0.22;
      this.lightningCooldown = 9 + Math.random() * 16;
      const strikeX = player.position.x + (Math.random() - 0.5) * 90;
      const strikeZ = player.position.z + (Math.random() - 0.5) * 90;
      const strikeY = this.getGroundY(world, strikeX, strikeZ);
      this.createLightningBolt(strikeX, strikeY, strikeZ, player.position);
      const distance = Math.hypot(strikeX - player.position.x, strikeZ - player.position.z);
      this.onThunder?.(0.35 + distance / 140, this.intensity);
    }
  }

  private createLightningBolt(x: number, groundY: number, z: number, playerPosition: THREE.Vector3): void {
    const positions = this.lightningBolt.geometry.attributes.position.array as Float32Array;
    let cursor = 0;
    let last = new THREE.Vector3(x + (Math.random() - 0.5) * 16, playerPosition.y + 105, z + (Math.random() - 0.5) * 16);
    const target = new THREE.Vector3(x, groundY + 0.4, z);
    const segments = 22;
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments;
      const next = new THREE.Vector3().lerpVectors(last, target, 0);
      next.lerpVectors(
        new THREE.Vector3(x, playerPosition.y + 105, z),
        target,
        t,
      );
      const jitter = (1 - t) * 7;
      next.x += (Math.random() - 0.5) * jitter;
      next.z += (Math.random() - 0.5) * jitter;
      cursor = this.pushBoltSegment(positions, cursor, last, next);
      if (Math.random() < 0.22 && i > 4 && i < segments - 3) {
        const branchEnd = next
          .clone()
          .add(new THREE.Vector3((Math.random() - 0.5) * 22, -8 - Math.random() * 16, (Math.random() - 0.5) * 22));
        cursor = this.pushBoltSegment(positions, cursor, next, branchEnd);
      }
      last = next;
    }
    for (let i = cursor; i < positions.length; i += 1) positions[i] = 0;
    this.lightningBolt.geometry.attributes.position.needsUpdate = true;
    this.lightningBoltLife = 1;
  }

  private pushBoltSegment(positions: Float32Array, cursor: number, from: THREE.Vector3, to: THREE.Vector3): number {
    if (cursor + 6 > positions.length) return cursor;
    positions[cursor++] = from.x;
    positions[cursor++] = from.y;
    positions[cursor++] = from.z;
    positions[cursor++] = to.x;
    positions[cursor++] = to.y;
    positions[cursor++] = to.z;
    return cursor;
  }

  private seedRain(): void {
    for (let i = 0; i < RAIN_DROP_COUNT; i += 1) {
      const vertex = i * 6;
      const x = (Math.random() - 0.5) * PRECIPITATION_AREA;
      const y = Math.random() * 62 - 12;
      const z = (Math.random() - 0.5) * PRECIPITATION_AREA;
      this.rainPositions[vertex] = x;
      this.rainPositions[vertex + 1] = y;
      this.rainPositions[vertex + 2] = z;
      this.rainPositions[vertex + 3] = x;
      this.rainPositions[vertex + 4] = y - 1.6;
      this.rainPositions[vertex + 5] = z;
      this.rainSpeeds[i] = 30 + Math.random() * 30;
    }
  }

  private seedSnow(): void {
    for (let i = 0; i < SNOW_FLAKE_COUNT; i += 1) {
      const vertex = i * 3;
      this.snowPositions[vertex] = (Math.random() - 0.5) * PRECIPITATION_AREA;
      this.snowPositions[vertex + 1] = Math.random() * 58 - 10;
      this.snowPositions[vertex + 2] = (Math.random() - 0.5) * PRECIPITATION_AREA;
      this.snowSeeds[i] = Math.random() * Math.PI * 2;
    }
  }

  private seedHail(): void {
    for (let i = 0; i < HAIL_STONE_COUNT; i += 1) {
      const vertex = i * 3;
      this.hailPositions[vertex] = (Math.random() - 0.5) * PRECIPITATION_AREA;
      this.hailPositions[vertex + 1] = Math.random() * 58 - 8;
      this.hailPositions[vertex + 2] = (Math.random() - 0.5) * PRECIPITATION_AREA;
      this.hailSpeeds[i] = 38 + Math.random() * 34;
    }
  }

  private updateRain(delta: number, player: Player, world: World): void {
    const material = this.rain.material as THREE.LineBasicMaterial;
    const storm = this.current === "storm" || this.current === "thunderstorm";
    const opacity = clamp(this.intensity * (storm ? 0.68 : 0.48), 0, 0.68);
    const length = storm ? 3.7 : 2.65;
    const windLean = (this.wind - 0.22) * (storm ? 3.2 : 2.1);
    const speedScale = storm ? 1.35 : 1;

    this.rain.visible = opacity > 0.025;
    material.opacity = opacity;
    material.color.set(storm ? 0x9ab2c8 : 0xa9c9e9);
    this.rain.position.set(player.position.x, player.position.y + 16, player.position.z);

    for (let i = 0; i < RAIN_DROP_COUNT; i += 1) {
      const vertex = i * 6;
      let x = this.rainPositions[vertex] + this.wind * delta * 10.5;
      let y = this.rainPositions[vertex + 1] - this.rainSpeeds[i] * speedScale * delta;
      let z = this.rainPositions[vertex + 2] + (storm ? delta * 1.8 : 0);
      const worldX = player.position.x + x;
      const worldZ = player.position.z + z;
      const groundY = this.getGroundY(world, worldX, worldZ);
      const localGroundY = groundY - (player.position.y + 16);
      if (y <= localGroundY + 0.3) {
        this.spawnRainSplash(worldX, groundY + 0.08, worldZ, storm);
      }
      if (y < localGroundY || y < -18 || Math.abs(x) > PRECIPITATION_AREA * 0.58 || Math.abs(z) > PRECIPITATION_AREA * 0.58) {
        x = (Math.random() - 0.5) * PRECIPITATION_AREA;
        y = 42 + Math.random() * 22;
        z = (Math.random() - 0.5) * PRECIPITATION_AREA;
      }
      this.rainPositions[vertex] = x;
      this.rainPositions[vertex + 1] = y;
      this.rainPositions[vertex + 2] = z;
      this.rainPositions[vertex + 3] = x - windLean;
      this.rainPositions[vertex + 4] = y - length;
      this.rainPositions[vertex + 5] = z - 0.2;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  private updateSnow(delta: number, player: Player, world: World): void {
    const material = this.snow.material as THREE.PointsMaterial;
    const blizzard = this.current === "blizzard";
    const time = performance.now() * 0.001;
    const opacity = clamp(this.intensity * (blizzard ? 0.88 : 0.62), 0, 0.9);
    this.snow.visible = opacity > 0.025;
    material.opacity = opacity;
    material.size = blizzard ? 0.13 : 0.18;
    material.color.set(blizzard ? 0xdde8f2 : 0xffffff);
    this.snow.position.set(player.position.x, player.position.y + 15, player.position.z);

    for (let i = 0; i < SNOW_FLAKE_COUNT; i += 1) {
      const vertex = i * 3;
      const seed = this.snowSeeds[i];
      const gust = blizzard ? 9.5 : 2.1;
      this.snowPositions[vertex] += (this.wind * gust + Math.sin(time * 1.4 + seed) * 0.45) * delta;
      this.snowPositions[vertex + 1] -= (blizzard ? 10.5 : 3.6 + Math.sin(seed) * 1.2) * delta;
      this.snowPositions[vertex + 2] += Math.cos(time * 1.1 + seed) * (blizzard ? 2.4 : 0.85) * delta;
      const groundY = this.getGroundY(world, player.position.x + this.snowPositions[vertex], player.position.z + this.snowPositions[vertex + 2]);
      const localGroundY = groundY - (player.position.y + 15);
      if (this.snowPositions[vertex + 1] <= localGroundY + 0.15) {
        this.spawnSnowPuff(player.position.x + this.snowPositions[vertex], groundY + 0.05, player.position.z + this.snowPositions[vertex + 2], blizzard);
      }
      if (
        this.snowPositions[vertex + 1] < localGroundY ||
        this.snowPositions[vertex + 1] < -14 ||
        Math.abs(this.snowPositions[vertex]) > PRECIPITATION_AREA * 0.58 ||
        Math.abs(this.snowPositions[vertex + 2]) > PRECIPITATION_AREA * 0.58
      ) {
        this.snowPositions[vertex] = (Math.random() - 0.5) * PRECIPITATION_AREA;
        this.snowPositions[vertex + 1] = 40 + Math.random() * 22;
        this.snowPositions[vertex + 2] = (Math.random() - 0.5) * PRECIPITATION_AREA;
      }
    }
    this.snow.geometry.attributes.position.needsUpdate = true;
  }

  private updateHail(delta: number, player: Player, world: World): void {
    const material = this.hail.material as THREE.PointsMaterial;
    const opacity = clamp(this.intensity * 0.76, 0, 0.82);
    this.hail.visible = opacity > 0.025;
    material.opacity = opacity;
    material.size = 0.12 + this.intensity * 0.045;
    this.hail.position.set(player.position.x, player.position.y + 15, player.position.z);

    for (let i = 0; i < HAIL_STONE_COUNT; i += 1) {
      const vertex = i * 3;
      this.hailPositions[vertex] += this.wind * delta * 8;
      this.hailPositions[vertex + 1] -= this.hailSpeeds[i] * delta;
      this.hailPositions[vertex + 2] += Math.sin(performance.now() * 0.004 + i) * delta * 0.8;
      const groundY = this.getGroundY(world, player.position.x + this.hailPositions[vertex], player.position.z + this.hailPositions[vertex + 2]);
      const localGroundY = groundY - (player.position.y + 15);
      if (this.hailPositions[vertex + 1] <= localGroundY + 0.2) {
        this.spawnHailImpact(player.position.x + this.hailPositions[vertex], groundY + 0.1, player.position.z + this.hailPositions[vertex + 2]);
      }
      if (this.hailPositions[vertex + 1] < localGroundY || this.hailPositions[vertex + 1] < -12 || Math.abs(this.hailPositions[vertex]) > PRECIPITATION_AREA * 0.58) {
        this.hailPositions[vertex] = (Math.random() - 0.5) * PRECIPITATION_AREA;
        this.hailPositions[vertex + 1] = 42 + Math.random() * 18;
        this.hailPositions[vertex + 2] = (Math.random() - 0.5) * PRECIPITATION_AREA;
      }
    }
    this.hail.geometry.attributes.position.needsUpdate = true;
  }

  private updateAirMotes(delta: number, player: Player): void {
    const material = this.airMotes.material as THREE.PointsMaterial;
    const wet = this.isPrecipitating() || this.current === "fog" || this.current === "mist";
    material.opacity = wet ? 0.13 + this.intensity * 0.18 : 0.055 + this.cloudDensity * 0.035;
    material.size = wet ? 0.075 : 0.055;
    this.airMotes.position.set(player.position.x, player.position.y + 7.5, player.position.z);
    const time = performance.now() * 0.001;
    for (let i = 0; i < AIR_MOTE_COUNT; i += 1) {
      const base = i * 3;
      const seed = this.airMoteSeeds[i];
      this.airMotePositions[base] += (this.wind * 1.2 + Math.sin(time * 0.8 + seed) * 0.18) * delta;
      this.airMotePositions[base + 1] += Math.sin(time * 0.55 + seed) * delta * 0.12;
      this.airMotePositions[base + 2] += Math.cos(time * 0.7 + seed) * delta * 0.18;
      if (Math.abs(this.airMotePositions[base]) > 36) this.airMotePositions[base] *= -0.92;
      if (Math.abs(this.airMotePositions[base + 2]) > 36) this.airMotePositions[base + 2] *= -0.92;
      if (this.airMotePositions[base + 1] > 20) this.airMotePositions[base + 1] = -7;
      if (this.airMotePositions[base + 1] < -8) this.airMotePositions[base + 1] = 19;
    }
    this.airMotes.geometry.attributes.position.needsUpdate = true;
  }

  private updateGroundEffects(delta: number): void {
    this.updateLifePool(this.rainSplashPositions, this.rainSplashLife, delta, 5.4, 0.18);
    this.updateLifePool(this.snowPuffPositions, this.snowPuffLife, delta, 1.25, 0.04);
    this.updateLifePool(this.hailImpactPositions, this.hailImpactLife, delta, 4.5, 0.55);

    (this.rainSplashes.material as THREE.PointsMaterial).opacity = this.isRainLike() ? clamp(this.intensity * 0.55, 0, 0.58) : 0;
    (this.snowPuffs.material as THREE.PointsMaterial).opacity = this.current === "snow" || this.current === "blizzard" ? clamp(this.intensity * 0.42, 0, 0.48) : 0;
    (this.hailImpacts.material as THREE.PointsMaterial).opacity = this.current === "hail" ? clamp(this.intensity * 0.7, 0, 0.72) : 0;

    this.rainSplashes.geometry.attributes.position.needsUpdate = true;
    this.snowPuffs.geometry.attributes.position.needsUpdate = true;
    this.hailImpacts.geometry.attributes.position.needsUpdate = true;
  }

  private updateLifePool(positions: Float32Array, life: Float32Array, delta: number, decay: number, rise: number): void {
    for (let i = 0; i < life.length; i += 1) {
      const base = i * 3;
      if (life[i] <= 0) {
        positions[base + 1] = -9999;
        continue;
      }
      life[i] -= delta * decay;
      positions[base + 1] += delta * rise;
      positions[base] += Math.sin(performance.now() * 0.004 + i) * delta * 0.08;
      if (life[i] <= 0) positions[base + 1] = -9999;
    }
  }

  private spawnRainSplash(x: number, y: number, z: number, storm: boolean): void {
    const repeats = storm ? 2 : 1;
    for (let n = 0; n < repeats; n += 1) {
      const i = this.rainSplashCursor++ % RAIN_SPLASH_COUNT;
      const base = i * 3;
      this.rainSplashPositions[base] = x + (Math.random() - 0.5) * 0.7;
      this.rainSplashPositions[base + 1] = y;
      this.rainSplashPositions[base + 2] = z + (Math.random() - 0.5) * 0.7;
      this.rainSplashLife[i] = 0.65 + Math.random() * 0.35;
    }
  }

  private spawnSnowPuff(x: number, y: number, z: number, blizzard: boolean): void {
    if (Math.random() > (blizzard ? 0.35 : 0.12)) return;
    const i = this.snowPuffCursor++ % SNOW_PUFF_COUNT;
    const base = i * 3;
    this.snowPuffPositions[base] = x + (Math.random() - 0.5) * 0.4;
    this.snowPuffPositions[base + 1] = y;
    this.snowPuffPositions[base + 2] = z + (Math.random() - 0.5) * 0.4;
    this.snowPuffLife[i] = 0.8 + Math.random() * 0.6;
    this.addSnowCover(x, y + 0.015, z, blizzard);
  }

  private spawnHailImpact(x: number, y: number, z: number): void {
    const i = this.hailImpactCursor++ % HAIL_IMPACT_COUNT;
    const base = i * 3;
    this.hailImpactPositions[base] = x + (Math.random() - 0.5) * 0.5;
    this.hailImpactPositions[base + 1] = y;
    this.hailImpactPositions[base + 2] = z + (Math.random() - 0.5) * 0.5;
    this.hailImpactLife[i] = 0.55 + Math.random() * 0.35;
  }

  private getGroundY(world: World, x: number, z: number): number {
    return world.getSurfaceHeight(Math.floor(x), Math.floor(z)) + 1.04;
  }

  private createHiddenPoints(count: number): Float32Array {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -9999;
      positions[i * 3 + 2] = 0;
    }
    return positions;
  }

  private addSnowCover(x: number, y: number, z: number, blizzard: boolean): void {
    const index = this.snowCoverCursor++ % SNOW_COVER_COUNT;
    const strength = Math.min(1, this.snowCoverStrength[index] + (blizzard ? 0.28 : 0.16));
    this.snowCoverStrength[index] = strength;
    const scale = 0.45 + strength * (blizzard ? 1.2 : 0.9) + Math.random() * 0.45;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.random() * Math.PI * 2));
    matrix.compose(
      new THREE.Vector3(x + (Math.random() - 0.5) * 0.45, y, z + (Math.random() - 0.5) * 0.45),
      rotation,
      new THREE.Vector3(scale, scale, scale),
    );
    this.snowCover.setMatrixAt(index, matrix);
    this.snowCover.instanceMatrix.needsUpdate = true;
  }

  private createSnowCoverTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 62);
    gradient.addColorStop(0, "rgba(255,255,255,0.86)");
    gradient.addColorStop(0.62, "rgba(235,246,255,0.62)");
    gradient.addColorStop(1, "rgba(235,246,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 120; i += 1) {
      context.fillStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.18})`;
      context.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  private updateRainbow(delta: number, dayFactor: number): void {
    const desired = dayFactor > 0.35 ? Math.max(this.current === "rainbow" ? 1 : 0, this.regionalRainbowSignal) : 0;
    this.rainbowPower = lerp(this.rainbowPower, desired, Math.min(1, delta * 0.35));
    this.rainbowGroup.visible = this.rainbowPower > 0.01;
    if (this.rainbowMaterialRef) {
      this.rainbowMaterialRef.uniforms.uIntensity.value = this.rainbowPower;
    }
  }

  private createRainbow(): void {
    // Vrai arc-en-ciel : un arc ANGULAIRE (~42° autour du point antisolaire)
    // dessiné par un shader sur un dôme qui suit la caméra. Couleurs spectrales
    // correctes, double arc + bande sombre d'Alexander, occulté par le terrain
    // (depthTest) et fondu dans l'horizon. Plus un simple décal posé dans le ciel.
    const geometry = new THREE.SphereGeometry(1480, 64, 32);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uAntisolar: { value: new THREE.Vector3(0, -1, 0) },
        uIntensity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uAntisolar;
        uniform float uIntensity;
        varying vec3 vDir;
        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 0.6666667, 0.3333333, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }
        // t = 0 violet (intérieur de l'arc) .. 1 rouge (extérieur).
        vec3 spectrum(float t) {
          t = clamp(t, 0.0, 1.0);
          return hsv2rgb(vec3((1.0 - t) * 0.78, 0.92, 1.0));
        }
        void main() {
          vec3 dir = normalize(vDir);
          float ang = degrees(acos(clamp(dot(dir, normalize(uAntisolar)), -1.0, 1.0)));
          // Arc primaire (~40.7..42.3°).
          float primaryBand = smoothstep(40.1, 40.7, ang) * (1.0 - smoothstep(42.3, 43.0, ang));
          vec3 primaryColor = spectrum((ang - 40.7) / 1.6) * primaryBand;
          // Arc secondaire (~51..53.4°), spectre inversé, plus pâle.
          float secBand = smoothstep(50.3, 51.0, ang) * (1.0 - smoothstep(53.4, 54.2, ang));
          vec3 secColor = spectrum(1.0 - (ang - 51.0) / 2.4) * secBand * 0.42;
          // Fondu dans l'horizon ; invisible sous l'horizon.
          float horizon = smoothstep(-0.04, 0.16, dir.y);
          vec3 color = (primaryColor + secColor) * horizon * uIntensity * 0.85;
          float bright = max(max(color.r, color.g), color.b);
          if (bright < 0.003) discard;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.rainbowMaterialRef = material;
    this.rainbowGroup.add(mesh);
  }

  private isPrecipitating(): boolean {
    return ["rain", "storm", "thunderstorm", "snow", "blizzard", "hail"].includes(this.current);
  }

  private isWeatherCellPrecipitating(type: WeatherType): boolean {
    return type === "rain" || type === "storm" || type === "thunderstorm" || type === "snow" || type === "blizzard" || type === "hail";
  }

  private isSevereCell(type: WeatherType): boolean {
    return type === "storm" || type === "thunderstorm" || type === "blizzard" || type === "hail";
  }

  private isRainLike(): boolean {
    return this.current === "rain" || this.current === "storm" || this.current === "thunderstorm";
  }

  private getTargetCloudDensity(): number {
    switch (this.target) {
      case "clear":
      case "rainbow":
        return 0.18;
      case "cloudy":
      case "mist":
        return 0.48;
      case "overcast":
      case "fog":
        return 0.85;
      case "storm":
      case "thunderstorm":
      case "blizzard":
        return 1;
      default:
        return 0.72 + this.targetIntensity * 0.18;
    }
  }

  private getTargetVisibility(): number {
    switch (this.target) {
      case "fog":
        return 0.28 + (1 - this.targetIntensity) * 0.2;
      case "mist":
        return 0.62;
      case "storm":
      case "thunderstorm":
      case "blizzard":
        return 0.38;
      case "rain":
      case "snow":
      case "hail":
        return 0.58;
      default:
        return 1;
    }
  }

  private getTargetWind(): number {
    switch (this.target) {
      case "storm":
      case "thunderstorm":
      case "blizzard":
        return 0.8;
      case "hail":
        return 0.62;
      case "snow":
        return 0.3;
      default:
        return 0.18 + this.cloudDensity * 0.25;
    }
  }

  private defaultIntensity(type: WeatherType): number {
    switch (type) {
      case "clear":
        return 0;
      case "cloudy":
      case "mist":
        return 0.35;
      case "overcast":
      case "rain":
      case "snow":
        return 0.62;
      case "fog":
      case "hail":
        return 0.7;
      case "storm":
      case "thunderstorm":
      case "blizzard":
        return 0.86;
      case "rainbow":
        return 1;
      default:
        return 0.5;
    }
  }
}
