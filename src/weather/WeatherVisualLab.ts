import { ConvectiveCloudSystem } from "../clouds/ConvectiveCloudSystem";
import { GroundAccumulationSystem } from "./ground/GroundAccumulationSystem";
import { SurfaceWeatherState } from "./ground/SurfaceWeatherState";
import { WeatherEngine } from "./WeatherEngine";
import { classifyWeather } from "./WeatherMath";
import { CELL_SIZE, WeatherEventType } from "./WeatherTypes";
import { SynopticRegime } from "./scene/WeatherScene";
import { WeatherScenarioDirector } from "./scene/WeatherScenarioDirector";

export type WeatherVisualScenarioName =
  | "clear"
  | "fair_cumulus"
  | "overcast"
  | "rain_front"
  | "valley_fog"
  | "snow_squall"
  | "thunderstorm";

export const WEATHER_VISUAL_SCENARIOS: readonly WeatherVisualScenarioName[] = [
  "clear",
  "fair_cumulus",
  "overcast",
  "rain_front",
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

const BASE_RENDERERS = ["SkySystem", "CloudVolumeRenderer", "PrecipitationRenderer local"];
const RAIN_CURTAINS_WARNING = "RainCurtainRenderer distant desactive: artefact colonnes/grille connu.";

export function resetWeatherVisualLabState(targets: WeatherVisualLabTargets): void {
  targets.engine.reset();
  targets.scenarios.reset();
  targets.scenarios.hold(SynopticRegime.STABLE_HIGH_PRESSURE, 900);
  targets.engine.setWind(2.5, 0.8);
  targets.resetCloudVisuals?.();
  targets.convectiveClouds.clear();
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
      paintWeatherLabCells(targets.engine, {
        cloudCover: 0.16,
        humidity: 0.52,
        instability: 0.22,
        temperature: 18,
        pressure: 1016,
        windX: 4,
        windZ: 1.2,
        radiusCells: 8,
      });
      const count = 5;
      for (let i = 0; i < count; i += 1) {
        const angle = -0.9 + i * 0.42;
        const distance = 1300 + i * 430;
        const mass = targets.convectiveClouds.spawnAt(
          origin.x + Math.cos(angle) * distance,
          origin.z - 900 - Math.sin(angle) * distance,
          { humidity: 0.56, instability: 0.22 },
        );
        mass.primeForTest("cumulus");
        mass.puffBudget = 70;
        mass.precipitationRate = 0;
        mass.stormVisual.precip = "none";
      }
      return {
        scenario,
        label: "Cumulus de beau temps",
        forcedTime: "day",
        expected: "3 a 6 petits cumulus raymarches, separes, non precipitants.",
        renderers: BASE_RENDERERS.slice(0, 2),
        warnings: [RAIN_CURTAINS_WARNING],
      };
    }

    case "overcast":
      targets.setTime?.("noon");
      targets.scenarios.hold(SynopticRegime.WEAK_LOW_PRESSURE, 900);
      paintWeatherLabCells(targets.engine, {
        cloudCover: 0.82,
        humidity: 0.64,
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
        expected: "Aucun orage residuel. Le deck stratiforme final n'est pas encore implemente.",
        renderers: ["SkySystem"],
        warnings: [RAIN_CURTAINS_WARNING],
        incomplete: "Couche stratiforme non implementee.",
      };

    case "rain_front": {
      targets.setTime?.("noon");
      targets.scenarios.hold(SynopticRegime.OCCLUDED_FRONT, 900);
      paintWeatherLabCells(targets.engine, {
        cloudCover: 0.58,
        humidity: 0.58,
        instability: 0.08,
        temperature: 12,
        pressure: 1007,
        windX: 0,
        windZ: 6,
        radiusCells: 9,
      });
      const band = targets.engine.spawnRainBand(3200, origin.x, origin.z - 5600);
      band.intensity = 0.68;
      band.maxAge = 760;
      band.speed = 8;
      band.cloudBaseY = 130;
      band.setDirection({ x: 0, z: 1 });
      return {
        scenario,
        label: "Front pluvieux stratiforme",
        forcedTime: "noon",
        expected: "Une seule bande de pluie mobile, sans cellule orageuse ni eclair.",
        renderers: ["WeatherEngine rain_band", "PrecipitationRenderer local quand le front arrive"],
        warnings: [RAIN_CURTAINS_WARNING],
      };
    }

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
