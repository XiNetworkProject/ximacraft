import { WeatherAlert } from "../alerts/WeatherAlert";
import { ForecastSystem } from "../forecast/ForecastSystem";
import { WeatherPredictionModel } from "../forecast/WeatherPredictionModel";
import { SurfaceWeatherState } from "../ground/SurfaceWeatherState";
import { WorldSnowSystem } from "../ground/WorldSnowSystem";
import { WeatherEngine } from "../WeatherEngine";
import { CELL_SIZE, PrecipKind, WeatherSample, WeatherType } from "../WeatherTypes";
import type { World } from "../../world/World";
import { BlockId } from "../../world/BlockTypes";
import type { RadarFieldSample, WeatherRadarHistory } from "./WeatherRadarHistory";

export interface WeatherMapSample {
  x: number;
  z: number;
  terrainHeight: number;
  biomeId: string;
  water: boolean;
  weatherType: WeatherType;
  temperature: number;
  humidity: number;
  pressure: number;
  cloudCover: number;
  precipitation: number;
  thunderRisk: number;
  rainRisk: number;
  snowRisk: number;
  hailRisk: number;
  fogRisk: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  snowDepth: number;
  hailDepth: number;
  wetness: number;
  iceDepth: number;
  surfaceTemperature: number;
  fogDensity: number;
  riverLevel: number;
  haze: number;
  precipitationKind: PrecipKind;
}

export interface WeatherMapEvent {
  id: number;
  type: string;
  x: number;
  z: number;
  radius: number;
  intensity: number;
  dirX: number;
  dirZ: number;
  speed: number;
  phase: string;
  etaSeconds?: number;
}

export interface WeatherMapStrike {
  x: number;
  z: number;
  intensity: number;
  age: number;
}

export interface WeatherMapData {
  centerX: number;
  centerZ: number;
  radius: number;
  cellSize: number;
  timeOffsetSeconds: number;
  samples: WeatherMapSample[];
  events: WeatherMapEvent[];
  alerts: WeatherAlert[];
  player: { x: number; z: number };
  /** Vrai si ces données proviennent de l'historique enregistré (relecture). */
  historical: boolean;
  /** Éclairs à afficher (relecture historique uniquement). */
  strikes: WeatherMapStrike[];
  /** Décalage (s, négatif) du plus ancien instantané radar disponible. */
  historyOldestOffset: number;
  /** Horizon de prévision maximal exposé par le curseur (s, positif). */
  forecastMaxOffset: number;
}

export interface WeatherMapBuildOptions {
  centerX: number;
  centerZ: number;
  radius?: number;
  timeOffsetSeconds?: number;
  alerts?: WeatherAlert[];
  surface?: SurfaceWeatherState;
  regionalSnow?: WorldSnowSystem;
  world?: World;
}

export class WeatherMapDataBuilder {
  private readonly model = new WeatherPredictionModel();

  constructor(
    private readonly engine: WeatherEngine,
    private readonly forecast: ForecastSystem,
    /** Optionnel : historique radar pour la relecture (timeOffset < 0). */
    private readonly history?: WeatherRadarHistory,
  ) {}

  build(options: WeatherMapBuildOptions): WeatherMapData {
    const radius = options.radius ?? 2400;
    const timeOffsetSeconds = options.timeOffsetSeconds ?? 0;
    // Relecture de l'historique réel : décalage négatif et données disponibles.
    if (timeOffsetSeconds < 0 && this.history?.hasData()) {
      return this.buildFromHistory(options, radius, timeOffsetSeconds);
    }
    const step = CELL_SIZE;
    const state = timeOffsetSeconds > 0 ? this.engine.state.clone() : this.engine.state;
    if (timeOffsetSeconds > 0) this.advance(state, timeOffsetSeconds);

    const samples: WeatherMapSample[] = [];
    for (let z = options.centerZ - radius; z <= options.centerZ + radius; z += step) {
      for (let x = options.centerX - radius; x <= options.centerX + radius; x += step) {
        const sample = state.sampleAt(x, z);
        samples.push(this.toMapSample(sample, x, z, options.surface, options.regionalSnow, options.world));
      }
    }

    const events = state.events.map((event) => {
      const timing = this.model.eventTiming([event], options.centerX, options.centerZ);
      return {
        id: event.id,
        type: event.type,
        x: event.x,
        z: event.z,
        radius: event.radius,
        intensity: event.intensity,
        dirX: event.dirX,
        dirZ: event.dirZ,
        speed: event.speed,
        phase: event.phase,
        etaSeconds: timing.etaSeconds,
      };
    });

    return {
      centerX: options.centerX,
      centerZ: options.centerZ,
      radius,
      cellSize: step,
      timeOffsetSeconds,
      samples,
      events,
      alerts: options.alerts ?? [],
      player: this.engine.getObserver(),
      historical: false,
      strikes: [],
      historyOldestOffset: this.history ? this.history.oldestOffset(this.engine) : 0,
      forecastMaxOffset: 6 * 60 * 60,
    };
  }

  /** Construit les données de carte depuis l'historique enregistré (relecture). */
  private buildFromHistory(
    options: WeatherMapBuildOptions,
    radius: number,
    timeOffsetSeconds: number,
  ): WeatherMapData {
    const history = this.history!;
    const step = CELL_SIZE;
    const simTime = this.engine.state.time + timeOffsetSeconds;

    const samples: WeatherMapSample[] = [];
    for (let z = options.centerZ - radius; z <= options.centerZ + radius; z += step) {
      for (let x = options.centerX - radius; x <= options.centerX + radius; x += step) {
        const field = history.sampleField(simTime, x, z);
        samples.push(this.toHistoryMapSample(field, x, z, options.surface, options.regionalSnow, options.world));
      }
    }

    const events: WeatherMapEvent[] = history.eventsAt(simTime).map((event) => ({
      id: event.id,
      type: event.type,
      x: event.x,
      z: event.z,
      radius: event.radius,
      intensity: event.intensity,
      dirX: event.dirX,
      dirZ: event.dirZ,
      speed: event.speed,
      phase: event.phase,
    }));

    const strikes: WeatherMapStrike[] = history.strikesAt(simTime).map((strike) => ({
      x: strike.x,
      z: strike.z,
      intensity: strike.intensity,
      age: Math.abs(simTime - strike.time),
    }));

    return {
      centerX: options.centerX,
      centerZ: options.centerZ,
      radius,
      cellSize: step,
      timeOffsetSeconds,
      samples,
      events,
      alerts: options.alerts ?? [],
      player: this.engine.getObserver(),
      historical: true,
      strikes,
      historyOldestOffset: history.oldestOffset(this.engine),
      forecastMaxOffset: 6 * 60 * 60,
    };
  }

  nearestSample(data: WeatherMapData, x: number, z: number): WeatherMapSample | null {
    let best: WeatherMapSample | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const sample of data.samples) {
      const distance = Math.hypot(sample.x - x, sample.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = sample;
      }
    }
    return best;
  }

  private toMapSample(
    sample: WeatherSample,
    x: number,
    z: number,
    surface?: SurfaceWeatherState,
    regionalSnow?: WorldSnowSystem,
    world?: World,
  ): WeatherMapSample {
    const prediction = this.model.snapshot(0, { id: "map", name: "Carte", x, z, radius: CELL_SIZE }, sample, { volatility: 0 });
    const column = surface?.get(x, z);
    const terrainHeight = world?.getSurfaceHeight(x, z) ?? 0;
    const biome = world?.getBiomeAt(x, z);
    const water = this.isWater(world, x, z, terrainHeight);
    const fogDensity = Math.max(prediction.fogRisk * 0.72, sample.humidity > 0.82 && sample.windSpeed < 7 ? (sample.humidity - 0.82) * 2.2 : 0);
    const riverLevel = Math.max(0, Math.min(1, (water ? 0.64 : 0.28) + (column?.wetness ?? 0) * 0.18 + sample.precipitation * 0.24));
    return {
      x,
      z,
      terrainHeight,
      biomeId: biome?.id ?? "unknown",
      water,
      weatherType: sample.weatherType,
      temperature: sample.temperature,
      humidity: sample.humidity,
      pressure: sample.pressure,
      cloudCover: sample.cloudCover,
      precipitation: sample.precipitation,
      thunderRisk: sample.thunderRisk,
      rainRisk: prediction.rainRisk,
      snowRisk: prediction.snowRisk,
      hailRisk: prediction.hailRisk,
      fogRisk: prediction.fogRisk,
      windX: sample.windX,
      windZ: sample.windZ,
      windSpeed: sample.windSpeed,
      snowDepth: Math.max(column?.snowDepth ?? 0, regionalSnow?.depthAt(x, z) ?? 0),
      hailDepth: column?.hailDepth ?? 0,
      wetness: column?.wetness ?? 0,
      iceDepth: column?.iceDepth ?? 0,
      surfaceTemperature: sample.temperature - (column?.snowDepth ?? 0) * 2 - (column?.iceDepth ?? 0) * 1.4,
      fogDensity,
      riverLevel,
      haze: Math.max(fogDensity, Math.max(0, sample.temperature - 28) / 20 * (1 - sample.humidity)),
      precipitationKind: sample.precipitation < 0.04 ? "none" : sample.temperature <= 1 ? "snow" : sample.thunderRisk > 0.55 && sample.temperature < 18 ? "hail" : "rain",
    };
  }

  /** Variante historique : champs radar issus d'un instantané enregistré. */
  private toHistoryMapSample(
    field: RadarFieldSample | null,
    x: number,
    z: number,
    surface?: SurfaceWeatherState,
    regionalSnow?: WorldSnowSystem,
    world?: World,
  ): WeatherMapSample {
    const column = surface?.get(x, z);
    const terrainHeight = world?.getSurfaceHeight(x, z) ?? 0;
    const biome = world?.getBiomeAt(x, z);
    const water = this.isWater(world, x, z, terrainHeight);
    const f: RadarFieldSample = field ?? {
      precipitation: 0,
      precipitationKind: "none",
      cloudCover: 0,
      thunderRisk: 0,
      temperature: 12,
      pressure: 1013,
      windX: 0,
      windZ: 0,
      windSpeed: 0,
      fogDensity: 0,
    };
    const rainRisk = f.precipitationKind === "rain" ? f.precipitation : 0;
    const snowRisk = f.precipitationKind === "snow" ? f.precipitation : 0;
    const hailRisk = f.precipitationKind === "hail" ? f.precipitation : 0;
    const riverLevel = Math.max(0, Math.min(1, (water ? 0.64 : 0.28) + (column?.wetness ?? 0) * 0.18 + f.precipitation * 0.24));
    return {
      x,
      z,
      terrainHeight,
      biomeId: biome?.id ?? "unknown",
      water,
      weatherType: classifyWeatherType(f),
      temperature: f.temperature,
      humidity: Math.min(1, 0.45 + f.cloudCover * 0.4 + f.precipitation * 0.3),
      pressure: f.pressure,
      cloudCover: f.cloudCover,
      precipitation: f.precipitation,
      thunderRisk: f.thunderRisk,
      rainRisk,
      snowRisk,
      hailRisk,
      fogRisk: f.fogDensity,
      windX: f.windX,
      windZ: f.windZ,
      windSpeed: f.windSpeed,
      snowDepth: Math.max(column?.snowDepth ?? 0, regionalSnow?.depthAt(x, z) ?? 0),
      hailDepth: column?.hailDepth ?? 0,
      wetness: column?.wetness ?? 0,
      iceDepth: column?.iceDepth ?? 0,
      surfaceTemperature: f.temperature - (column?.snowDepth ?? 0) * 2 - (column?.iceDepth ?? 0) * 1.4,
      fogDensity: f.fogDensity,
      riverLevel,
      haze: Math.max(f.fogDensity, Math.max(0, f.temperature - 28) / 20),
      precipitationKind: f.precipitationKind,
    };
  }

  private isWater(world: World | undefined, x: number, z: number, terrainHeight: number): boolean {
    if (!world) return terrainHeight <= 48;
    const y = world.getSurfaceHeight(x, z);
    return world.getBlock(Math.floor(x), y, Math.floor(z)) === BlockId.WATER || world.getBlock(Math.floor(x), y + 1, Math.floor(z)) === BlockId.WATER;
  }

  private advance(state: ReturnType<WeatherEngine["state"]["clone"]>, seconds: number): void {
    let remaining = seconds;
    while (remaining > 0) {
      const dt = Math.min(remaining, remaining > 60 * 60 ? 15 : 3);
      state.update(dt);
      remaining -= dt;
    }
  }
}

/** Classe un champ radar enregistré en type météo affichable. */
function classifyWeatherType(field: RadarFieldSample): WeatherType {
  if (field.precipitation > 0.04) {
    if (field.precipitationKind === "snow") return WeatherType.SNOW;
    if (field.thunderRisk > 0.5 || field.precipitationKind === "hail") return WeatherType.THUNDERSTORM;
    return field.precipitation > 0.45 ? WeatherType.HEAVY_RAIN : WeatherType.LIGHT_RAIN;
  }
  if (field.fogDensity > 0.18) return WeatherType.FOG;
  if (field.cloudCover > 0.7) return WeatherType.OVERCAST;
  if (field.cloudCover > 0.35) return WeatherType.CLOUDY;
  if (field.cloudCover > 0.12) return WeatherType.PARTLY_CLOUDY;
  return WeatherType.CLEAR;
}
