/**
 * WeatherScenarioDirector — le CERVEAU de l'atlas météo.
 *
 * Remplace le pilotage par timer + jets aléatoires par des PLANS PERSISTANTS :
 *  - sélectionne un scénario cohérent avec le contexte (saison, heure, biome,
 *    tendances) — voir {@link chooseScenario} ;
 *  - le déroule phase par phase (durées min/max), avec transitions douces ;
 *  - lisse des champs continus (couverture, humidité, instabilité, précip...) ;
 *  - APPLIQUE la scène au moteur existant en PEIGNANT le climat de fond des
 *    cellules (baseline) autour de l'observateur. La pluie n'est jamais posée
 *    arbitrairement : elle est DÉRIVÉE par {@link WeatherCell} de nuages épais
 *    + air humide, et l'orage d'instabilité + précipitation. Les ciels normaux
 *    (clair, voilé, cumulus, couvert sec, bruine, brume) émergent donc tout
 *    seuls, et un orage n'est qu'un résultat occasionnel parmi d'autres.
 *  - les éléments MOBILES (averse locale, front, cellule, ligne de grains) sont
 *    des événements discrets qui passent ; le fond reste, lui, plus sec.
 *
 * Aucune dépendance à Three.js : logique pure, testable headless.
 */

import { WeatherEngine } from "../WeatherEngine";
import { ColdFrontEvent } from "../events/ColdFrontEvent";
import { WarmFrontEvent } from "../events/WarmFrontEvent";
import { SquallLineEvent } from "../events/SquallLineEvent";
import { approach, clamp01 } from "../WeatherMath";
import { CELL_SIZE, PrecipKind } from "../WeatherTypes";
import { SCENARIOS, ScenarioPhase, SceneFeature } from "./WeatherScenarioData";
import { chooseScenario } from "./WeatherScenarioSelection";
import {
  PrecipitationKind,
  PrecipitationPattern,
  SkyState,
  SynopticRegime,
  WeatherContext,
  WeatherPlan,
  WeatherSceneState,
  WeatherScenario,
  isSnowPrecip,
  precipitationKindToEngine,
} from "./WeatherScene";
import {
  buildSceneState,
  EasedSceneFields,
  targetFields,
} from "./WeatherSceneDeriver";

const PAINT_RADIUS_CELLS = 11;
const PAINT_INTERVAL = 0.5;
const GRID_INTERVAL = 6;

/** Vitesses de lissage des champs (unités/s). Lent = transitions crédibles. */
const EASE_RATE = {
  cloudCover: 0.05,
  humidity: 0.045,
  instability: 0.06,
  thunder: 0.09,
  clearingBias: 0.05,
  precipIntensity: 0.06,
  visibilityRange: 0.07,
  fogDensity: 0.06,
  haze: 0.05,
  desaturation: 0.05,
  windSpeed: 1.4,
  gustiness: 0.3,
  surfaceTemperature: 0.4,
  convectivePotential: 0.08,
} as const;

export interface ScenarioForceOptions {
  /** Démarre à cette phase (0 par défaut). */
  startPhase?: number;
  /** Saute directement aux valeurs cibles (commande/test : visible vite). */
  immediate?: boolean;
}

export interface WeatherEnvironmentInput {
  season?: WeatherContext["season"];
  timeOfDay?: number;
  biomeHumidity?: number;
  biomeTemperature?: number;
  altitude?: number;
  terrainLift?: number;
  surfaceWetness?: number;
  snowCover?: number;
  pressureTrend?: number;
}

export class WeatherScenarioDirector {
  private plan: WeatherPlan;
  private scene: WeatherSceneState;
  private eased: EasedSceneFields;

  private currentSky: SkyState = SkyState.CRYSTAL_CLEAR;
  private toSky: SkyState = SkyState.CRYSTAL_CLEAR;
  private transitionProgress = 0;
  private transitionDuration = 0;

  private phaseTimer = 0;
  private phaseDuration = 0;
  private readonly recent: WeatherScenario[] = [];

  private flowX = 0;
  private flowZ = 1;
  private targetFlowX = 0;
  private targetFlowZ = 1;

  private paintTimer = 0;
  private gridTimer = 0;
  private hardPaintTimer = 0;

  /** Cinématiques : mode passif (le directeur ne peint/spawn rien). */
  private passiveTimer = 0;
  private passiveSynoptic: SynopticRegime | null = null;

  /** Élément mobile actif et l'id de l'événement qui le matérialise. */
  private activeFeature: SceneFeature = "none";
  private activeFeatureEventId = -1;

  /** Phases de remplacement (forceSky) — sinon on utilise celles du scénario. */
  private overridePhases: ScenarioPhase[] | null = null;
  private precipitationOverride: {
    kind: PrecipitationKind;
    intensity: number;
    seconds: number;
    pattern: PrecipitationPattern;
    reachesGround: boolean;
  } | null = null;

  private env: Required<WeatherEnvironmentInput> = {
    season: "SPRING",
    timeOfDay: 0.5,
    biomeHumidity: 0.45,
    biomeTemperature: 14,
    altitude: 64,
    terrainLift: 0,
    surfaceWetness: 0,
    snowCover: 0,
    pressureTrend: 0,
  };

  /** Garantie d'accumulation au sol pour neige soufflée / grésil (commandes). */
  onForcePrecip: ((kind: PrecipKind, intensity: number, seconds: number) => void) | null = null;

  private rng: () => number = Math.random;

  constructor(private readonly engine: WeatherEngine) {
    this.eased = targetFields(SkyState.CRYSTAL_CLEAR, this.context());
    this.plan = this.buildPlan(WeatherScenario.CLEAR_DAY);
    this.enterPhase(0, true);
    this.scene = this.snapshot();
  }

  // --- API publique ---------------------------------------------------------

  setEnvironment(env: WeatherEnvironmentInput): void {
    Object.assign(this.env, env);
  }

  setRng(rng: () => number): void {
    this.rng = rng;
  }

  reset(): void {
    this.recent.length = 0;
    this.passiveTimer = 0;
    this.passiveSynoptic = null;
    this.activeFeature = "none";
    this.activeFeatureEventId = -1;
    this.precipitationOverride = null;
    this.chooseFlow(true);
    this.eased = targetFields(SkyState.CRYSTAL_CLEAR, this.context());
    this.plan = this.buildPlan(WeatherScenario.CLEAR_DAY);
    this.enterPhase(0, true);
    this.scene = this.snapshot();
  }

  /** Force un scénario complet (commande /weather scenario, tests). */
  forceScenario(scenario: WeatherScenario, options: ScenarioForceOptions = {}): void {
    this.passiveTimer = 0;
    this.passiveSynoptic = null;
    this.overridePhases = null;
    this.activeFeatureEventId = -1;
    this.precipitationOverride = null;
    this.plan = this.buildPlan(scenario);
    this.rememberScenario(scenario);
    this.enterPhase(options.startPhase ?? 0, true);
    if (options.immediate !== false) {
      this.eased = targetFields(this.currentSky, this.context());
      this.hardPaintTimer = 2.5;
    }
    this.scene = this.snapshot();
  }

  /** Pin un seul état de ciel pour `seconds` (presets storm_overhead, etc.). */
  forceSky(sky: SkyState, seconds = 220, feature?: SceneFeature): void {
    this.passiveTimer = 0;
    this.passiveSynoptic = null;
    this.activeFeatureEventId = -1;
    this.overridePhases = [{ sky, min: seconds, max: seconds, milestone: "forced-sky", feature }];
    this.plan = this.buildPlan(WeatherScenario.CLEAR_DAY);
    this.plan.expectedDuration = seconds;
    this.plan.nextScenarioCandidates = [];
    this.enterPhase(0, true);
    this.eased = targetFields(sky, this.context());
    this.hardPaintTimer = 2.5;
    this.scene = this.snapshot();
  }

  forcePrecipitation(
    kind: PrecipitationKind,
    intensity: number,
    seconds = 180,
    pattern: PrecipitationPattern = "uniform",
    reachesGround = true,
  ): void {
    this.precipitationOverride = {
      kind,
      intensity: clamp01(intensity),
      seconds: Math.max(1, seconds),
      pattern,
      reachesGround,
    };
    this.scene = this.snapshot();
  }

  /** Mode passif (cinématiques) : ne peint/spawn rien pendant `seconds`. */
  hold(synoptic: SynopticRegime, seconds = 900): void {
    this.passiveTimer = Math.max(1, seconds);
    this.passiveSynoptic = synoptic;
  }

  get currentScene(): WeatherSceneState {
    return this.scene;
  }

  get activePlan(): WeatherPlan {
    return this.plan;
  }

  get phaseSecondsLeft(): number {
    return Math.max(0, this.phaseTimer);
  }

  get flow(): { x: number; z: number } {
    return { x: this.flowX, z: this.flowZ };
  }

  get recentScenarios(): readonly WeatherScenario[] {
    return this.recent;
  }

  get currentMilestone(): string {
    return this.currentPhase()?.milestone ?? "-";
  }

  get scenarioId(): WeatherScenario {
    return this.plan.scenario;
  }

  get phaseIndex(): number {
    return this.plan.phaseIndex;
  }

  get isPassive(): boolean {
    return this.passiveTimer > 0;
  }

  update(dt: number): void {
    this.gridTimer -= dt;
    if (this.gridTimer <= 0) {
      this.gridTimer = GRID_INTERVAL;
      this.ensureRegionalCells();
    }

    if (this.passiveTimer > 0) {
      this.passiveTimer -= dt;
      this.scene = this.snapshot();
      return;
    }

    this.advanceTimeline(dt);
    this.easeFields(dt);
    this.easeFlow(dt);
    if (this.precipitationOverride) {
      this.precipitationOverride.seconds -= dt;
      if (this.precipitationOverride.seconds <= 0) this.precipitationOverride = null;
    }
    this.scene = this.snapshot();
    this.applyScene(dt);
  }

  // --- Déroulé du plan ------------------------------------------------------

  private phasesOf(): readonly ScenarioPhase[] {
    return this.overridePhases ?? SCENARIOS[this.plan.scenario].phases;
  }

  private advanceTimeline(dt: number): void {
    this.phaseTimer -= dt;
    this.plan.phaseProgress = clamp01(1 - this.phaseTimer / Math.max(0.001, this.phaseDuration));

    const phases = this.phasesOf();
    const upcoming = phases[this.plan.phaseIndex + 1];
    const window = Math.min(50, this.phaseDuration * 0.4);
    if (upcoming && this.phaseTimer <= window) {
      this.toSky = upcoming.sky;
      this.transitionProgress = clamp01(1 - this.phaseTimer / Math.max(0.001, window));
      this.transitionDuration = window;
    } else {
      this.toSky = this.currentSky;
      this.transitionProgress = 0;
      this.transitionDuration = 0;
    }

    if (this.phaseTimer <= 0) this.advancePhase();
  }

  private advancePhase(): void {
    const phases = this.phasesOf();
    if (this.plan.phaseIndex + 1 < phases.length) {
      this.enterPhase(this.plan.phaseIndex + 1, false);
      return;
    }
    // Plan terminé : on choisit un scénario suivant cohérent et on enchaîne.
    this.overridePhases = null;
    this.activeFeatureEventId = -1;
    const next = chooseScenario(this.plan.scenario, this.context(), this.rng, this.recent);
    this.plan = this.buildPlan(next);
    this.rememberScenario(next);
    this.chooseFlow(false);
    this.enterPhase(0, false);
  }

  private enterPhase(index: number, resetFlow: boolean): void {
    const phases = this.phasesOf();
    const clamped = Math.max(0, Math.min(phases.length - 1, index));
    const phase = phases[clamped];
    this.plan.phaseIndex = clamped;
    this.plan.phaseProgress = 0;
    this.currentSky = phase.sky;
    this.toSky = phase.sky;
    this.transitionProgress = 0;
    this.phaseDuration = phase.min + this.rng() * (phase.max - phase.min);
    this.phaseTimer = this.phaseDuration;
    // Nouveau ciel → l'élément mobile éventuel devra être (re)déclenché.
    this.activeFeature = "none";
    if (resetFlow) this.chooseFlow(true);
  }

  private buildPlan(scenario: WeatherScenario): WeatherPlan {
    const def = SCENARIOS[scenario];
    const expected = def.phases.reduce((sum, p) => sum + (p.min + p.max) * 0.5, 0);
    return {
      id: `plan-${scenario}-${Math.floor(this.rng() * 1e6)}`,
      seed: Math.floor(this.rng() * 0x7fffffff),
      scenario,
      startedAt: this.engine.state.time,
      expectedDuration: expected,
      phaseIndex: 0,
      phaseProgress: 0,
      nextScenarioCandidates: [...def.next],
      temperatureTrend: 0,
      humidityTrend: 0,
      pressureTrend: this.env.pressureTrend,
      windTrend: 0,
      convectivePotential: 0,
    };
  }

  // --- Lissage --------------------------------------------------------------

  private easeFields(dt: number): void {
    const ctx = this.context();
    const a = targetFields(this.currentSky, ctx);
    const b = this.toSky !== this.currentSky ? targetFields(this.toSky, ctx) : a;
    const t = this.transitionProgress;
    const target: EasedSceneFields = {
      cloudCover: lerp(a.cloudCover, b.cloudCover, t),
      humidity: lerp(a.humidity, b.humidity, t),
      instability: lerp(a.instability, b.instability, t),
      thunder: lerp(a.thunder, b.thunder, t),
      clearingBias: lerp(a.clearingBias, b.clearingBias, t),
      precipIntensity: lerp(a.precipIntensity, b.precipIntensity, t),
      visibilityRange: lerp(a.visibilityRange, b.visibilityRange, t),
      fogDensity: lerp(a.fogDensity, b.fogDensity, t),
      haze: lerp(a.haze, b.haze, t),
      desaturation: lerp(a.desaturation, b.desaturation, t),
      windSpeed: lerp(a.windSpeed, b.windSpeed, t),
      gustiness: lerp(a.gustiness, b.gustiness, t),
      surfaceTemperature: lerp(a.surfaceTemperature, b.surfaceTemperature, t),
      convectivePotential: lerp(a.convectivePotential, b.convectivePotential, t),
    };
    const e = this.eased;
    e.cloudCover = approach(e.cloudCover, target.cloudCover, EASE_RATE.cloudCover, dt);
    e.humidity = approach(e.humidity, target.humidity, EASE_RATE.humidity, dt);
    e.instability = approach(e.instability, target.instability, EASE_RATE.instability, dt);
    e.thunder = approach(e.thunder, target.thunder, EASE_RATE.thunder, dt);
    e.clearingBias = approach(e.clearingBias, target.clearingBias, EASE_RATE.clearingBias, dt);
    e.precipIntensity = approach(e.precipIntensity, target.precipIntensity, EASE_RATE.precipIntensity, dt);
    e.visibilityRange = approach(e.visibilityRange, target.visibilityRange, EASE_RATE.visibilityRange, dt);
    e.fogDensity = approach(e.fogDensity, target.fogDensity, EASE_RATE.fogDensity, dt);
    e.haze = approach(e.haze, target.haze, EASE_RATE.haze, dt);
    e.desaturation = approach(e.desaturation, target.desaturation, EASE_RATE.desaturation, dt);
    e.windSpeed = approach(e.windSpeed, target.windSpeed, EASE_RATE.windSpeed, dt);
    e.gustiness = approach(e.gustiness, target.gustiness, EASE_RATE.gustiness, dt);
    e.surfaceTemperature = approach(e.surfaceTemperature, target.surfaceTemperature, EASE_RATE.surfaceTemperature, dt);
    e.convectivePotential = approach(e.convectivePotential, target.convectivePotential, EASE_RATE.convectivePotential, dt);
  }

  private easeFlow(dt: number): void {
    this.flowX = approach(this.flowX, this.targetFlowX, 0.18, dt);
    this.flowZ = approach(this.flowZ, this.targetFlowZ, 0.18, dt);
    const len = Math.hypot(this.flowX, this.flowZ) || 1;
    this.flowX /= len;
    this.flowZ /= len;
  }

  private chooseFlow(immediate: boolean): void {
    const angle = this.rng() * Math.PI * 2;
    this.targetFlowX = Math.cos(angle);
    this.targetFlowZ = Math.sin(angle);
    if (immediate) {
      this.flowX = this.targetFlowX;
      this.flowZ = this.targetFlowZ;
    }
  }

  private snapshot(): WeatherSceneState {
    const reportedSky = this.transitionProgress >= 0.5 ? this.toSky : this.currentSky;
    const scene = buildSceneState(
      reportedSky,
      { from: this.currentSky, to: this.toSky, progress: this.transitionProgress, durationSeconds: this.transitionDuration },
      this.eased,
      this.context(),
      this.flowX,
      this.flowZ,
    );
    if (this.passiveSynoptic) scene.synopticRegime = this.passiveSynoptic;
    if (this.precipitationOverride) {
      const override = this.precipitationOverride;
      scene.precipitation = {
        kind: override.kind,
        intensity: override.intensity,
        spatialPattern: override.pattern,
        beginsAtCloudBase: true,
        reachesGround: override.reachesGround,
        virga: !override.reachesGround,
        windTilt: clamp01(scene.wind.speed / 26) * 0.65,
      };
    }
    return scene;
  }

  // --- Application au moteur ------------------------------------------------

  private applyScene(dt: number): void {
    const scene = this.scene;
    // Vent : canal officiel (le baseline vent est réinjecté par le moteur).
    this.engine.setWind(scene.wind.dirX * scene.wind.speed, scene.wind.dirZ * scene.wind.speed);

    this.hardPaintTimer = Math.max(0, this.hardPaintTimer - dt);
    this.paintTimer -= dt;
    if (this.paintTimer <= 0) {
      const step = PAINT_INTERVAL;
      this.paintTimer = PAINT_INTERVAL;
      this.paintCells(step, this.hardPaintTimer > 0);
    }

    this.manageFeature();
    this.manageGround();
  }

  /** Peigne le climat de fond des cellules autour de l'observateur. */
  private paintCells(step: number, hard: boolean): void {
    const o = this.engine.getObserver();
    const baseCellX = Math.floor(o.x / CELL_SIZE);
    const baseCellZ = Math.floor(o.z / CELL_SIZE);
    const e = this.eased;
    const snowing = isSnowPrecip(this.scene.precipitation.kind);
    const tempTarget = snowing ? Math.min(e.surfaceTemperature, -1.5) : e.surfaceTemperature;

    for (let dz = -PAINT_RADIUS_CELLS; dz <= PAINT_RADIUS_CELLS; dz += 1) {
      for (let dx = -PAINT_RADIUS_CELLS; dx <= PAINT_RADIUS_CELLS; dx += 1) {
        const cell = this.engine.getCellAt((baseCellX + dx) * CELL_SIZE + 1, (baseCellZ + dz) * CELL_SIZE + 1);
        // Variation spatiale douce : trouées bleues, couvert non parfait.
        const variation = (hash01(cell.cellX, cell.cellZ) - 0.5) * 0.1;
        const cover = clamp01(e.cloudCover + variation * (e.cloudCover < 0.9 ? 1 : 0.3));
        let humid = clamp01(e.humidity + variation * 0.6);
        const instab = clamp01(e.instability + variation * 0.4);

        if (this.precipitationOverride?.kind === PrecipitationKind.NONE && this.precipitationOverride.intensity <= 0) {
          humid = Math.min(humid, cover > 0.78 ? 0.58 : 0.6);
        }

        cell.baseline.cloudCover = cover;
        cell.baseline.humidity = humid;
        cell.baseline.instability = instab;
        cell.baseline.temperature = tempTarget;

        if (hard) {
          cell.cloudCover = cover;
          cell.humidity = humid;
          cell.instability = instab;
          cell.temperature = tempTarget;
          cell.clearingBias = e.clearingBias;
        } else {
          cell.cloudCover = approach(cell.cloudCover, cover, 0.14, step);
          cell.humidity = approach(cell.humidity, humid, 0.12, step);
          cell.instability = approach(cell.instability, instab, 0.14, step);
          cell.clearingBias = approach(cell.clearingBias, e.clearingBias, 0.1, step);
        }
      }
    }
  }

  /** Déclenche/maintient l'élément mobile discret de la phase courante. */
  private manageFeature(): void {
    const phase = this.currentPhase();
    const feature: SceneFeature = phase?.feature ?? featureOfSky(this.currentSky);
    if (feature === "none" || feature === "snow_band") {
      this.activeFeature = feature;
      return;
    }
    // Un seul élément mobile vivant à la fois : une cellule orageuse traverse
    // plusieurs phases (forme -> approche -> s'éloigne) en mûrissant, plutôt que
    // d'empiler trois orages. On n'en relance un que lorsque le précédent meurt.
    const stillAlive = this.engine.getActiveEvents().some((ev) => ev.id === this.activeFeatureEventId);
    this.activeFeature = feature;
    if (stillAlive) return;
    this.activeFeatureEventId = this.spawnFeature(feature);
  }

  private spawnFeature(feature: SceneFeature): number {
    const o = this.engine.getObserver();
    const upwind = (distance: number) => ({ x: o.x - this.flowX * distance, z: o.z - this.flowZ * distance });
    const thunder = this.eased.thunder;
    const dir = { x: this.flowX, z: this.flowZ };

    switch (feature) {
      case "rain_band": {
        const p = upwind(5200);
        const band = this.engine.spawnRainBand(2800, p.x, p.z);
        band.intensity = 0.5 + this.eased.precipIntensity * 0.3;
        band.maxAge = 520;
        band.speed = 7;
        band.setDirection(dir);
        return band.id;
      }
      case "shower_cell": {
        const p = upwind(3600);
        const cell = this.engine.spawnStormCell(900 + this.rng() * 500, p.x, p.z);
        cell.intensity = 0.4 + this.rng() * 0.18;
        cell.maxAge = 280;
        cell.speed = 11;
        cell.setDirection(dir);
        return cell.id;
      }
      case "snow_cell": {
        const p = upwind(3600);
        const cell = this.engine.spawnStormCell(1000, p.x, p.z, "snow");
        cell.intensity = 0.45;
        cell.maxAge = 300;
        cell.speed = 10;
        cell.setDirection(dir);
        return cell.id;
      }
      case "storm_cell": {
        const p = upwind(5600);
        const cell = this.engine.spawnStormCell(1500 + this.rng() * 700, p.x, p.z);
        cell.intensity = Math.min(1, 0.6 + thunder * 0.4);
        cell.maxAge = 520;
        cell.speed = 12;
        cell.setDirection(dir);
        return cell.id;
      }
      case "supercell": {
        const p = upwind(3000);
        const cell = this.engine.spawnStormCell(2800, p.x, p.z);
        cell.intensity = Math.max(0.92, thunder);
        cell.maxAge = 480;
        cell.speed = 10;
        cell.setDirection(dir);
        return cell.id;
      }
      case "squall_line": {
        const lead = 2200;
        const line = this.engine.spawnSquallLine(
          new SquallLineEvent({ x: o.x - this.flowX * lead, z: o.z - this.flowZ * lead, length: 3600, intensity: Math.min(1, 0.7 + thunder * 0.3), direction: dir }),
        );
        return line.id;
      }
      case "snow_squall": {
        const p = upwind(2400);
        const cell = this.engine.spawnStormCell(1600, p.x, p.z, "snow");
        cell.intensity = 0.9;
        cell.maxAge = 420;
        cell.speed = 14;
        cell.setDirection(dir);
        return cell.id;
      }
      default:
        return -1;
    }
  }

  /** Accumulation garantie pour neige soufflée / poudrerie (le reste dérive). */
  private manageGround(): void {
    const s = this.scene.surfaceState;
    if (s.blowingFromGround && this.onForcePrecip) {
      this.onForcePrecip("snow", Math.max(0.7, this.eased.precipIntensity), 6);
    }
  }

  private currentPhase(): ScenarioPhase | null {
    return this.phasesOf()[this.plan.phaseIndex] ?? null;
  }

  private ensureRegionalCells(): void {
    const o = this.engine.getObserver();
    for (let dz = -PAINT_RADIUS_CELLS; dz <= PAINT_RADIUS_CELLS; dz += 2) {
      for (let dx = -PAINT_RADIUS_CELLS; dx <= PAINT_RADIUS_CELLS; dx += 2) {
        this.engine.getCellAt(o.x + dx * CELL_SIZE, o.z + dz * CELL_SIZE);
      }
    }
  }

  private rememberScenario(scenario: WeatherScenario): void {
    if (this.recent[0] === scenario) return;
    this.recent.unshift(scenario);
    this.recent.length = Math.min(3, this.recent.length);
  }

  private context(): WeatherContext {
    return {
      season: this.env.season,
      timeOfDay: this.env.timeOfDay,
      biomeHumidity: this.env.biomeHumidity,
      biomeTemperature: this.env.biomeTemperature,
      altitude: this.env.altitude,
      terrainLift: this.env.terrainLift,
      surfaceWetness: this.env.surfaceWetness,
      snowCover: this.env.snowCover,
      previousScenario: this.recent[0] ?? null,
      currentPressureTrend: this.env.pressureTrend,
    };
  }

  // --- Debug ----------------------------------------------------------------

  debugScene(): string[] {
    const s = this.scene;
    const p = s.precipitation;
    return [
      `synoptic=${s.synopticRegime} sky=${s.skyState}`,
      `layers=${s.cloudLayers.map((l) => l.type).join(",") || "none"}`,
      `precip=${p.kind} int=${p.intensity.toFixed(2)} pattern=${p.spatialPattern} ground=${p.reachesGround ? "yes" : (p.virga ? "virga" : "no")}`,
      `visibility range=${s.visibility.range.toFixed(2)} fog=${s.visibility.fogDensity.toFixed(2)} haze=${s.visibility.haze.toFixed(2)}`,
      `wind dir=${s.wind.dirX.toFixed(2)},${s.wind.dirZ.toFixed(2)} speed=${s.wind.speed.toFixed(1)} gust=${s.wind.gustiness.toFixed(2)}`,
      `temp surface=${s.temperatureProfile.surface.toFixed(1)}C freezeY=${s.temperatureProfile.freezingLevel.toFixed(0)} humidity=${this.eased.humidity.toFixed(2)}`,
      `convective potential=${s.convectiveState.potential.toFixed(2)} towers=${s.convectiveState.toweringCount} cell=${s.convectiveState.cellActive}`,
      `phase=${this.plan.scenario} #${this.plan.phaseIndex} (${this.currentPhase()?.milestone ?? "-"}) progress=${(this.plan.phaseProgress * 100).toFixed(0)}%`,
      `transition ${s.transition.from} -> ${s.transition.to} (${(s.transition.progress * 100).toFixed(0)}%)`,
    ];
  }

  debugPlan(): string[] {
    const phases = SCENARIOS[this.plan.scenario].phases;
    return [
      `scenario=${this.plan.scenario} seed=${this.plan.seed}`,
      `phase ${this.plan.phaseIndex + 1}/${phases.length} timer=${this.phaseTimer.toFixed(0)}s/${this.phaseDuration.toFixed(0)}s`,
      `expectedDuration=${this.plan.expectedDuration.toFixed(0)}s pressureTrend=${this.plan.pressureTrend.toFixed(2)}`,
      `next candidates: ${this.plan.nextScenarioCandidates.join(", ") || "(auto)"}`,
      `recent: ${this.recent.join(", ") || "none"}`,
    ];
  }

  debugPrecipitation(): string[] {
    const p = this.scene.precipitation;
    const sample = this.engine.sampleObserver();
    return [
      `kind=${p.kind} engine=${precipitationKindToEngine(p.kind)} intensity=${p.intensity.toFixed(2)}`,
      `pattern=${p.spatialPattern} reachesGround=${p.reachesGround} virga=${p.virga} windTilt=${p.windTilt.toFixed(2)}`,
      `derived precipitation=${sample.precipitation.toFixed(2)} thunderRisk=${sample.thunderRisk.toFixed(2)} type=${sample.weatherType}`,
      `surface wetTarget=${this.scene.surfaceState.wetnessTarget.toFixed(2)} snowTarget=${this.scene.surfaceState.freshSnowTarget.toFixed(2)} ice=${this.scene.surfaceState.iceTarget.toFixed(2)}`,
    ];
  }
}

function featureOfSky(sky: SkyState): SceneFeature {
  // Les ciels de fond n'impliquent pas d'événement mobile par défaut ;
  // l'élément mobile vient explicitement des phases de scénario.
  void sky;
  return "none";
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash01(x: number, z: number): number {
  let value = Math.imul(x | 0, 1597334677) ^ Math.imul(z | 0, 3812015801);
  value = Math.imul(value ^ (value >>> 15), 2246822519);
  return ((value ^ (value >>> 13)) >>> 0) / 4294967295;
}
