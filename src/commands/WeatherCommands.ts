/**
 * Commandes développeur du moteur météo régional.
 *
 * Handler autonome : il ne connaît que le {@link WeatherEngine} et une fonction
 * d'écriture (pour rester découplé de la console du jeu). `handle()` renvoie
 * true si la sous-commande a été reconnue, ce qui permet à la console existante
 * de retomber sur l'ancien `/weather <type>` sinon.
 *
 * Sous-commandes :
 *   /weather debug cell
 *   /weather debug events
 *   /weather set <cloudy|clearing|rain|storm> radius=1000
 *   /weather wind set x=0.8 z=0.2
 *   /weather spawn cold_front  direction=east  intensity=strong  [radius=1400]
 *   /weather spawn warm_front  direction=north intensity=medium  [radius=1800]
 *   /weather spawn rain_band   direction=south intensity=light   [radius=900]
 *   /weather spawn storm_cell  radius=800      intensity=violent [direction=east]
 *   /weather spawn squall_line length=3000 direction=east intensity=violent
 *   /weather cloud spawn <cumulus|cumulonimbus|stratus|cirrus> radius=1000
 *   /weather cloud clear radius=1000
 *   /weather cloud debug
 *
 *   intensity : light | medium | strong | violent (aussi weak|moderate|extreme)
 */

import { WeatherEngine } from "../weather/WeatherEngine";
import { ColdFrontEvent } from "../weather/events/ColdFrontEvent";
import { WarmFrontEvent } from "../weather/events/WarmFrontEvent";
import { SquallLineEvent } from "../weather/events/SquallLineEvent";
import { cardinalToVector, vectorToCompass } from "../weather/WeatherMath";
import { Cardinal, CELL_SIZE, IntensityLevel, intensityToValue } from "../weather/WeatherTypes";
import { CloudSystem } from "../weather/clouds/CloudSystem";
import { CloudType } from "../weather/clouds/CloudType";
import { GroundAccumulationSystem } from "../weather/ground/GroundAccumulationSystem";
import { StormCellEvent } from "../weather/events/StormCellEvent";
import { RainBandEvent } from "../weather/events/RainBandEvent";
import { WeatherEvent } from "../weather/events/WeatherEvent";
import { ForecastSystem } from "../weather/forecast/ForecastSystem";
import { WeatherAlertSystem } from "../weather/alerts/WeatherAlertSystem";
import { WeatherAlertLevel } from "../weather/alerts/WeatherAlertLevel";
import { WeatherAlertType } from "../weather/alerts/WeatherAlert";
import { WeatherMapUI } from "../ui/weather/WeatherMapUI";
import { World } from "../world/World";
import { WeatherEventPhase } from "../weather/events/WeatherEventPhase";
import { WeatherDirector, WeatherRegime } from "../weather/WeatherDirector";
import { deriveCloudLayerState } from "../weather/sky/CloudLayerState";
import { classifyWeather } from "../weather/WeatherMath";
import { PrecipitationKind, SkyState, WeatherScenario } from "../weather/scene/WeatherScene";

/** Sous-commandes prises en charge par le moteur régional. */
const REGIONAL_SUBCOMMANDS = new Set(["debug", "set", "wind", "spawn", "render", "cloud", "ground", "map", "forecast", "alert", "time", "event", "biome", "terrain", "cinematic", "scenario"]);

/** Diagnostic de la population de nuages (pour /weather debug cloud_population). */
export interface CloudPopulationDiagnostics {
  debugPopulation(): string[];
}

/** Diagnostic des éclairs (pour /weather debug lightning). */
export interface LightningDiagnostics {
  debugSummary(ox: number, oz: number): string;
}

/** Vitesses de vent nommées → magnitude (blocs/s). */
const WIND_SPEEDS: Record<string, number> = { calm: 1, light: 4, medium: 8, strong: 16, violent: 26 };

/** Mots de commande → CloudType pour /weather cloud spawn. */
const CLOUD_TYPES: Record<string, CloudType> = {
  cumulus: CloudType.CUMULUS,
  cumulonimbus: CloudType.CUMULONIMBUS,
  stratus: CloudType.STRATUS,
  cirrus: CloudType.CIRRUS,
};

/**
 * Surface minimale du rendu météo, typée structurellement pour éviter d'importer
 * Three.js dans la couche commandes. {@link WeatherRenderer} la satisfait.
 */
export interface WeatherRenderToggle {
  enabled: boolean;
  setEnabled(on: boolean): void;
}

export interface CloudVolumeDiagnostics {
  debugSummary(observer: { x: number; z: number }): string[];
  debugPerformanceSummary(): string[];
  debugLightningSummary(): string;
}

export interface CinematicTimeController {
  setNamedTime(name: string): boolean;
}

const CARDINALS = new Set<Cardinal>(["north", "south", "east", "west", "ne", "nw", "se", "sw"]);

/** Alias acceptés par /weather scenario (pour l'aide). */
const SCENARIO_ALIAS_NAMES = [
  "clear_day", "clear_cirrus", "fair_cumulus", "scattered_cumulus", "broken_cumulus",
  "grey_dry", "stratocumulus_broken", "warm_front", "frontal_rain", "cold_front",
  "post_frontal_showers", "isolated_shower", "isolated_thunderstorm", "storm_visible_far",
  "storm_passes_north", "storm_overhead", "clearing_after_rain", "morning_fog", "dense_fog",
  "winter_clear", "steady_snow", "snow_showers", "snow_squall", "blizzard", "freezing_rain",
  "heat_haze", "sandstorm",
];

/** Niveaux d'intensité acceptés (mots usuels + synonymes) → niveau interne. */
const INTENSITY_ALIASES: Record<string, IntensityLevel> = {
  light: "weak",
  weak: "weak",
  medium: "moderate",
  moderate: "moderate",
  strong: "strong",
  violent: "extreme",
  extreme: "extreme",
};

export class WeatherCommands {
  constructor(
    private readonly engine: WeatherEngine,
    private readonly write: (message: string) => void,
    /** Optionnel : permet `/weather render on|off`. */
    private readonly renderer?: WeatherRenderToggle,
    /** Optionnel : permet `/weather cloud ...`. */
    private readonly clouds?: CloudSystem,
    /** Optionnel : permet `/weather ground ...` et les précip forcées. */
    private readonly ground?: GroundAccumulationSystem,
    private readonly forecast?: ForecastSystem,
    private readonly alerts?: WeatherAlertSystem,
    private readonly mapUi?: WeatherMapUI,
    private readonly world?: World,
    private readonly director?: WeatherDirector,
    private readonly resetCloudVisuals?: () => void,
    private readonly cloudDiagnostics?: CloudVolumeDiagnostics,
    private readonly timeController?: CinematicTimeController,
    /** Optionnel : /weather debug cloud_population. */
    private readonly cloudPopulation?: CloudPopulationDiagnostics,
    /** Optionnel : /weather debug lightning. */
    private readonly lightning?: LightningDiagnostics,
  ) {}

  /** Indique si parts[1] relève du moteur régional (pour le routage). */
  static handles(subcommand: string | undefined): boolean {
    return !!subcommand && REGIONAL_SUBCOMMANDS.has(subcommand);
  }

  /**
   * Traite `/weather ...`. `parts` inclut "weather" en [0].
   * Renvoie true si reconnu, false pour laisser la console gérer l'ancien format.
   */
  handle(parts: string[]): boolean {
    const sub = parts[1];
    if (!WeatherCommands.handles(sub)) return false;

    switch (sub) {
      case "debug":
        this.handleDebug(parts);
        return true;
      case "set":
        this.handleSet(parts);
        return true;
      case "wind":
        this.handleWind(parts);
        return true;
      case "spawn":
        this.handleSpawn(parts);
        return true;
      case "render":
        this.handleRender(parts);
        return true;
      case "cloud":
        this.handleCloud(parts);
        return true;
      case "ground":
        this.handleGround(parts);
        return true;
      case "map":
        this.handleMap(parts);
        return true;
      case "forecast":
        this.handleForecast(parts);
        return true;
      case "alert":
        this.handleAlert(parts);
        return true;
      case "time":
        this.handleWeatherTime(parts);
        return true;
      case "event":
        this.handleEvent(parts);
        return true;
      case "biome":
        this.handleBiome(parts);
        return true;
      case "terrain":
        this.handleTerrain(parts);
        return true;
      case "cinematic":
        this.handleCinematic(parts);
        return true;
      case "scenario":
        this.handleScenario(parts);
        return true;
      default:
        return false;
    }
  }

  // --- /weather scenario <name> --------------------------------------------

  private handleScenario(parts: string[]): void {
    if (!this.director) {
      this.write("Weather director not available.");
      return;
    }
    const name = parts[2];
    if (!name) {
      this.write(`Usage: /weather scenario <${SCENARIO_ALIAS_NAMES.slice(0, 9).join("|")}|...>`);
      this.write(`More: ${SCENARIO_ALIAS_NAMES.slice(9).join(" ")}`);
      return;
    }
    if (!this.applyScenarioAlias(name)) {
      this.write(`Unknown scenario '${name}'. Try: ${SCENARIO_ALIAS_NAMES.join(", ")}`);
      return;
    }
    this.write(`Weather scenario set: ${name}.`);
    // Affiche immédiatement l'état de scène obtenu.
    for (const line of this.director.scenarios.debugScene().slice(0, 4)) this.write(line);
  }

  /** Mappe un alias de commande vers un scénario/ciel. Renvoie false si inconnu. */
  private applyScenarioAlias(name: string): boolean {
    const S = WeatherScenario;
    this.resetCloudVisuals?.();
    switch (name) {
      case "clear_day": this.startScenario(S.CLEAR_DAY); return true;
      case "clear_cirrus": this.pinSky(SkyState.CLEAR_WITH_CIRRUS); return true;
      case "fair_cumulus": this.startScenario(S.FAIR_CUMULUS_DAY, 2); return true;
      case "scattered_cumulus": this.pinSky(SkyState.SCATTERED_CUMULUS); return true;
      case "broken_cumulus": this.pinSky(SkyState.BROKEN_CUMULUS); return true;
      case "grey_dry": this.startScenario(S.GREY_DRY_DAY, 1); return true;
      case "stratocumulus_broken": this.pinSky(SkyState.STRATOCUMULUS_BROKEN); return true;
      case "warm_front": this.startScenario(S.WARM_FRONT_SEQUENCE); return true;
      case "frontal_rain": this.startScenario(S.FRONTAL_RAIN_SEQUENCE, 1); return true;
      case "cold_front": this.startScenario(S.COLD_FRONT_SEQUENCE); return true;
      case "post_frontal_showers": this.startScenario(S.POST_FRONTAL_SHOWERS); return true;
      case "isolated_shower": this.startScenario(S.ISOLATED_SHOWER_DAY); return true;
      case "isolated_thunderstorm": this.startScenario(S.ISOLATED_THUNDERSTORM_DAY); return true;
      case "storm_visible_far": this.pinSky(SkyState.STORM_VISIBLE_FAR); this.placeStorm(9000, 0, 0.95, 0.32, 3200); return true;
      case "storm_passes_north": this.pinSky(SkyState.STORM_APPROACHING); this.placeStorm(2600, -5200, 0.92, 0.4, 2600); return true;
      case "storm_overhead": this.pinSky(SkyState.STORM_OVERHEAD); this.placeStorm(200, 0, 0.98, 0.6, 2800); return true;
      case "clearing_after_rain": this.pinSky(SkyState.POST_SHOWER_SKY); return true;
      case "morning_fog": this.startScenario(S.MORNING_FOG); return true;
      case "dense_fog": this.pinSky(SkyState.DENSE_FOG); return true;
      case "winter_clear": this.pinSky(SkyState.WINTER_CLEAR); return true;
      case "steady_snow": this.pinSky(SkyState.SNOWY_OVERCAST); return true;
      case "snow_showers": this.startScenario(S.WINTER_SHOWERS); return true;
      case "snow_squall": this.director?.forceSky(SkyState.SNOWY_OVERCAST, 170, "snow_squall"); return true;
      case "blizzard": this.startScenario(S.BLIZZARD_EVENT, 1); return true;
      case "freezing_rain":
        this.pinSky(SkyState.LOW_OVERCAST);
        // Couche avancée (cf. D12) : pluie + verglas sur surfaces froides.
        this.director?.scenarios.forcePrecipitation(PrecipitationKind.FREEZING_RAIN, 0.68, 240, "uniform", true);
        return true;
      case "heat_haze": this.pinSky(SkyState.HEAT_HAZE); return true;
      case "sandstorm": this.pinSky(SkyState.SANDSTORM_SKY); this.engine.setWind(WIND_SPEEDS.violent, 0); return true;
      default: return false;
    }
  }

  /** Démarre un scénario complet de l'atlas. */
  private startScenario(scenario: WeatherScenario, startPhase = 0): void {
    this.director?.forceScenario(scenario, { startPhase, immediate: true });
  }

  /** Pin un état de ciel unique (presets ponctuels). */
  private pinSky(sky: SkyState, seconds = 240): void {
    this.director?.forceSky(sky, seconds);
  }

  /** Place un orage discret à une distance/azimut donnés (presets storm_*). */
  private placeStorm(distance: number, lateral: number, intensity: number, ageFraction: number, radius = 2200): void {
    const o = this.engine.getObserver();
    const storm = this.engine.spawnStormCell(radius, o.x + lateral, o.z - distance);
    storm.intensity = intensity;
    storm.maxAge = 560;
    storm.speed = distance > 4000 ? 14 : 9;
    storm.setDirection("south");
    storm.age = storm.maxAge * ageFraction;
    storm.visualWarmStart = ageFraction >= 0.28;
  }

  private handleMap(parts: string[]): void {
    if (parts[2] !== "open" || !this.mapUi) {
      this.write("Usage: /weather map open");
      return;
    }
    this.mapUi.open();
    this.write("Weather map opened.");
  }

  private handleForecast(parts: string[]): void {
    if (!this.forecast) {
      this.write("Forecast system not available.");
      return;
    }
    const x = parts[2] === "here" || parts[2] === undefined ? undefined : Number(parts[2]);
    const z = parts[2] === "here" || parts[2] === undefined ? undefined : Number(parts[3]);
    const timeline = this.forecast.forecastTimeline(Number.isFinite(x) ? x : undefined, Number.isFinite(z) ? z : undefined);
    this.write(`-- Forecast: ${timeline.snapshots[0].region.name} --`);
    timeline.snapshots.slice(0, 6).forEach((snapshot) => {
      const label = snapshot.leadSeconds === 0 ? "now" : `+${Math.round(snapshot.leadSeconds / 60)}m`;
      this.write(
        `${label}: ${snapshot.weatherType} temp=${snapshot.temperature.toFixed(1)}C rain=${Math.round(snapshot.rainRisk * 100)}% storm=${Math.round(snapshot.thunderRisk * 100)}% ${snapshot.confidence}`,
      );
    });
  }

  private handleAlert(parts: string[]): void {
    if (!this.alerts) {
      this.write("Alert system not available.");
      return;
    }
    if (parts[2] === "list") {
      const alerts = this.alerts.list();
      if (!alerts.length) {
        this.write("No active weather alerts.");
        return;
      }
      alerts.slice(0, 8).forEach((alert) => this.write(`${alert.level} ${alert.type}: ${alert.description}`));
      return;
    }
    if (parts[2] === "create") {
      const kv = parseKeyValues(parts);
      const type = (kv.get("type") ?? "storm") as WeatherAlertType;
      const level = ((kv.get("level") ?? "yellow").toUpperCase() as WeatherAlertLevel) || "YELLOW";
      const radius = numberOr(kv.get("radius"), 2000);
      const o = this.engine.getObserver();
      const alert = this.alerts.createManual(type, level, o.x, o.z, radius);
      this.write(`Created ${alert.level} ${alert.type} alert radius=${radius}.`);
      return;
    }
    this.write("Usage: /weather alert list | create type=storm level=orange radius=2000");
  }

  private handleWeatherTime(parts: string[]): void {
    const kv = parseKeyValues(parts);
    if (parts[2] !== "simulate") {
      this.write("Usage: /weather time simulate minutes=60");
      return;
    }
    const minutes = Math.max(0, Math.min(24 * 60, numberOr(kv.get("minutes"), 60)));
    let remaining = minutes * 60;
    while (remaining > 0) {
      const dt = Math.min(remaining, 5);
      this.engine.state.update(dt);
      remaining -= dt;
    }
    this.write(`Weather simulated forward ${minutes} minutes.`);
  }

  private handleEvent(parts: string[]): void {
    const action = parts[2];
    const event = this.nearestEvent();
    if (!event) {
      this.write("No active weather event.");
      return;
    }
    const kv = parseKeyValues(parts);
    switch (action) {
      case "inspect":
        this.write(`#${event.id} ${event.type} phase=${event.phase} pos=${Math.round(event.x)},${Math.round(event.z)} radius=${event.radius.toFixed(0)} intensity=${event.intensity.toFixed(2)}`);
        break;
      case "track":
        this.write(`Tracking #${event.id}: eta=${this.eventEta(event)}s direction=${vectorToCompass(event.dirX, event.dirZ)} speed=${event.speed.toFixed(1)}`);
        break;
      case "delete":
        this.engine.state.events.splice(this.engine.state.events.indexOf(event), 1);
        this.write(`Deleted event #${event.id}.`);
        break;
      case "set_phase":
        event.phase = (kv.get("phase") as WeatherEventPhase) ?? WeatherEventPhase.MATURE;
        this.write(`Event #${event.id} phase=${event.phase}.`);
        break;
      case "set_intensity": {
        const raw = kv.get("intensity") ?? "strong";
        const mapped = INTENSITY_ALIASES[raw] ? intensityToValue(INTENSITY_ALIASES[raw]) : numberOr(raw, event.intensity);
        event.intensity = Math.max(0, Math.min(1, mapped));
        this.write(`Event #${event.id} intensity=${event.intensity.toFixed(2)}.`);
        break;
      }
      default:
        this.write("Usage: /weather event inspect|track|delete|set_phase|set_intensity nearest ...");
    }
  }

  private handleBiome(_parts: string[]): void {
    const o = this.engine.getObserver();
    const biome = this.world?.getBiomeAt(o.x, o.z);
    if (!biome) {
      this.write("Biome data unavailable.");
      return;
    }
    const cell = this.engine.getObserverCell();
    this.write(`Biome ${biome.id}: temp=${biome.temperature.toFixed(2)} humidity=${biome.humidity.toFixed(2)}`);
    this.write(`Weather baseline now temp=${cell.baseline.temperature.toFixed(1)}C humidity=${cell.baseline.humidity.toFixed(2)} wind=${Math.hypot(cell.baseline.windX, cell.baseline.windZ).toFixed(1)}`);
  }

  private handleTerrain(_parts: string[]): void {
    const o = this.engine.getObserver();
    const height = this.world?.getSurfaceHeight(o.x, o.z);
    if (height === undefined) {
      this.write("Terrain data unavailable.");
      return;
    }
    this.write(`Terrain height=${height} cell=${this.engine.getObserverCell().cellX},${this.engine.getObserverCell().cellZ}`);
  }

  private handleCinematic(parts: string[]): void {
    const scene = parts[2];
    switch (scene) {
      case "fair_cumulus":
        this.prepareCinematic("MOISTURE_RETURN", "fair");
        this.engine.setWind(6, 2);
        this.writeCinematicState(scene);
        break;
      case "isolated_storm":
        this.prepareCinematic("CONVECTIVE_OUTBREAK", "clear");
        this.spawnCinematicStorm(7000, 2100, 0.3, WeatherEventPhase.MATURE);
        this.engine.setWind(14, 2);
        this.writeCinematicState(scene);
        break;
      case "storm_developing":
        this.prepareCinematic("CONVECTIVE_OUTBREAK", "fair");
        this.spawnCinematicStorm(6200, 1900, 0.12, WeatherEventPhase.DEVELOPING);
        this.engine.setWind(11, 2);
        this.writeCinematicState(scene);
        break;
      case "storm_mature_far":
        this.prepareCinematic("CONVECTIVE_OUTBREAK", "clear");
        this.spawnCinematicStorm(10_000, 2400, 0.36, WeatherEventPhase.MATURE);
        this.engine.setWind(20, 3);
        this.writeCinematicState(scene);
        break;
      case "storm_passing": {
        this.prepareCinematic("CLEARING", "fair");
        const storm = this.spawnCinematicStorm(-1500, 2500, 0.7, WeatherEventPhase.PASSING);
        storm.speed = 11;
        this.engine.spawnClearing(5200, storm.x, storm.z - 2600).setDirection("south");
        this.engine.setWind(13, 3);
        this.writeCinematicState(scene);
        break;
      }
      case "warm_front": {
        this.prepareCinematic("WARM_FRONT", "fair");
        const observer = this.engine.getObserver();
        const front = new WarmFrontEvent({
          x: observer.x,
          z: observer.z - 6200,
          radius: 5200,
          intensity: 0.74,
          maxAge: 900,
          speed: 9,
          direction: "south",
        });
        front.age = 110;
        this.engine.spawnWarmFront(front);
        this.engine.setWind(3, 10);
        this.writeCinematicState(scene);
        break;
      }
      case "cold_front": {
        this.prepareCinematic("COLD_FRONT", "fair");
        const observer = this.engine.getObserver();
        const front = new ColdFrontEvent({
          x: observer.x,
          z: observer.z - 7200,
          radius: 4800,
          intensity: 0.94,
          maxAge: 760,
          speed: 17,
          direction: "south",
        });
        front.age = 120;
        this.engine.spawnColdFront(front);
        this.spawnCinematicStorm(6500, 1850, 0.22, WeatherEventPhase.APPROACHING);
        this.engine.setWind(4, 20);
        this.writeCinematicState(scene);
        break;
      }
      case "stratiform_rain": {
        this.prepareCinematic("STRATIFORM_RAIN", "fair");
        const observer = this.engine.getObserver();
        const band = new RainBandEvent({
          x: observer.x,
          z: observer.z - 1800,
          radius: 6200,
          intensity: 0.72,
          maxAge: 780,
          speed: 7,
          direction: "south",
        });
        band.age = 90;
        this.engine.addEvent(band);
        this.engine.setWind(2, 9);
        this.writeCinematicState(scene);
        break;
      }
      case "storm_approach":
        this.handleSpawn(["weather", "spawn", "supercell", "direction=south", "intensity=violent", "distance=9000", "radius=1800"]);
        this.matureLatestStorm(0.3);
        this.engine.setWind(18, 2);
        this.write("Cinematic storm_approach ready.");
        break;
      case "supercell_far":
        {
          const observer = this.engine.getObserver();
          const supercell = this.engine.spawnStormCell(2400, observer.x, observer.z - 16000);
          supercell.intensity = 1;
          supercell.maxAge = 480;
          supercell.setDirection("se");
          supercell.age = supercell.maxAge * 0.36;
        }
        this.engine.setWind(22, 3);
        this.write("Cinematic supercell_far ready.");
        break;
      case "clearing_after_storm":
        this.prepareCinematic("CLEARING", "fair");
        this.spawnCinematicStorm(-2400, 2400, 0.76, WeatherEventPhase.PASSING);
        this.engine.spawnClearing(5600);
        this.engine.setWind(8, 6);
        this.writeCinematicState(scene);
        break;
      case "snow_squall": {
        this.prepareCinematic("WINTER_STORM", "fair");
        const observer = this.engine.getObserver();
        const squall = this.engine.spawnStormCell(2400, observer.x, observer.z - 2600, "snow");
        squall.intensity = 0.9;
        squall.maxAge = 520;
        squall.age = 170;
        squall.speed = 14;
        squall.setDirection("south");
        this.ground?.forcePrecip("snow", 0.9, 150);
        this.engine.setWind(5, 20);
        this.writeCinematicState(scene);
        break;
      }
      case "blizzard_night":
        this.prepareCinematic("WINTER_STORM", "fair");
        this.timeController?.setNamedTime("night");
        this.handleSpawn(["weather", "spawn", "blizzard", "direction=south", "intensity=violent", "radius=4800"]);
        this.matureLatestStorm(0.34);
        this.engine.setWind(8, 27);
        this.writeCinematicState(scene);
        break;
      case "blizzard_wall":
        this.handleSpawn(["weather", "spawn", "blizzard", "intensity=violent", "radius=3200"]);
        this.write("Cinematic blizzard_wall ready.");
        break;
      case "hail_core":
        this.prepareCinematic("CONVECTIVE_OUTBREAK", "clear");
        this.handleSpawn(["weather", "spawn", "hailstorm", "intensity=violent", "radius=1200"]);
        this.writeCinematicState(scene);
        break;
      case "sunset_rainbow":
        this.engine.spawnRainBand(1000);
        this.engine.spawnClearing(1400);
        this.write("Cinematic sunset_rainbow ready.");
        break;
      default:
        this.write("Usage: /weather cinematic fair_cumulus|isolated_storm|storm_developing|storm_mature_far|storm_passing|warm_front|cold_front|stratiform_rain|clearing_after_storm|snow_squall|blizzard_night|hail_core");
    }
  }

  private prepareCinematic(regime: WeatherRegime, background: "clear" | "fair"): void {
    this.engine.reset();
    this.resetCloudVisuals?.();
    this.director?.hold(regime, 900);
    const observer = this.engine.getObserver();
    const radius = 13;
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const cell = this.engine.getCellAt(observer.x + dx * CELL_SIZE, observer.z + dz * CELL_SIZE);
        const variation = this.cellVariation(cell.cellX, cell.cellZ);
        const cloudCover = background === "fair" ? 0.32 + variation * 0.16 : 0.055 + variation * 0.09;
        const humidity = background === "fair" ? 0.58 + variation * 0.09 : 0.38 + variation * 0.08;
        const instability = background === "fair" ? 0.32 + variation * 0.1 : 0.14 + variation * 0.07;
        cell.baseline.cloudCover = cloudCover;
        cell.baseline.humidity = humidity;
        cell.baseline.instability = instability;
        cell.cloudCover = cloudCover;
        cell.humidity = humidity;
        cell.instability = instability;
        cell.precipitation = 0;
        cell.thunderRisk = 0;
        cell.clearingBias = 0;
        cell.weatherType = classifyWeather(cell);
      }
    }
  }

  private spawnCinematicStorm(
    distance: number,
    radius: number,
    ageFraction: number,
    phase: WeatherEventPhase,
  ): StormCellEvent {
    const observer = this.engine.getObserver();
    const event = this.engine.spawnStormCell(radius, observer.x, observer.z - distance);
    event.intensity = 0.94;
    event.maxAge = 620;
    event.speed = 7;
    event.setDirection("south");
    event.age = event.maxAge * ageFraction;
    event.phase = phase;
    event.visualWarmStart = ageFraction >= 0.28;
    return event;
  }

  private writeCinematicState(scene: string): void {
    const observer = this.engine.getObserver();
    const sample = this.engine.sampleAt(observer.x, observer.z);
    const layers = deriveCloudLayerState(sample);
    const events = this.engine.getActiveEvents();
    const event = events[events.length - 1];
    const director = this.director?.debugState();
    this.write(`Cinematic ${scene}: regime=${director?.regime ?? "MANUAL"} plan=${director?.plan ?? "MANUAL"} milestone=${director?.milestone ?? "manual"} convectiveCells=${events.filter((candidate) => candidate.producesLightning).length}`);
    this.write(`Sky layers: stratiform=${layers.stratiformCover.toFixed(2)} fairCumulus=${layers.fairCumulusPotential.toFixed(2)} deep=${layers.deepConvection.toFixed(2)}`);
    if (event) {
      this.write(`Event #${event.id} phase=${event.phase} pos=${Math.round(event.x)},${Math.round(event.z)} radius=${Math.round(event.radius)} precip=${event.precip} base=${Math.round(event.cloudBaseY)} trajectory=${event.dirX.toFixed(2)},${event.dirZ.toFixed(2)}`);
    }
    window.setTimeout(() => {
      const lines = this.cloudDiagnostics?.debugSummary(observer) ?? [];
      for (const line of lines.slice(0, 4)) this.write(line);
      if (this.cloudDiagnostics) this.write(this.cloudDiagnostics.debugLightningSummary());
      for (const line of this.cloudDiagnostics?.debugPerformanceSummary().slice(0, 2) ?? []) this.write(line);
    }, 2200);
  }

  private cellVariation(x: number, z: number): number {
    let value = Math.imul(x | 0, 1597334677) ^ Math.imul(z | 0, 3812015801);
    value = Math.imul(value ^ (value >>> 15), 2246822519);
    return ((value ^ (value >>> 13)) >>> 0) / 4294967295;
  }

  private matureLatestStorm(ageFraction: number): void {
    const storms = this.engine.getActiveEvents().filter((event) => event.producesLightning);
    const latest = storms[storms.length - 1];
    if (latest) {
      latest.age = latest.maxAge * ageFraction;
      latest.visualWarmStart = ageFraction >= 0.28;
    }
  }

  // --- /weather ground ... --------------------------------------------------

  private handleGround(parts: string[]): void {
    if (!this.ground) {
      this.write("Ground system not available.");
      return;
    }
    const action = parts[2];
    const kv = parseKeyValues(parts);
    const o = this.engine.getObserver();
    const radius = numberOr(kv.get("radius"), 500);
    const depth = numberOr(kv.get("depth"), 0.5);

    switch (action) {
      case "inspect": {
        const col = this.ground.state.get(o.x, o.z);
        this.write(
          col
            ? `Ground here: wet=${col.wetness.toFixed(2)} puddles=${Math.max(0, col.wetness - 0.72).toFixed(2)} snow=${col.snowDepth.toFixed(2)} hail=${col.hailDepth.toFixed(2)} ice=${col.iceDepth.toFixed(2)}`
            : "Ground here: no tracked surface weather yet.",
        );
        break;
      }
      case "set_snow":
        this.write(`Set snow depth=${depth} on ${this.ground.setLayer("snow", depth, o.x, o.z, radius)} cols.`);
        break;
      case "melt_snow":
        this.write(`Melted snow on ${this.ground.meltSnow(o.x, o.z, radius)} cols.`);
        break;
      case "set_hail":
        this.write(`Set hail depth=${depth} on ${this.ground.setLayer("hail", depth, o.x, o.z, radius)} cols.`);
        break;
      case "wet":
        this.write(`Wet ${this.ground.setWetness(1, o.x, o.z, radius)} cols.`);
        break;
      case "dry":
        this.write(`Dried ${this.ground.setWetness(0, o.x, o.z, radius)} cols.`);
        break;
      default:
        this.write("Usage: /weather ground inspect|set_snow|melt_snow|set_hail|wet|dry depth= radius=");
    }
  }

  // --- /weather cloud spawn|clear|debug ------------------------------------

  private handleCloud(parts: string[]): void {
    if (!this.clouds) {
      this.write("Cloud system not available.");
      return;
    }
    const action = parts[2];
    const kv = parseKeyValues(parts);
    const o = this.engine.getObserver();

    if (action === "debug") {
      this.clouds.debugSummary().forEach((line) => this.write(line));
      return;
    }

    if (action === "clear") {
      const radius = numberOr(kv.get("radius"), 1000);
      this.engine.spawnClearing(radius); // assèche les conditions
      const n = this.clouds.clearArea(o.x, o.z, radius); // dissipe les masses
      this.write(`Clearing ${n} cloud masses (radius=${radius}).`);
      return;
    }

    if (action === "spawn") {
      const type = CLOUD_TYPES[parts[3] ?? ""];
      if (!type) {
        this.write("Usage: /weather cloud spawn <cumulus|cumulonimbus|stratus|cirrus> radius=1000");
        return;
      }
      const radius = numberOr(kv.get("radius"), 1000);
      // On installe d'abord les CONDITIONS (le moteur), puis on amorce les masses
      // pour les voir naître ; elles grossissent/persistent selon ces conditions.
      if (type === CloudType.CUMULONIMBUS) {
        // Storm stationnaire orienté est : il maintient les conditions sur place
        // ET génère un vent d'altitude (sans direction il annulerait le vent).
        const storm = this.engine.spawnStormCell(radius);
        storm.speed = 0;
        storm.setDirection("east");
        if (this.engine.getWind().speed < 1) {
          this.engine.setWind(8, 0); // vent d'altitude → enclume visible
          this.write("(upper wind set to east so the anvil can form)");
        }
      } else {
        this.engine.spawnCloudyArea(radius); // humidité + couverture
      }
      const count = this.clouds.spawnCluster(type, o.x, o.z, radius);
      this.write(`Spawned ${count} ${parts[3]} masses (radius=${radius}).`);
      return;
    }

    this.write("Usage: /weather cloud spawn|clear|debug ...");
  }

  // --- /weather render on|off ----------------------------------------------

  private handleRender(parts: string[]): void {
    if (!this.renderer) {
      this.write("Weather renderer not available.");
      return;
    }
    const arg = parts[2];
    this.renderer.setEnabled(false);
    this.write(arg === "on"
      ? "Legacy regional renderer remains OFF: SkySystem and dedicated weather renderers are authoritative."
      : "Legacy regional renderer OFF.");
  }

  // --- /weather debug cell|events ------------------------------------------

  private handleDebug(parts: string[]): void {
    const o = this.engine.getObserver();
    if (parts[2] === "scene") {
      if (!this.director) { this.write("Weather director unavailable."); return; }
      for (const line of this.director.scenarios.debugScene()) this.write(line);
      return;
    }
    if (parts[2] === "plan") {
      if (!this.director) { this.write("Weather director unavailable."); return; }
      for (const line of this.director.scenarios.debugPlan()) this.write(line);
      return;
    }
    if (parts[2] === "precipitation") {
      if (!this.director) { this.write("Weather director unavailable."); return; }
      for (const line of this.director.scenarios.debugPrecipitation()) this.write(line);
      return;
    }
    if (parts[2] === "layers") {
      if (!this.director) { this.write("Weather director unavailable."); return; }
      const layers = this.director.scenarios.currentScene.cloudLayers;
      this.write(`-- Cloud layers: ${layers.length} active --`);
      if (layers.length === 0) this.write("(clear sky — no cloud layers)");
      for (const l of layers.slice(0, 7)) {
        this.write(`${l.type} base=${l.baseHeight.toFixed(0)} top=${l.topHeight.toFixed(0)} cover=${l.coverage.toFixed(2)} opacity=${l.opacity.toFixed(2)} precipPot=${l.precipitationPotential.toFixed(2)}`);
      }
      return;
    }
    if (parts[2] === "cloud_population") {
      if (!this.cloudPopulation) { this.write("Cloud population diagnostics unavailable."); return; }
      for (const line of this.cloudPopulation.debugPopulation()) this.write(line);
      return;
    }
    if (parts[2] === "lightning") {
      this.write(this.lightning ? this.lightning.debugSummary(o.x, o.z) : "Lightning diagnostics unavailable.");
      return;
    }
    if (parts[2] === "director") {
      const state = this.director?.debugState();
      if (!state) {
        this.write("Weather director unavailable.");
        return;
      }
      this.write(`Director plan=${state.plan ?? "SELECTING"} step=${state.step} milestone=${state.milestone}.`);
      this.write(`Regime=${state.regime} transitionIn=${state.secondsUntilTransition.toFixed(1)}s events=${state.activeEvents}.`);
      this.write(`Flow=${state.flowX.toFixed(2)},${state.flowZ.toFixed(2)} recent=${state.recentPlans.join(",") || "none"}.`);
      return;
    }
    if (parts[2] === "events") {
      this.handleDebugEvents();
      return;
    }
    if (parts[2] === "ground") {
      const s = this.ground?.state;
      const cell = this.engine.getObserverCell();
      const col = s?.get(this.engine.getObserver().x, this.engine.getObserver().z);
      this.write(`-- Ground: ${s ? s.size : 0} columns, totalSnow=${s ? s.totalSnow().toFixed(1) : 0} --`);
      if (col) {
        this.write(`here: snow=${col.snowDepth.toFixed(2)} hail=${col.hailDepth.toFixed(2)} wet=${col.wetness.toFixed(2)} ice=${col.iceDepth.toFixed(2)}`);
      } else {
        this.write(`here: (no accumulation)  temp=${cell.temperature.toFixed(1)}°C`);
      }
      return;
    }
    if (parts[2] === "wind") {
      const w = this.engine.getWind();
      this.write(`-- Wind: (${w.x.toFixed(2)}, ${w.z.toFixed(2)})  speed=${w.speed.toFixed(2)} blk/s --`);
      return;
    }
    if (parts[2] !== "cell") {
      this.write("Usage: /weather debug cell|events|ground|wind|director|scene|plan|layers|precipitation|cloud_population|lightning");
      return;
    }
    const cell = this.engine.getObserverCell();
    const f2 = (n: number) => n.toFixed(2);
    this.write(`-- Weather cell [${cell.cellX}, ${cell.cellZ}] : ${cell.weatherType} --`);
    this.write(`temp ${f2(cell.temperature)}°C   humidity ${f2(cell.humidity)}   pressure ${cell.pressure.toFixed(1)} hPa`);
    this.write(`instability ${f2(cell.instability)}   cloudCover ${f2(cell.cloudCover)}`);
    this.write(`precipitation ${f2(cell.precipitation)}   thunderRisk ${f2(cell.thunderRisk)}`);
    this.write(`wind (${f2(cell.windX)}, ${f2(cell.windZ)})  speed ${f2(Math.hypot(cell.windX, cell.windZ))}`);
    this.write(`active events: ${this.engine.activeEventCount}   grid cells: ${this.engine.state.grid.size}`);
  }

  /** /weather debug events : liste type/pos/dir/vitesse/intensité/âge/durée. */
  private handleDebugEvents(): void {
    const events = this.engine.getActiveEvents();
    if (events.length === 0) {
      this.write("No active weather events.");
      return;
    }
    this.write(`-- Active weather events: ${events.length} --`);
    // La console n'affiche que ~9 lignes : on borne pour garder l'en-tête.
    const shown = Math.min(events.length, 8);
    for (let i = 0; i < shown; i += 1) {
      const e = events[i];
      const remaining = Math.max(0, e.maxAge - e.age);
      this.write(
        `#${e.id} ${e.type} pos(${Math.round(e.x)},${Math.round(e.z)}) ` +
          `dir ${vectorToCompass(e.dirX, e.dirZ)} spd ${e.speed.toFixed(0)} ` +
          `int ${e.intensity.toFixed(2)} age ${e.age.toFixed(0)}s rem ${remaining.toFixed(0)}s`,
      );
    }
  }

  // --- /weather set <type> radius=... --------------------------------------

  private handleSet(parts: string[]): void {
    const type = parts[2];
    const kv = parseKeyValues(parts);
    const radius = numberOr(kv.get("radius"), 1000);
    switch (type) {
      case "cloudy":
        this.engine.spawnCloudyArea(radius);
        this.write(`Cloudy area spawned (radius=${radius}).`);
        break;
      case "clearing":
        this.engine.spawnClearing(radius);
        this.write(`Clearing spawned (radius=${radius}).`);
        break;
      case "rain":
        this.engine.spawnRainBand(radius);
        this.write(`Rain band spawned (radius=${radius}).`);
        break;
      case "storm":
        this.engine.spawnStormCell(Math.min(radius, 500));
        this.write(`Storm cell spawned (radius=${Math.min(radius, 500)}).`);
        break;
      default:
        this.write("Usage: /weather set <cloudy|clearing|rain|storm> radius=1000");
    }
  }

  // --- /weather wind set x=.. z=.. -----------------------------------------

  private handleWind(parts: string[]): void {
    const kv = parseKeyValues(parts);

    if (parts[2] === "set") {
      const dirRaw = kv.get("direction") as Cardinal | undefined;
      if (dirRaw && CARDINALS.has(dirRaw)) {
        const speedWord = kv.get("speed");
        const speed = WIND_SPEEDS[speedWord ?? "medium"] ?? numberOr(speedWord, 8);
        const v = cardinalToVector(dirRaw);
        this.engine.setWind(v.x * speed, v.z * speed);
        this.write(`Wind set ${dirRaw} @ ${speed} blk/s.`);
        return;
      }
      const current = this.engine.getWind();
      this.engine.setWind(numberOr(kv.get("x"), current.x), numberOr(kv.get("z"), current.z));
      const w = this.engine.getWind();
      this.write(`Wind set to (${w.x.toFixed(1)}, ${w.z.toFixed(1)}).`);
      return;
    }

    if (parts[2] === "gust") {
      const strength = WIND_SPEEDS[kv.get("strength") ?? "strong"] ?? 16;
      const cur = this.engine.getWind();
      const dir = cur.speed > 0.1 ? cur.normalized() : { x: 1, z: 0 };
      this.engine.setWind(dir.x * strength, dir.z * strength);
      this.write(`Gust ${strength} blk/s (timed GustSystem staged — applied immediately).`);
      return;
    }

    const w = this.engine.getWind();
    this.write(`Wind=(${w.x.toFixed(2)},${w.z.toFixed(2)}). Usage: /weather wind set direction=east speed=strong | gust strength=violent`);
  }

  // --- /weather spawn <event> ... ------------------------------------------

  private handleSpawn(parts: string[]): void {
    const type = parts[2];
    const kv = parseKeyValues(parts);

    const dirRaw = (kv.get("direction") ?? "east") as Cardinal;
    if (!CARDINALS.has(dirRaw)) {
      this.write(`Unknown direction: ${dirRaw}. Use north|south|east|west|ne|nw|se|sw.`);
      return;
    }
    const dir = cardinalToVector(dirRaw);

    const levelRaw = (kv.get("intensity") ?? "moderate").toLowerCase();
    const level = INTENSITY_ALIASES[levelRaw];
    if (!level) {
      this.write(`Unknown intensity: ${levelRaw}. Use light|medium|strong|violent.`);
      return;
    }
    const intensity = intensityToValue(level);

    const o = this.engine.getObserver();
    // Place un centre `distance` blocs en amont, pour qu'il APPROCHE l'observateur.
    const at = (defaultDistance: number): { x: number; z: number } => {
      const d = numberOr(kv.get("distance"), defaultDistance);
      return { x: o.x - dir.x * d, z: o.z - dir.z * d };
    };

    switch (type) {
      case "cold_front": {
        const radius = numberOr(kv.get("radius"), 1400);
        // Placé en amont puis traverse l'observateur dans la direction donnée.
        this.engine.spawnColdFront(
          new ColdFrontEvent({
            x: o.x - dir.x * radius,
            z: o.z - dir.z * radius,
            radius,
            intensity,
            direction: dirRaw,
          }),
        );
        this.write(`Cold front spawned heading ${dirRaw} (intensity=${levelRaw}).`);
        break;
      }
      case "warm_front": {
        const radius = numberOr(kv.get("radius"), 1800);
        this.engine.spawnWarmFront(
          new WarmFrontEvent({
            x: o.x - dir.x * radius,
            z: o.z - dir.z * radius,
            radius,
            intensity,
            direction: dirRaw,
          }),
        );
        this.write(`Warm front spawned heading ${dirRaw} (intensity=${levelRaw}).`);
        break;
      }
      case "squall_line": {
        const length = numberOr(kv.get("length"), 3000);
        // Ligne large mais peu profonde : on l'amorce à une distance fixe en
        // amont (pas length/2) pour qu'elle balaie rapidement l'observateur.
        const lead = 1600;
        this.engine.spawnSquallLine(
          new SquallLineEvent({
            x: o.x - dir.x * lead,
            z: o.z - dir.z * lead,
            length,
            intensity,
            direction: dirRaw,
          }),
        );
        this.write(`Squall line spawned heading ${dirRaw}, length=${length} (intensity=${levelRaw}).`);
        break;
      }
      case "storm_cell": {
        const radius = numberOr(kv.get("radius"), 1200);
        const p = at(2000);
        const e = this.engine.spawnStormCell(radius, p.x, p.z);
        e.intensity = intensity;
        e.setDirection(dirRaw);
        this.write(`Storm cell spawned heading ${dirRaw} (intensity=${levelRaw}).`);
        break;
      }
      case "supercell": {
        // Orage géant, organisé : grand rayon + intensité maximale.
        const radius = numberOr(kv.get("radius"), 2800);
        const p = at(9000);
        const e = this.engine.spawnStormCell(radius, p.x, p.z);
        e.intensity = Math.max(intensity, 0.95);
        e.maxAge = 480;
        e.setDirection(dirRaw);
        this.write(`Supercell spawned heading ${dirRaw} (intensity=${levelRaw}).`);
        break;
      }
      case "rain_band": {
        const radius = numberOr(kv.get("width"), numberOr(kv.get("radius"), 900)) / 2 || 900;
        const p = at(2000);
        const e = this.engine.addEvent(new RainBandEvent({ x: p.x, z: p.z, radius, intensity, direction: dirRaw }));
        this.write(`Rain band spawned heading ${dirRaw} (intensity=${levelRaw}).`);
        break;
      }
      case "hailstorm": {
        // Orage (conditions) + grêle forcée au sol (blanchit puis fond).
        const radius = numberOr(kv.get("radius"), 1000);
        const e = this.engine.spawnStormCell(radius, undefined, undefined, "hail");
        e.intensity = intensity;
        this.ground?.forcePrecip("hail", intensity, 30);
        this.write(`Hailstorm (intensity=${levelRaw}). Ground will whiten then melt to water.`);
        break;
      }
      case "blizzard": {
        const radius = numberOr(kv.get("radius"), 3000);
        this.engine.setWind(WIND_SPEEDS.violent, 0); // neige soufflée
        this.ground?.forcePrecip("snow", Math.max(intensity, 0.8), 180);
        this.engine.spawnCloudyArea(radius);
        const event = this.engine.spawnStormCell(Math.max(1400, radius * 0.65), undefined, undefined, "snow");
        event.intensity = Math.max(intensity, 0.85);
        event.maxAge = 720;
        this.write(`Blizzard (intensity=${levelRaw}): driving snow, accumulating on the ground.`);
        break;
      }
      case "snow_squall": {
        const p = at(numberOr(kv.get("distance"), 1500));
        this.engine.setWind(dir.x * WIND_SPEEDS.strong, dir.z * WIND_SPEEDS.strong);
        this.ground?.forcePrecip("snow", intensity, 90);
        this.engine.spawnStormCell(1200, p.x, p.z, "snow").setDirection(dirRaw);
        this.write(`Snow squall heading ${dirRaw} (intensity=${levelRaw}).`);
        break;
      }
      case "fog_bank":
      case "sandstorm":
        // Rendu dédié (FogRenderer / dust wall) prévu en v0.5 — pas de fake ici.
        this.write(`'${type}' visual is staged for v0.5 (FogRenderer / dust wall). Engine hooks ready.`);
        break;
      default:
        this.write(
          "spawn: cold_front|warm_front|occluded_front|rain_band|shower|storm_cell|supercell|squall_line|hailstorm|snow_squall|blizzard|fog_bank|sandstorm",
        );
    }
  }

  private nearestEvent(): WeatherEvent | null {
    const o = this.engine.getObserver();
    let best: WeatherEvent | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const event of this.engine.getActiveEvents()) {
      const distance = Math.hypot(event.x - o.x, event.z - o.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = event;
      }
    }
    return best;
  }

  private eventEta(event: WeatherEvent): number {
    const o = this.engine.getObserver();
    const dx = o.x - event.x;
    const dz = o.z - event.z;
    const distance = Math.hypot(dx, dz);
    const approachingSpeed = -(dx * event.dirX + dz * event.dirZ) / Math.max(1, distance) * event.speed;
    if (distance <= event.radius) return 0;
    if (approachingSpeed <= 0.1) return Number.POSITIVE_INFINITY;
    return Math.round((distance - event.radius) / approachingSpeed);
  }
}

/** Parse les tokens "clé=valeur" d'une commande en map. */
function parseKeyValues(parts: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return map;
}

/** Convertit en nombre fini, sinon renvoie le défaut. */
function numberOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
