import * as THREE from "three";
import { CloudPuff } from "./CloudPuff";
import { CloudThermal } from "./CloudThermal";
import { CloudLifecycle, isGrowing, isStormy } from "./CloudLifecycle";
import { PrecipKind } from "../weather/WeatherTypes";
import {
  ConvectiveShapeState,
  ConvectiveVisualPhase,
  createConvectiveShapeState,
} from "./ConvectiveShapeState";

export interface CloudEnvironment {
  /** 0 (nuit) .. 1 (plein jour) — éclairage. */
  dayFactor: number;
  /** Direction monde vers le soleil (normalisée). */
  sunDir: THREE.Vector3;
}

const MAX_PUFFS = 520;
const THERMAL_INTERVAL = 0.8; // s entre deux thermiques
const PUFF_SPACING = 24; // espacement vertical des grappes déposées par une thermique
const GRAVITY_DRAG = 1.4;

let nextId = 1;

export type CloudTestProfile = "cumulus" | "congestus" | "cumulonimbus" | "anvil" | "rainshaft";
export type StormVisualKind = "convective" | "storm" | "supercell" | "squall";

export interface StormVisualState {
  eventId: number;
  kind: StormVisualKind;
  radius: number;
  intensity: number;
  development: number;
  precip: PrecipKind;
}

/**
 * Une masse nuageuse convective : un nuage vivant, simulé par des puffs et des
 * thermiques. C'est ici que vit toute la physique simplifiée (convection,
 * bourgeonnement, base plate, enclume, dissipation).
 */
export class CloudMass {
  readonly id = nextId++;
  lifecycle: CloudLifecycle = CloudLifecycle.FORMING;

  readonly position = new THREE.Vector3(); // centre de la base
  readonly upperWind = new THREE.Vector3(); // vent d'altitude (enclume)
  readonly shapeSeed = Math.random() * 1000;
  readonly convectiveShape: ConvectiveShapeState;

  baseHeight: number;
  topHeight: number;
  width = 30;
  depth = 30;
  /** Authoritative atmospheric box used by both density baking and rendering. */
  readonly volumeBoundsMin = new THREE.Vector3();
  readonly volumeBoundsSize = new THREE.Vector3(420, 320, 340);
  /** Plafond de puffs pour CE nuage (= sa taille). Petit cumulus → petit budget. */
  puffBudget = MAX_PUFFS;

  humidity: number; // 0..1
  instability: number; // 0..1
  pressure = 1010;
  condensationLevel: number;
  inversionHeight: number;
  maturity = 0;
  precipitationRate = 0;

  readonly stormVisual: StormVisualState = {
    eventId: -1,
    kind: "convective",
    radius: 0,
    intensity: 0,
    development: 0,
    precip: "none",
  };

  readonly puffs: CloudPuff[] = [];
  readonly thermals: CloudThermal[] = [];

  age = 0;
  private thermalTimer = 0;
  private weatherSeedStage = 0;
  private readonly targetVolumeSize = new THREE.Vector3(420, 320, 340);
  private targetVolumeBase = 500;
  private testVolumeLocked = false;
  private stormSeedWidth = 500;
  private stormSeedDepth = 420;
  private stormSeedTop = 1240;

  constructor(x: number, z: number, options: { condensationLevel?: number; humidity?: number; instability?: number } = {}) {
    this.condensationLevel = options.condensationLevel ?? 540;
    this.humidity = options.humidity ?? 0.6;
    this.instability = options.instability ?? 0.4;
    this.position.set(x, this.condensationLevel, z);
    this.baseHeight = this.condensationLevel;
    this.topHeight = this.condensationLevel;
    this.inversionHeight = this.condensationLevel + convectiveDepth(this.instability);
    this.convectiveShape = createConvectiveShapeState(this.shapeSeed);
    this.targetVolumeBase = this.condensationLevel - 40;
    this.volumeBoundsMin.y = this.targetVolumeBase;
    this.syncVolumeOrigin();
  }

  // --- API commandes --------------------------------------------------------

  setInstability(v: number): void {
    this.instability = Math.max(0, Math.min(1, v));
    this.inversionHeight = this.condensationLevel + convectiveDepth(this.instability);
  }

  /** Coup de pouce d'humidité + bouffée de thermiques (bourgeonnement). */
  grow(): void {
    this.humidity = Math.min(1, this.humidity + 0.25);
    for (let i = 0; i < 3; i += 1) this.spawnThermal();
  }

  makeCumulonimbus(): void {
    this.humidity = 1;
    this.setInstability(0.95);
    for (let i = 0; i < 5; i += 1) this.spawnThermal();
  }

  /** Force l'enclume : plafonne la croissance et étale le sommet au vent. */
  forceAnvil(windX = 14, windZ = 0): void {
    this.setInstability(Math.max(this.instability, 0.8));
    this.upperWind.set(windX, 0, windZ);
    this.lifecycle = CloudLifecycle.ANVIL;
    for (const puff of this.puffs) {
      if (puff.position.y > this.inversionHeight - 70) this.convertToAnvil(puff);
    }
  }

  dissipate(): void {
    this.lifecycle = CloudLifecycle.DISSIPATING;
    this.humidity = 0;
    this.thermals.length = 0;
  }

  /** Keeps an organised cloud visually aligned with its owning weather event. */
  syncWeatherVisual(options: {
    eventId: number;
    kind: Exclude<StormVisualKind, "convective">;
    radius: number;
    intensity: number;
    development: number;
    windX: number;
    windZ: number;
    precip: PrecipKind;
    warmStart?: boolean;
  }): void {
    const isNewWeatherEvent = options.eventId !== this.stormVisual.eventId;
    if (isNewWeatherEvent) {
      this.stormSeedWidth = THREE.MathUtils.clamp(this.volumeBoundsSize.x, 420, 900);
      this.stormSeedDepth = THREE.MathUtils.clamp(this.volumeBoundsSize.z, 340, 780);
      this.stormSeedTop = THREE.MathUtils.clamp(
        this.volumeBoundsMin.y + this.volumeBoundsSize.y,
        this.condensationLevel + 500,
        1600,
      );
      this.weatherSeedStage = 0;
    }
    this.stormVisual.eventId = options.eventId;
    this.stormVisual.kind = options.kind;
    this.stormVisual.radius = Math.max(250, options.radius);
    this.stormVisual.intensity = clamp01(options.intensity);
    this.stormVisual.development = clamp01(options.development);
    this.stormVisual.precip = options.precip;
    this.testVolumeLocked = false;

    this.upperWind.set(options.windX, 0, options.windZ);
    const stage = options.development < 0.2 ? 0 : options.development < 0.48 ? 1 : options.development < 0.76 ? 2 : 3;
    if (stage > this.weatherSeedStage) {
      // Ajoute de vraies ascendances, sans remplacer la masse par un preset.
      // Le passage cumulus -> congestus -> CB reste donc visible et unique.
      const thermalBurst = stage === 1 ? 2 : stage === 2 ? 4 : 3;
      for (let i = 0; i < thermalBurst && this.thermals.length < 9; i += 1) this.spawnThermal();
      this.weatherSeedStage = stage;
    }

    const stormBudget = options.kind === "supercell" ? 520 : options.kind === "squall" ? 470 : 420;
    this.puffBudget = Math.max(this.puffBudget, Math.round(THREE.MathUtils.lerp(180, stormBudget, options.development)));
    this.humidity = Math.max(this.humidity, 0.82 + options.intensity * 0.16);
    this.setInstability(Math.max(this.instability, 0.48 + options.development * 0.47));
    this.configureStormVolume();
    if (isNewWeatherEvent && options.warmStart && options.development >= 0.28) {
      this.convectiveShape.development = options.development;
      this.convectiveShape.anvilGrowth = THREE.MathUtils.smoothstep(options.development, 0.66, 0.94);
      this.maturity = Math.max(this.maturity, options.development);
      for (let index = 0; index < this.convectiveShape.updrafts.length; index += 1) {
        const updraft = this.convectiveShape.updrafts[index];
        const born = THREE.MathUtils.smoothstep(options.development, updraft.onset, updraft.onset + 0.18);
        updraft.strength = Math.max(updraft.strength, index === 0 ? 0.65 + born * 0.3 : born * 0.7);
        updraft.radius = Math.max(updraft.radius, 0.16 + born * 0.11);
      }
      this.volumeBoundsSize.copy(this.targetVolumeSize);
      this.volumeBoundsMin.y = this.targetVolumeBase;
      this.syncVolumeOrigin();
    }
    this.precipitationRate = Math.max(
      this.precipitationRate,
      options.intensity
        * THREE.MathUtils.smoothstep(options.development, 0.6, 0.86)
        * THREE.MathUtils.smoothstep(this.maturity, 0.18, 0.72),
    );
  }

  /** Seeds an immediately readable test volume; normal lifecycle resumes after it. */
  primeForTest(profile: CloudTestProfile): void {
    this.testVolumeLocked = true;
    this.puffs.length = 0;
    this.thermals.length = 0;
    this.age = 10;
    this.humidity = profile === "cumulus" ? 0.65 : 0.98;
    this.instability = profile === "cumulus" ? 0.35 : profile === "congestus" ? 0.48 : 0.96;
    this.inversionHeight = this.condensationLevel + (profile === "cumulus" ? 90 : profile === "congestus" ? 360 : 1000);
    this.lifecycle = profile === "cumulus"
      ? CloudLifecycle.CUMULUS
      : profile === "congestus"
        ? CloudLifecycle.CUMULUS_CONGESTUS
        : profile === "anvil"
          ? CloudLifecycle.ANVIL
          : CloudLifecycle.CUMULONIMBUS;
    if (profile === "cumulonimbus" || profile === "anvil" || profile === "rainshaft") {
      this.upperWind.set(18, 0, 3);
    }

    const count = profile === "cumulus" ? 34 : profile === "congestus" ? 82 : 170;
    for (let i = 0; i < count; i += 1) {
      const height = (i + 0.5) / count;
      const angle = i * 2.399963229728653;
      // Bases LARGES → masses trapues, pas des colonnes (congestus surtout).
      const baseRadius = profile === "cumulus"
        ? 140
        : profile === "congestus"
          ? 320 * (1 - height * 0.2)
          : 440 * (1 - height * 0.42);
      const radial = Math.sqrt(((i * 73) % count) / count) * baseRadius;
      const verticalExtent = profile === "anvil" ? 1 : profile === "cumulonimbus" || profile === "rainshaft" ? 0.82 : 1;
      const y = this.condensationLevel + height * verticalExtent * (this.inversionHeight - this.condensationLevel);
      const puff = this.spawnPuff(
        this.position.x + Math.cos(angle) * radial,
        y,
        this.position.z + Math.sin(angle) * radial,
        profile === "cumulus" ? 54 : profile === "congestus" ? 62 : 78,
      );
      puff.radius = puff.targetRadius;
      puff.growth = 1;
      puff.density = 0.78 + ((i * 17) % 19) / 100;
      puff.maxAge = 600;
    }

    if (profile === "anvil") {
      for (let i = 0; i < 70; i += 1) {
        const across = (((i * 29) % 71) / 70 - 0.5) * 850;
        const downwind = ((i * 43) % 73) / 72 * 1500 - 180;
        const puff = this.spawnPuff(
          this.position.x + downwind,
          this.inversionHeight - 40 + (((i * 11) % 17) - 8) * 2,
          this.position.z + across,
          95,
        );
        puff.radius = puff.targetRadius;
        puff.flatten = 0.32;
        puff.isAnvil = true;
        puff.growth = 1;
        puff.density = 0.82;
        puff.maxAge = 600;
      }
    }

    this.maturity = profile === "cumulus" ? 0.35 : profile === "congestus" ? 0.65 : 1;
    this.precipitationRate = profile === "rainshaft" ? 1 : profile === "cumulonimbus" || profile === "anvil" ? 0.55 : 0;
    this.convectiveShape.development = profile === "cumulus" ? 0.12 : profile === "congestus" ? 0.48 : 0.94;
    this.convectiveShape.phase = profile === "cumulus"
      ? ConvectiveVisualPhase.FAIR_CUMULUS
      : profile === "congestus"
        ? ConvectiveVisualPhase.TOWERING_CUMULUS
        : profile === "anvil"
          ? ConvectiveVisualPhase.ANVIL_REMAINS
          : ConvectiveVisualPhase.CB_MATURE;
    this.convectiveShape.anvilGrowth = profile === "anvil" ? 1 : profile === "cumulonimbus" || profile === "rainshaft" ? 0.72 : 0;
    for (const updraft of this.convectiveShape.updrafts) {
      updraft.strength = profile === "cumulus" ? 0.45 : profile === "congestus" ? 0.78 : 1;
      updraft.radius = profile === "cumulus" ? 0.17 : profile === "congestus" ? 0.24 : 0.3;
    }
    this.updateBounds();
    const testBounds = profile === "cumulus"
      ? { width: 760, depth: 620, top: 1500 }
      : profile === "congestus"
        ? { width: 1900, depth: 1550, top: 4500 }
        : profile === "anvil"
          ? { width: 14_000, depth: 7200, top: 11_500 }
          : { width: 6500, depth: 5200, top: 10_500 };
    this.setVolumeTarget(500, testBounds.top, testBounds.width, testBounds.depth, true);
  }

  /** Déplace tout le nuage (base + puffs + thermiques) — pour suivre un événement. */
  translate(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    this.position.x += dx;
    this.position.z += dz;
    for (const p of this.puffs) {
      p.position.x += dx;
      p.position.z += dz;
    }
    for (const th of this.thermals) {
      th.position.x += dx;
      th.position.z += dz;
    }
    this.volumeBoundsMin.x += dx;
    this.volumeBoundsMin.z += dz;
  }

  /** Absorbe une masse arrivée au contact sans recréer sa forme. */
  absorb(other: CloudMass): void {
    if (other === this || other.puffs.length === 0) return;
    const room = Math.max(0, this.puffBudget - this.puffs.length);
    if (room <= 0) {
      other.dissipate();
      return;
    }
    this.puffs.push(...other.puffs.splice(0, room));
    this.humidity = Math.max(this.humidity, other.humidity);
    this.instability = Math.max(this.instability, other.instability);
    other.thermals.length = 0;
    if (other.puffs.length === 0) other.lifecycle = CloudLifecycle.DISSIPATED;
    else other.dissipate();
    this.updateBounds();
  }

  // --- Simulation -----------------------------------------------------------

  step(dt: number, env: CloudEnvironment): void {
    this.age += dt;

    this.updateThermals(dt);
    this.updatePuffs(dt, env);
    this.updateBounds();
    this.updateAtmosphericVolume(dt);
    this.updateLifecycle(dt);
    this.updateAnvilAndPrecip(dt);
    this.updateConvectiveShape(dt);
  }

  /** Émission des thermiques depuis la base tant que le nuage se développe. */
  private updateThermals(dt: number): void {
    const maxActive = 3 + Math.round(this.instability * 5);
    // Un CB/enclume mûr CONTINUE d'être alimenté par les updrafts (sinon les
    // puffs vieillissent et le nuage s'évapore en ~40 s).
    const sustaining = isGrowing(this.lifecycle) || this.lifecycle === CloudLifecycle.ANVIL;
    const canEmit =
      sustaining && this.humidity > 0.25 && this.puffs.length < this.puffBudget && this.thermals.length < maxActive;
    this.thermalTimer -= dt;
    if (canEmit && this.thermalTimer <= 0) {
      this.thermalTimer = THERMAL_INTERVAL * (0.6 + Math.random() * 0.8);
      this.spawnThermal();
    }

    for (let i = this.thermals.length - 1; i >= 0; i -= 1) {
      const th = this.thermals[i];
      th.age += dt;
      // Montée : accélérée par l'instabilité, freinée près de l'inversion.
      const ceiling = 1 - smoothstep(this.inversionHeight - 80, this.inversionHeight, th.position.y);
      th.verticalVelocity += (this.instability * 22 * ceiling - GRAVITY_DRAG) * dt;
      th.position.y += th.verticalVelocity * dt;
      // Léger serpentement horizontal (les tours ne montent pas droites).
      th.position.x += Math.sin(th.age * 1.7 + th.strength * 9) * 4 * dt;
      th.position.z += Math.cos(th.age * 1.5 + th.strength * 7) * 4 * dt;

      // Dépose une GRAPPE de puffs (donne de la largeur à la tour, pas un fil).
      if (th.position.y - th.lastPuffY >= PUFF_SPACING && this.puffs.length < this.puffBudget) {
        th.lastPuffY = th.position.y;
        const r = (20 + this.humidity * 24) * (0.7 + th.strength * 0.5);
        for (let s = 0; s < 3 && this.puffs.length < this.puffBudget; s += 1) {
          const off = s === 0 ? 0 : r * (0.7 + Math.random() * 0.8);
          const a = Math.random() * Math.PI * 2;
          const pr = s === 0 ? r : r * (0.6 + Math.random() * 0.35);
          const puff = this.spawnPuff(
            th.position.x + Math.cos(a) * off,
            th.position.y + (Math.random() - 0.5) * r * 0.4,
            th.position.z + Math.sin(a) * off,
            pr,
          );
          puff.velocity.y = th.verticalVelocity * 0.4;
        }
      }

      if (th.verticalVelocity < 1.5 || th.position.y > this.inversionHeight || th.age > 32) {
        this.thermals.splice(i, 1);
      }
    }
  }

  private updatePuffs(dt: number, env: CloudEnvironment): void {
    const axisX = this.position.x;
    const axisZ = this.position.z;
    const span = Math.max(40, this.width);

    for (let i = this.puffs.length - 1; i >= 0; i -= 1) {
      const p = this.puffs[i];
      p.age += dt;
      p.budCooldown -= dt;

      // Croissance du rayon et de la maturité (selon humidité).
      p.growth = Math.min(1, p.growth + (0.18 + this.humidity * 0.35) * dt);
      p.radius += (p.targetRadius - p.radius) * Math.min(1, dt * 1.2);

      // Convection : flottabilité, plus forte au centre, nulle vers l'inversion.
      if (!p.isAnvil) {
        const dx = p.position.x - axisX;
        const dz = p.position.z - axisZ;
        const centrality = 1 - Math.min(1, Math.hypot(dx, dz) / span);
        const ceiling = 1 - smoothstep(this.condensationLevel, this.inversionHeight, p.position.y);
        const buoyancy = this.instability * (0.35 + 0.65 * centrality) * ceiling;
        p.velocity.y += buoyancy * 16 * dt;
        // Étalement horizontal en montant (le nuage s'évase, reste bombé).
        if (span > 1) {
          p.velocity.x += (dx / span) * 1.5 * dt;
          p.velocity.z += (dz / span) * 1.5 * dt;
        }
      } else {
        // Enclume : advection par le vent d'altitude, aplatissement.
        p.velocity.x += (this.upperWind.x - p.velocity.x) * Math.min(1, dt);
        p.velocity.z += (this.upperWind.z - p.velocity.z) * Math.min(1, dt);
        p.velocity.y *= 1 - Math.min(1, dt * 2);
        p.flatten += (0.4 - p.flatten) * Math.min(1, dt * 0.6);
      }

      // Intégration + amortissement.
      p.velocity.multiplyScalar(1 - Math.min(1, GRAVITY_DRAG * 0.4 * dt));
      p.position.addScaledVector(p.velocity, dt);

      // Bourgeonnement : crée des enfants au-dessus (aspect chou-fleur).
      this.tryBud(p);

      // Base PLATE : les puffs sous le niveau de condensation s'évaporent.
      if (p.position.y < this.condensationLevel - 4) {
        p.erosion += 0.8 * dt;
      }

      // Érosion : air sec + petits puffs + dissipation rongent les bords.
      const dryness = (1 - this.humidity) * 0.18;
      const small = p.targetRadius < 16 ? 0.06 : 0;
      const dissip = this.lifecycle === CloudLifecycle.DISSIPATING ? 0.35 : 0;
      p.erosion = Math.min(1, p.erosion + (dryness + small + dissip) * dt);

      // Densité : monte avec la maturité, redescend avec l'érosion / fin de vie.
      const lifeFade = 1 - smoothstep(p.maxAge * 0.7, p.maxAge, p.age);
      const target = p.growth * (1 - p.erosion) * lifeFade;
      p.density += (target - p.density) * Math.min(1, dt * 1.5);

      // Couleurs : sommet plus blanc, base plus grise ; soleil éclaire un côté.
      const heightFrac = clamp01((p.position.y - this.condensationLevel) / Math.max(40, this.inversionHeight - this.condensationLevel));
      p.brightness = 0.55 + 0.45 * heightFrac;
      p.darkness = this.precipitationRate * (1 - heightFrac) * 0.85;

      if (p.faded || p.position.y < this.condensationLevel - 40) {
        this.puffs.splice(i, 1);
      }
    }
  }

  private tryBud(p: CloudPuff): void {
    if (
      p.budCooldown > 0 ||
      p.budsSpawned >= 3 ||
      p.growth < 0.5 ||
      p.isAnvil ||
      this.puffs.length >= this.puffBudget ||
      p.position.y > this.inversionHeight - 15 ||
      !isGrowing(this.lifecycle)
    ) {
      return;
    }
    const pulse = Math.sin(this.shapeSeed * 1.71 + p.age * 0.42 + p.position.y * 0.013) * 0.5 + 0.5;
    if (Math.random() > 0.28 + this.instability * 0.42 + pulse * 0.12) return;

    // Enfant au-dessus ET sur le côté (chou-fleur + épaisseur).
    const up = p.radius * (0.24 + Math.random() * 0.72);
    const preferredAngle = this.shapeSeed + p.position.y * 0.018 + p.budsSpawned * 2.39996;
    const spreadAngle = preferredAngle + (Math.random() - 0.5) * Math.PI * 1.35;
    const spread = p.radius * (0.3 + Math.random() * 1.15);
    const ox = Math.cos(spreadAngle) * spread;
    const oz = Math.sin(spreadAngle) * spread;
    const child = this.spawnPuff(p.position.x + ox, p.position.y + up, p.position.z + oz, p.targetRadius * (0.7 + Math.random() * 0.25));
    child.velocity.y = p.velocity.y * 0.6 + 2;
    p.budsSpawned += 1;
    p.budCooldown = 1.5 + Math.random() * 2;
  }

  private convertToAnvil(p: CloudPuff): void {
    p.isAnvil = true;
    p.velocity.set(this.upperWind.x, 0, this.upperWind.z);
  }

  private spawnThermal(): void {
    // Réparti sur un large disque de base → plusieurs tours côte à côte = masse
    // trapue, pas une tige unique.
    const column = this.thermals.length % (3 + Math.round(this.instability * 4));
    const ang = this.shapeSeed + column * 2.399963 + (Math.random() - 0.5) * 0.75;
    // Empreinte au sol proportionnelle à la TAILLE (budget) : petit cumulus =
    // base compacte et dense ; gros nuage = base large et trapue.
    const baseR = 40 + Math.min(180, this.puffBudget * 0.4);
    const dist = Math.sqrt(Math.random()) * baseR;
    const th = new CloudThermal(
      this.position.x + Math.cos(ang) * dist,
      this.condensationLevel - 8,
      this.position.z + Math.sin(ang) * dist,
      8 + Math.random() * 6,
      0.5 + Math.random() * 0.5,
      14 + this.instability * 22,
    );
    this.thermals.push(th);
  }

  private spawnPuff(x: number, y: number, z: number, targetRadius: number): CloudPuff {
    const puff = new CloudPuff(x, y, z, targetRadius, 30 + Math.random() * 40);
    this.puffs.push(puff);
    return puff;
  }

  private updateBounds(): void {
    if (this.puffs.length === 0) {
      this.topHeight = this.condensationLevel;
      return;
    }
    let top = this.condensationLevel;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of this.puffs) {
      top = Math.max(top, p.position.y + p.radius * 0.5);
      minX = Math.min(minX, p.position.x);
      maxX = Math.max(maxX, p.position.x);
      minZ = Math.min(minZ, p.position.z);
      maxZ = Math.max(maxZ, p.position.z);
    }
    this.topHeight = top;
    this.width = Math.max(30, maxX - minX);
    this.depth = Math.max(30, maxZ - minZ);
  }

  /**
   * Converts cloud evolution into world-space atmospheric dimensions. These
   * dimensions belong to the simulated mass; the renderer is not allowed to
   * replace or stretch them.
   */
  private updateAtmosphericVolume(dt: number): void {
    if (this.stormVisual.kind === "convective" && !this.testVolumeLocked) {
      const tower = Math.max(0, this.topHeight - this.condensationLevel);
      const congestus = this.lifecycle === CloudLifecycle.CUMULUS_CONGESTUS;
      const deep = isStormy(this.lifecycle);
      const targetWidth = deep
        ? THREE.MathUtils.clamp(Math.max(this.width * 2.8, 2500), 2500, 7000)
        : congestus
          ? THREE.MathUtils.clamp(Math.max(this.width * 2.7, 900), 900, 2200)
          : THREE.MathUtils.clamp(Math.max(this.width * 2.5, 350), 350, 900);
      const targetDepth = deep
        ? THREE.MathUtils.clamp(Math.max(this.depth * 2.5, 2200), 2200, 6000)
        : congestus
          ? THREE.MathUtils.clamp(Math.max(this.depth * 2.5, 760), 760, 1900)
          : THREE.MathUtils.clamp(Math.max(this.depth * 2.3, 300), 300, 780);
      const targetTop = deep
        ? THREE.MathUtils.clamp(this.condensationLevel + Math.max(5500, tower * 3.2), 6000, 11_000)
        : congestus
          ? THREE.MathUtils.clamp(this.condensationLevel + Math.max(1700, tower * 3.1), 2400, 5000)
          : THREE.MathUtils.clamp(this.condensationLevel + Math.max(360, tower * 3.1), 900, 1500);
      this.setVolumeTarget(this.condensationLevel - 40, targetTop, targetWidth, targetDepth);
    }

    const blend = 1 - Math.exp(-dt * 0.5);
    this.volumeBoundsSize.lerp(this.targetVolumeSize, blend);
    this.volumeBoundsSize.set(
      Math.max(1, this.volumeBoundsSize.x),
      Math.max(1, this.volumeBoundsSize.y),
      Math.max(1, this.volumeBoundsSize.z),
    );
    this.volumeBoundsMin.y = THREE.MathUtils.lerp(this.volumeBoundsMin.y, this.targetVolumeBase, blend);
    this.syncVolumeOrigin();
  }

  private configureStormVolume(): void {
    const storm = this.stormVisual;
    const towerGrowth = THREE.MathUtils.smoothstep(storm.development, 0.12, 0.58);
    const deepGrowth = THREE.MathUtils.smoothstep(storm.development, 0.5, 0.9);
    let fullWidth: number;
    let fullDepth: number;
    let fullTop: number;
    if (storm.kind === "squall") {
      fullWidth = THREE.MathUtils.clamp(storm.radius * 5.2, 10_000, 30_000);
      fullDepth = THREE.MathUtils.clamp(storm.radius * 2.2, 2500, 7000);
      fullTop = THREE.MathUtils.lerp(7500, 11_000, storm.intensity);
    } else if (storm.kind === "supercell") {
      // A supercell is a mesoscale system, not a single narrow tower. Keep a
      // broad inflow shelf and several kilometres of trailing precipitation.
      fullWidth = THREE.MathUtils.clamp(storm.radius * 5.8, 9000, 16_000);
      fullDepth = THREE.MathUtils.clamp(storm.radius * 4.2, 6500, 12_000);
      fullTop = THREE.MathUtils.lerp(8500, 12_000, storm.intensity);
    } else {
      fullWidth = THREE.MathUtils.clamp(storm.radius * 3.6, 2500, 7000);
      fullDepth = THREE.MathUtils.clamp(storm.radius * 2.8, 2200, 6000);
      fullTop = THREE.MathUtils.lerp(6500, 10_000, storm.intensity);
    }
    const toweringWidth = THREE.MathUtils.lerp(this.stormSeedWidth, 2100, towerGrowth);
    const toweringDepth = THREE.MathUtils.lerp(this.stormSeedDepth, 1700, towerGrowth);
    const toweringTop = THREE.MathUtils.lerp(this.stormSeedTop, 4700, towerGrowth);
    const base = THREE.MathUtils.lerp(this.condensationLevel - 40, 500, deepGrowth);
    const top = THREE.MathUtils.lerp(toweringTop, fullTop, deepGrowth);
    this.setVolumeTarget(
      base,
      top,
      THREE.MathUtils.lerp(toweringWidth, fullWidth, deepGrowth),
      THREE.MathUtils.lerp(toweringDepth, fullDepth, deepGrowth),
    );
    this.inversionHeight = Math.max(this.inversionHeight, top - 180);
  }

  private setVolumeTarget(base: number, top: number, width: number, depth: number, snap = false): void {
    this.targetVolumeBase = base;
    this.targetVolumeSize.set(Math.max(1, width), Math.max(1, top - base), Math.max(1, depth));
    if (!snap) return;
    this.volumeBoundsSize.copy(this.targetVolumeSize);
    this.volumeBoundsMin.y = base;
    this.syncVolumeOrigin();
  }

  private syncVolumeOrigin(): void {
    this.volumeBoundsMin.x = this.position.x - this.volumeBoundsSize.x * 0.5;
    this.volumeBoundsMin.z = this.position.z - this.volumeBoundsSize.z * 0.5;
  }

  private updateLifecycle(dt: number): void {
    if (this.testVolumeLocked) return;
    if (this.lifecycle === CloudLifecycle.DISSIPATING) {
      if (this.puffs.length === 0) this.lifecycle = CloudLifecycle.DISSIPATED;
      return;
    }
    if (this.lifecycle === CloudLifecycle.ANVIL || this.lifecycle === CloudLifecycle.DISSIPATED) {
      if (this.puffs.length === 0) this.lifecycle = CloudLifecycle.DISSIPATED;
      return;
    }

    if (this.stormVisual.kind !== "convective") {
      const development = this.stormVisual.development;
      this.maturity = Math.max(this.maturity, development);
      this.lifecycle = development < 0.18
        ? CloudLifecycle.FORMING
        : development < 0.46
          ? CloudLifecycle.CUMULUS_CONGESTUS
          : CloudLifecycle.CUMULONIMBUS;
      return;
    }

    const tower = this.topHeight - this.condensationLevel;
    this.maturity = clamp01(Math.min(tower / 300, this.puffs.length / 120));

    if (this.puffs.length < 8) this.lifecycle = CloudLifecycle.FORMING;
    else if (tower < 170 || this.instability < 0.42) this.lifecycle = CloudLifecycle.CUMULUS;
    else if (tower < 220 || this.instability < 0.5) this.lifecycle = CloudLifecycle.CUMULUS_CONGESTUS;
    else this.lifecycle = CloudLifecycle.CUMULONIMBUS;
  }

  private updateAnvilAndPrecip(dt: number): void {
    if (this.testVolumeLocked) return;
    // Enclume naturelle : un CB dont le sommet atteint l'inversion s'étale.
    if (this.lifecycle === CloudLifecycle.CUMULONIMBUS && this.topHeight >= this.inversionHeight - 30) {
      if (this.upperWind.lengthSq() < 1) this.upperWind.set(12, 0, 0);
      this.lifecycle = CloudLifecycle.ANVIL;
    }
    if (this.lifecycle === CloudLifecycle.ANVIL) {
      for (const p of this.puffs) {
        if (!p.isAnvil && p.position.y > this.inversionHeight - 70) this.convertToAnvil(p);
      }
    }

    // Précipitation : nuage mûr et profond → la base s'assombrit et s'assèche.
    const stormy = this.lifecycle === CloudLifecycle.CUMULONIMBUS || this.lifecycle === CloudLifecycle.ANVIL;
    const organised = this.stormVisual.kind !== "convective";
    const precipitationReadiness = organised
      ? THREE.MathUtils.smoothstep(this.stormVisual.development, 0.58, 0.86)
      : this.maturity;
    if (stormy && precipitationReadiness > 0.55) {
      this.precipitationRate = Math.min(1, this.precipitationRate + (precipitationReadiness - 0.55) * 0.4 * dt);
      // Lente vidange de l'humidité par la pluie → le CB tient plusieurs minutes.
      this.humidity = Math.max(0, this.humidity - this.precipitationRate * 0.005 * dt);
      if (this.humidity < 0.1 && this.precipitationRate > 0.45) this.lifecycle = CloudLifecycle.DISSIPATING;
    } else {
      this.precipitationRate = Math.max(0, this.precipitationRate - (organised ? 0.8 : 0.1) * dt);
    }
  }

  private updateConvectiveShape(dt: number): void {
    const shape = this.convectiveShape;
    const organised = this.stormVisual.kind !== "convective";
    const ambientCeiling = this.lifecycle === CloudLifecycle.CUMULUS_CONGESTUS
      ? 0.48
      : isStormy(this.lifecycle)
        ? 0.82
        : 0.24;
    const rawDevelopment = organised
      ? this.stormVisual.development
      : Math.min(ambientCeiling, this.maturity * ambientCeiling);
    const targetDevelopment = this.lifecycle === CloudLifecycle.DISSIPATING
      ? Math.max(0.28, rawDevelopment * 0.72)
      : clamp01(rawDevelopment);
    const response = 1 - Math.exp(-dt * (targetDevelopment > shape.development ? 0.24 : 0.1));
    shape.development = THREE.MathUtils.lerp(shape.development, targetDevelopment, response);

    if (this.lifecycle === CloudLifecycle.DISSIPATING) {
      shape.phase = shape.anvilGrowth > 0.35
        ? ConvectiveVisualPhase.ANVIL_REMAINS
        : ConvectiveVisualPhase.DECAYING;
    } else if (this.precipitationRate > 0.22 && shape.development > 0.68) {
      shape.phase = ConvectiveVisualPhase.PRECIPITATING;
    } else if (shape.development >= 0.78) {
      shape.phase = ConvectiveVisualPhase.CB_MATURE;
    } else if (shape.development >= 0.6) {
      shape.phase = ConvectiveVisualPhase.CB_CALVUS;
    } else if (shape.development >= 0.38) {
      shape.phase = ConvectiveVisualPhase.TOWERING_CUMULUS;
    } else if (shape.development >= 0.16) {
      shape.phase = ConvectiveVisualPhase.BUILDING_CUMULUS;
    } else {
      shape.phase = ConvectiveVisualPhase.FAIR_CUMULUS;
    }

    const anvilTarget = organised
      ? THREE.MathUtils.smoothstep(shape.development, 0.66, 0.94)
      : this.lifecycle === CloudLifecycle.ANVIL
        ? 1
        : 0;
    shape.anvilGrowth = THREE.MathUtils.lerp(shape.anvilGrowth, anvilTarget, 1 - Math.exp(-dt * 0.16));
    const decay = this.lifecycle === CloudLifecycle.DISSIPATING ? 0.72 : 0;
    shape.dryAirErosion = THREE.MathUtils.lerp(
      shape.dryAirErosion,
      clamp01((1 - this.humidity) * 0.7 + decay),
      1 - Math.exp(-dt * 0.12),
    );

    const windLength = Math.hypot(this.upperWind.x, this.upperWind.z);
    const windX = windLength > 0.01 ? this.upperWind.x / windLength : 1;
    const windZ = windLength > 0.01 ? this.upperWind.z / windLength : 0;
    const crossX = -windZ;
    const crossZ = windX;
    shape.precipitationCore.set(windX * 0.18 + crossX * 0.06, windZ * 0.18 + crossZ * 0.06);

    for (let index = 0; index < shape.updrafts.length; index += 1) {
      const updraft = shape.updrafts[index];
      const born = THREE.MathUtils.smoothstep(shape.development, updraft.onset, updraft.onset + 0.18);
      const dominant = index === 0 ? THREE.MathUtils.smoothstep(shape.development, 0.22, 0.58) : 0;
      const mergeFade = index > 2 ? 1 - THREE.MathUtils.smoothstep(shape.development, 0.72, 0.98) * 0.48 : 1;
      const seedStrength = index === 0 ? 0.3 : 0;
      const targetStrength = clamp01((seedStrength + born * 0.76 + dominant * 0.24) * mergeFade);
      updraft.strength = THREE.MathUtils.lerp(updraft.strength, targetStrength, 1 - Math.exp(-dt * 0.22));
      updraft.radius = THREE.MathUtils.lerp(
        updraft.radius,
        0.2 + born * 0.16 + dominant * 0.12,
        1 - Math.exp(-dt * 0.18),
      );
      const drift = 0.025 + shape.development * 0.035;
      const driftX = Math.sin(this.age * 0.027 + this.shapeSeed + index * 1.7) * drift;
      const driftZ = Math.cos(this.age * 0.023 + this.shapeSeed * 0.73 + index * 2.1) * drift;
      const convergence = index === 0 ? 0 : THREE.MathUtils.smoothstep(shape.development, 0.46, 0.92) * 0.18;
      const targetX = THREE.MathUtils.lerp(updraft.anchor.x, shape.updrafts[0].center.x, convergence) + driftX;
      const targetZ = THREE.MathUtils.lerp(updraft.anchor.y, shape.updrafts[0].center.y, convergence) + driftZ;
      updraft.center.x = THREE.MathUtils.lerp(updraft.center.x, targetX, 1 - Math.exp(-dt * 0.08));
      updraft.center.y = THREE.MathUtils.lerp(updraft.center.y, targetZ, 1 - Math.exp(-dt * 0.08));
    }
  }

  get dead(): boolean {
    return this.lifecycle === CloudLifecycle.DISSIPATED && this.puffs.length === 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function convectiveDepth(instability: number): number {
  return 180 + Math.pow(clamp01(instability), 1.35) * 760;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
