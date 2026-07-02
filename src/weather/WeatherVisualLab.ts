import { ConvectiveCloudSystem } from "../clouds/ConvectiveCloudSystem";
import type { CumulusRegimeName } from "../clouds/FairWeatherCumulusField";
import { GroundAccumulationSystem } from "./ground/GroundAccumulationSystem";
import { SurfaceWeatherState } from "./ground/SurfaceWeatherState";
import { WeatherEngine } from "./WeatherEngine";
import { classifyWeather } from "./WeatherMath";
import { CELL_SIZE, WeatherEventType } from "./WeatherTypes";
import { PrecipitationKind, SkyState, SynopticRegime } from "./scene/WeatherScene";
import { WeatherScenarioDirector } from "./scene/WeatherScenarioDirector";

export type WeatherVisualScenarioName =
  | "clear"
  | "fair_cumulus"
  | "cumulus_clear"
  | "cumulus_sparse"
  | "cumulus_classic"
  | "cumulus_broken"
  | "cumulus_dominant"
  | "cumulus_humid"
  | "overcast"
  | "rain_front"
  | "rain_front_far"
  | "rain_front_approaching"
  | "rain_front_local"
  | "valley_fog"
  | "snow_squall"
  | "thunderstorm";

export const WEATHER_VISUAL_SCENARIOS: readonly WeatherVisualScenarioName[] = [
  "clear",
  "fair_cumulus",
  "cumulus_clear",
  "cumulus_sparse",
  "cumulus_classic",
  "cumulus_broken",
  "cumulus_dominant",
  "cumulus_humid",
  "overcast",
  "rain_front",
  "rain_front_far",
  "rain_front_approaching",
  "rain_front_local",
  "valley_fog",
  "snow_squall",
  "thunderstorm",
];

export interface WeatherVisualLabResult {
  scenario: WeatherVisualScenarioName;
  label: string;
  forcedTime: string;
  expected: string;
  renderers: string[];
  warnings: string[];
  incomplete?: string;
}

export interface WeatherVisualLabTargets {
  engine: WeatherEngine;
  scenarios: WeatherScenarioDirector;
  convectiveClouds: ConvectiveCloudSystem;
  resetCloudVisuals?: () => void;
  groundSystem?: GroundAccumulationSystem;
  surfaceState?: SurfaceWeatherState;
  radarHistory?: { reset(): void };
  lightning?: { reset(): void };
  cumulusField?: { reset(): void; setRegime(regime: CumulusRegimeName | null): void };
  rainCurtains?: { setEnabled(enabled: boolean): void; clear(): void };
  setTime?: (name: string) => void;
  setLegacyWeather?: (type: string, duration?: number, intensity?: number) => void;
}

interface PaintOptions {
  cloudCover: number;
  humidity: number;
  instability: number;
  temperature: number;
  pressure?: number;
  windX?: number;
  windZ?: number;
  precipitation?: number;
  thunderRisk?: number;
  clearingBias?: number;
  radiusCells?: number;
}

const RAIN_CURTAINS_WARNING = "RainCurtainRenderer distant desactive: artefact colonnes/grille connu.";

export function resetWeatherVisualLabState(targets: WeatherVisualLabTargets): void {
  targets.engine.reset();
  targets.scenarios.reset();
  targets.scenarios.hold(SynopticRegime.STABLE_HIGH_PRESSURE, 900);
  targets.engine.setWind(2.5, 0.8);
  targets.resetCloudVisuals?.();
  targets.convectiveClouds.clear();
  targets.cumulusField?.reset();
  targets.cumulusField?.setRegime(null);
  targets.groundSystem?.clearOverride();
  targets.surfaceState?.clear();
  targets.radarHistory?.reset();
  targets.lightning?.reset();
  targets.rainCurtains?.setEnabled(false);
  targets.rainCurtains?.clear();
  targets.setLegacyWeather?.("clear", 900, 0);
  targets.setTime?.("day");
  paintWeatherLabCells(targets.engine, {
    cloudCover: 0.03,
    humidity: 0.28,
    instability: 0.04,
    temperature: 17,
    pressure: 1018,
    windX: 2.5,
    windZ: 0.8,
    precipitation: 0,
    thunderRisk: 0,
    clearingBias: 0,
    radiusCells: 8,
  });
}

export function startWeatherVisualLabScenario(
  scenario: WeatherVisualScenarioName,
  targets: WeatherVisualLabTargets,
): WeatherVisualLabResult {
  resetWeatherVisualLabState(targets);
  targets.rainCurtains?.setEnabled(false);
  targets.rainCurtains?.clear();
  const origin = targets.engine.getObserver();

  switch (scenario) {
    case "clear":
      targets.setTime?.("day");
      return {
        scenario,
        label: "Ciel clair stable",
        forcedTime: "day",
        expected: "Zero evenement, zero cumulus convectif, aucune precipitation.",
        renderers: ["SkySystem"],
        warnings: [RAIN_CURTAINS_WARNING],
      };

    case "fair_cumulus": {
      targets.setTime?.("day");
      targets.scenarios.hold(SynopticRegime.HUMID_HIGH_PRESSURE, 900);
      // Phase 2B-1 : le champ de cumulus world-space REMPLACE les 5 masses fixes.
      // On force l'état de ciel cumulus de beau temps → le FairWeatherCumulusField
      // s'active (streaming air-mass), sans pluie/orage/deck stratiforme.
      targets.scenarios.forceSky(SkyState.FAIR_WEATHER_CUMULUS, 900, "none");
      targets.scenarios.forcePrecipitation(PrecipitationKind.NONE, 0, 900, "none", false);
      paintWeatherLabCells(targets.engine, {
        cloudCover: 0.3,
        humidity: 0.54,
        instability: 0.14,
        temperature: 18,
        pressure: 1016,
        windX: 4,
        windZ: 1.2,
        radiusCells: 9,
      });
      return {
        scenario,
        label: "Champ de cumulus de beau temps",
        forcedTime: "day",
        expected: "Champ de cumulus world-space (proche->horizon) qui derive avec le vent, sans pluie, sans orage, sans deck stratiforme.",
        renderers: ["FairWeatherCumulusField", "CumulusFieldRenderer", "SkySystem"],
        warnings: [RAIN_CURTAINS_WARNING],
      };
    }

    case "cumulus_clear":
      activateCumulusRegime(targets, "crystal_clear", SkyState.FAIR_WEATHER_CUMULUS, { cloudCover: 0.14, humidity: 0.4 });
      return cumulusRegimeResult(scenario, "Ciel presque dégagé (rares humilis)", "Presque aucun nuage, quelques humilis très espacés, tout sec.");

    case "cumulus_sparse":
      activateCumulusRegime(targets, "sparse_fair_cumulus", SkyState.FAIR_WEATHER_CUMULUS, { cloudCover: 0.26, humidity: 0.5 });
      return cumulusRegimeResult(scenario, "Cumulus épars", "Peu de cumulus, beaucoup de ciel bleu, tout sec.");

    case "cumulus_classic":
      activateCumulusRegime(targets, "classic_fair_cumulus", SkyState.FAIR_WEATHER_CUMULUS, { cloudCover: 0.34, humidity: 0.54 });
      return cumulusRegimeResult(scenario, "Cumulus de beau temps classiques", "Ciel classique varié et équilibré, du proche à l'horizon, tout sec.");

    case "cumulus_broken":
      activateCumulusRegime(targets, "broken_fair_weather", SkyState.BROKEN_CUMULUS, { cloudCover: 0.55, humidity: 0.6 });
      return cumulusRegimeResult(scenario, "Beau temps fragmenté", "Beaucoup de masses avec de grandes clairières bleues, tout sec.");

    case "cumulus_dominant":
      activateCumulusRegime(targets, "dominant_cumulus_day", SkyState.FAIR_WEATHER_CUMULUS, { cloudCover: 0.32, humidity: 0.56 });
      return cumulusRegimeResult(scenario, "Journée à formation dominante", "Une ou deux grosses formations principales entourées de petits cumulus, tout sec.");

    case "cumulus_humid":
      activateCumulusRegime(targets, "humid_summer_cumulus", SkyState.SCATTERED_CUMULUS, { cloudCover: 0.5, humidity: 0.82 });
      return cumulusRegimeResult(scenario, "Cumulus d'été humide", "Cumulus plus gros, plus verticaux et lumineux, mais jamais cumulonimbus ni pluie.");

    case "overcast":
      targets.setTime?.("noon");
      targets.scenarios.hold(SynopticRegime.WEAK_LOW_PRESSURE, 900);
      targets.scenarios.forceSky(SkyState.STRATOCUMULUS_OVERCAST, 900, "none");
      targets.scenarios.forcePrecipitation(PrecipitationKind.NONE, 0, 900, "none", false);
      paintWeatherLabCells(targets.engine, {
        cloudCover: 0.82,
        humidity: 0.54,
        instability: 0.05,
        temperature: 13,
        pressure: 1009,
        windX: 3.5,
        windZ: 0.5,
        radiusCells: 8,
      });
      return {
        scenario,
        label: "Couvert sec",
        forcedTime: "noon",
        expected: "Deck stratiforme world-space visible, gris/diffus, sans orage ni pluie.",
        renderers: ["SkySystem atmosphere", "StratiformCloudRenderer"],
        warnings: [RAIN_CURTAINS_WARNING],
      };

    case "rain_front":
      return activateRainFrontScenario(scenario, targets, origin, "Front pluvieux stratiforme", 4300, 10, "mid");

    case "rain_front_far":
      return activateRainFrontScenario(scenario, targets, origin, "Front pluvieux lointain", 7600, 8, "far");

    case "rain_front_approaching":
      return activateRainFrontScenario(scenario, targets, origin, "Front pluvieux en approche", 4300, 10, "mid");

    case "rain_front_local":
      return activateRainFrontScenario(scenario, targets, origin, "Front pluvieux sur le joueur", 900, 8, "local");

    case "valley_fog":
      targets.setTime?.("sunrise");
      targets.scenarios.hold(SynopticRegime.FOG_PRONE_NIGHT, 900);
      targets.engine.setWind(0.9, 0.25);
      paintWeatherLabCells(targets.engine, {
        cloudCover: 0.22,
        humidity: 0.94,
        instability: 0.01,
        temperature: 5,
        pressure: 1017,
        windX: 0.9,
        windZ: 0.25,
        radiusCells: 9,
      });
      return {
        scenario,
        label: "Brouillard de vallee",
        forcedTime: "sunrise",
        expected: "Air tres humide, vent faible, brouillard monde via FogBankRenderer.",
        renderers: ["FogBankRenderer", "SkySystem"],
        warnings: [RAIN_CURTAINS_WARNING],
      };

    case "snow_squall": {
      targets.setTime?.("noon");
      targets.scenarios.hold(SynopticRegime.COLD_CLEAR_OUTBREAK, 900);
      targets.engine.setWind(0, 8);
      paintWeatherLabCells(targets.engine, {
        cloudCover: 0.22,
        humidity: 0.52,
        instability: 0.12,
        temperature: -5,
        pressure: 1011,
        windX: 0,
        windZ: 8,
        radiusCells: 8,
      });
      const cell = targets.engine.spawnStormCell(1450, origin.x, origin.z - 4200, "snow");
      cell.intensity = 0.72;
      cell.maxAge = 620;
      cell.speed = 9;
      cell.cloudBaseY = 245;
      cell.producesLightning = false;
      cell.setDirection({ x: 0, z: 1 });
      return {
        scenario,
        label: "Grain de neige mobile",
        forcedTime: "noon",
        expected: "Une cellule neigeuse distante; neige locale seulement quand elle atteint le joueur.",
        renderers: ["CloudVolumeRenderer", "PrecipitationRenderer local"],
        warnings: [RAIN_CURTAINS_WARNING],
      };
    }

    case "thunderstorm": {
      targets.setTime?.("afternoon");
      targets.scenarios.hold(SynopticRegime.ISOLATED_CONVECTION, 900);
      targets.engine.setWind(2, 7);
      paintWeatherLabCells(targets.engine, {
        cloudCover: 0.16,
        humidity: 0.48,
        instability: 0.28,
        temperature: 22,
        pressure: 1010,
        windX: 2,
        windZ: 7,
        radiusCells: 8,
      });
      const cell = targets.engine.spawnStormCell(1750, origin.x - 900, origin.z - 5200, "rain");
      cell.intensity = 0.88;
      cell.maxAge = 720;
      cell.speed = 8;
      cell.cloudBaseY = 320;
      cell.producesLightning = true;
      cell.setDirection({ x: 0.16, z: 1 });
      return {
        scenario,
        label: "Orage isole distant",
        forcedTime: "afternoon",
        expected: "Exactement une cellule orageuse, ciel bleu autour, precipitation sous la cellule.",
        renderers: ["CloudVolumeRenderer", "LightningRenderer", "PrecipitationRenderer local"],
        warnings: [RAIN_CURTAINS_WARNING],
      };
    }
  }
}

function activateRainFrontScenario(
  scenario: WeatherVisualScenarioName,
  targets: WeatherVisualLabTargets,
  origin: { x: number; z: number },
  label: string,
  distanceAhead: number,
  speed: number,
  mode: "far" | "mid" | "local",
): WeatherVisualLabResult {
  targets.setTime?.("noon");
  targets.scenarios.hold(SynopticRegime.OCCLUDED_FRONT, 900);
  targets.scenarios.forceSky(SkyState.MID_OVERCAST, 900, "none");
  if (mode !== "local") {
    targets.scenarios.forcePrecipitation(PrecipitationKind.NONE, 0, 900, "none", false);
  }
  paintWeatherLabCells(targets.engine, {
    cloudCover: mode === "local" ? 0.9 : 0.58,
    humidity: mode === "local" ? 0.86 : 0.58,
    instability: 0.08,
    temperature: 12,
    pressure: 1007,
    windX: 0,
    windZ: 6,
    radiusCells: 9,
    precipitation: mode === "local" ? 0.22 : 0,
  });
  const band = targets.engine.spawnRainBand(3600, origin.x, origin.z - distanceAhead);
  band.intensity = mode === "local" ? 0.78 : 0.68;
  band.maxAge = 760;
  band.speed = speed;
  band.cloudBaseY = 130;
  band.producesLightning = false;
  band.setDirection({ x: 0, z: 1 });
  return {
    scenario,
    label,
    forcedTime: "noon",
    expected: mode === "local"
      ? "La rain_band couvre le joueur: pluie locale active, champ distant attenue, aucun orage."
      : mode === "mid"
        ? "Rain shafts distants visibles sous nimbostratus, front en approche, pluie locale encore coupee."
        : "Voile gris-bleu tres lointain sous nimbostratus, aucune pluie locale.",
    renderers: ["WeatherEngine rain_band", "StratiformCloudRenderer", "DistantPrecipitationRenderer", "PrecipitationRenderer local quand le front atteint le joueur"],
    warnings: [RAIN_CURTAINS_WARNING],
  };
}

function activateCumulusRegime(
  targets: WeatherVisualLabTargets,
  regime: CumulusRegimeName,
  sky: SkyState,
  opts: { cloudCover: number; humidity: number; windX?: number; windZ?: number; temperature?: number },
): void {
  targets.setTime?.("day");
  targets.scenarios.hold(SynopticRegime.HUMID_HIGH_PRESSURE, 900);
  targets.scenarios.forceSky(sky, 900, "none");
  targets.scenarios.forcePrecipitation(PrecipitationKind.NONE, 0, 900, "none", false);
  paintWeatherLabCells(targets.engine, {
    cloudCover: opts.cloudCover,
    humidity: opts.humidity,
    instability: 0.12,
    temperature: opts.temperature ?? 18,
    pressure: 1016,
    windX: opts.windX ?? 4,
    windZ: opts.windZ ?? 1.2,
    radiusCells: 10,
  });
  targets.cumulusField?.setRegime(regime);
}

function cumulusRegimeResult(
  scenario: WeatherVisualScenarioName,
  label: string,
  expected: string,
): WeatherVisualLabResult {
  return {
    scenario,
    label,
    forcedTime: "day",
    expected,
    renderers: ["FairWeatherCumulusField", "CumulusFieldRenderer", "SkySystem"],
    warnings: [RAIN_CURTAINS_WARNING],
  };
}

export function paintWeatherLabCells(engine: WeatherEngine, options: PaintOptions): void {
  const observer = engine.getObserver();
  const radius = options.radiusCells ?? 8;
  const baseCellX = Math.floor(observer.x / CELL_SIZE);
  const baseCellZ = Math.floor(observer.z / CELL_SIZE);
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cell = engine.getCellAt((baseCellX + dx) * CELL_SIZE + 1, (baseCellZ + dz) * CELL_SIZE + 1);
      cell.baseline.cloudCover = options.cloudCover;
      cell.baseline.humidity = options.humidity;
      cell.baseline.instability = options.instability;
      cell.baseline.temperature = options.temperature;
      cell.baseline.pressure = options.pressure ?? 1013;
      cell.baseline.windX = options.windX ?? 0;
      cell.baseline.windZ = options.windZ ?? 0;
      cell.cloudCover = options.cloudCover;
      cell.humidity = options.humidity;
      cell.instability = options.instability;
      cell.temperature = options.temperature;
      cell.pressure = options.pressure ?? 1013;
      cell.windX = options.windX ?? 0;
      cell.windZ = options.windZ ?? 0;
      cell.precipitation = options.precipitation ?? 0;
      cell.thunderRisk = options.thunderRisk ?? 0;
      cell.clearingBias = options.clearingBias ?? 0;
      cell.weatherType = classifyWeather(cell);
    }
  }
}

export function visualLabStormCellCount(engine: WeatherEngine): number {
  return engine.getActiveEvents().filter((event) => event.type === WeatherEventType.STORM_CELL).length;
}
