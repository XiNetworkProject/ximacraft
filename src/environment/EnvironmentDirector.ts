import { WORLD_DAY_TICKS } from "../utils/Constants";
import { WeatherEngine } from "../weather/WeatherEngine";
import { WeatherSample } from "../weather/WeatherTypes";
import type { PrecipKind } from "../weather/WeatherTypes";
import { SurfaceWeatherState } from "../weather/ground/SurfaceWeatherState";
import { SeasonSystem } from "../living/SeasonSystem";
import { World } from "../world/World";
import { BlockId } from "../world/BlockTypes";
import { EnvironmentState } from "./EnvironmentState";
import { FogBankSystem } from "./FogBankSystem";
import type { FogBankRenderSample } from "./FogBankSystem";
import { SurfaceConditionSystem } from "./SurfaceConditionSystem";
import { ThermalComfortSystem } from "./ThermalComfortSystem";
import { WorldPhenologySystem } from "./WorldPhenologySystem";
import { clamp } from "../utils/MathUtils";

export interface EnvironmentDirectorUpdateInput {
  delta: number;
  world: World;
  surfaceState: SurfaceWeatherState;
  ticks: number;
  player: { x: number; y: number; z: number };
  dayFactor: number;
  exposedToSky: number;
}

export class EnvironmentDirector {
  private readonly thermal = new ThermalComfortSystem();
  private readonly surface = new SurfaceConditionSystem();
  private readonly phenology = new WorldPhenologySystem();
  private readonly fogBanks = new FogBankSystem();
  private current: EnvironmentState | null = null;
  private forcedTemperature: number | null = null;
  private forcedWind: { speed: number; directionDegrees: number } | null = null;

  constructor(
    private readonly weather: WeatherEngine,
    private readonly seasons: SeasonSystem,
    private readonly seedProvider: () => string,
  ) {}

  update(input: EnvironmentDirectorUpdateInput): EnvironmentState {
    const rawSample = this.weather.sampleObserver();
    const sample = this.applyForces(rawSample);
    const season = this.seasons.sample(input.ticks);
    const timeOfDay = ((input.ticks % WORLD_DAY_TICKS) + WORLD_DAY_TICKS) % WORLD_DAY_TICKS / WORLD_DAY_TICKS;
    const biome = input.world.getBiomeAt(input.player.x, input.player.z);
    const altitudeCooling = Math.max(0, input.player.y - 72) * 0.0065;
    const temperature = sample.temperature + season.temperatureOffset * 0.45 - altitudeCooling;
    const adjustedSample: WeatherSample = { ...sample, temperature };
    const dewPoint = dewPointC(temperature, sample.humidity);
    const surface = this.surface.resolve({
      x: input.player.x,
      z: input.player.z,
      weather: adjustedSample,
      dewPoint,
      dayFactor: input.dayFactor,
      exposedToSky: input.exposedToSky,
      surfaceState: input.surfaceState,
    });
    const sunExposure = clamp(input.dayFactor * (1 - sample.cloudCover * 0.82) * input.exposedToSky, 0, 1);
    const thermal = this.thermal.resolve({
      temperature,
      humidity: sample.humidity,
      windSpeed: sample.windSpeed,
      sunExposure,
      precipitation: sample.precipitation,
    });
    const waterNearby = this.waterPresence(input.world, input.player.x, input.player.z);
    const valleyFactor = this.valleyFactor(input.world, input.player.x, input.player.z);
    const fog = this.fogBanks.update(input.delta, {
      seed: this.seedProvider(),
      playerX: input.player.x,
      playerZ: input.player.z,
      humidity: sample.humidity,
      dewPoint,
      temperature,
      windX: sample.windX,
      windZ: sample.windZ,
      windSpeed: sample.windSpeed,
      dayFactor: input.dayFactor,
      precipitation: sample.precipitation,
      waterNearby,
      valleyFactor,
    });
    const visual = this.phenology.resolve(season, surface, temperature, sample.humidity, input.dayFactor);
    const state: EnvironmentState = {
      season,
      dayOfSeason: Math.floor(season.progress * 24),
      weather: adjustedSample,
      timeOfDay,
      hour: timeOfDay * 24,
      dayFactor: input.dayFactor,
      altitude: input.player.y,
      biomeId: biome.id,
      temperature,
      humidity: sample.humidity,
      pressure: sample.pressure,
      dewPoint,
      windSpeed: sample.windSpeed,
      windDirectionDegrees: windDirectionDegrees(sample.windX, sample.windZ),
      gustSpeed: sample.windSpeed * (1.15 + sample.thunderRisk * 0.55 + sample.precipitation * 0.22),
      cloudCover: sample.cloudCover,
      precipitation: sample.precipitation,
      weatherType: sample.weatherType,
      precipitationKind: this.precipitationKind(adjustedSample),
      thunderRisk: sample.thunderRisk,
      sunExposure,
      riverLevel: this.riverLevel(waterNearby, season.season, surface.wetness, sample.precipitation),
      fauna: this.faunaState(season, adjustedSample, timeOfDay, surface),
      airQuality: this.airQuality(adjustedSample, sunExposure, fog.density),
      surface,
      thermal,
      fog,
      visual,
    };
    this.current = state;
    return state;
  }

  private precipitationKind(sample: WeatherSample): PrecipKind {
    if (sample.precipitation < 0.04) return "none";
    if (sample.temperature <= 1) return "snow";
    if (sample.thunderRisk > 0.55 && sample.temperature < 18 && sample.precipitation > 0.45) return "hail";
    return "rain";
  }

  private riverLevel(waterNearby: number, season: string, wetness: number, precipitation: number): number {
    const springMelt = season === "spring" ? 0.16 : season === "winter" ? -0.08 : 0;
    const rainRise = precipitation * 0.32 + wetness * 0.18;
    return clamp(0.38 + waterNearby * 0.22 + springMelt + rainRise, 0, 1);
  }

  private faunaState(
    season: ReturnType<SeasonSystem["sample"]>,
    sample: WeatherSample,
    timeOfDay: number,
    surface: { wetness: number; snowDepth: number },
  ): EnvironmentState["fauna"] {
    const dawnDusk = Math.max(0, 1 - Math.min(Math.abs(timeOfDay - 0.25), Math.abs(timeOfDay - 0.75)) * 5);
    const night = timeOfDay < 0.2 || timeOfDay > 0.82;
    const stormShelter = sample.thunderRisk > 0.45 || sample.precipitation > 0.55 || sample.windSpeed > 18 ? 1 : 0;
    const winterSuppression = season.season === "winter" ? 0.45 + surface.snowDepth * 0.25 : 0;
    const insects = clamp(season.insectActivity * (night ? 0.45 : 0.82 + dawnDusk * 0.18) * (1 - stormShelter) * (sample.temperature > 8 ? 1 : 0.08), 0, 1);
    const birds = clamp(season.wildlife * (night ? 0.18 : 0.62 + dawnDusk * 0.3) * (1 - stormShelter * 0.72), 0, 1);
    const amphibians = clamp((surface.wetness + sample.humidity * 0.5) * (sample.temperature > 4 ? 0.75 : 0.08) * (sample.precipitation > 0.08 || night ? 1 : 0.45), 0, 1);
    const fish = clamp(0.55 + sample.temperature * 0.008 - sample.thunderRisk * 0.12, 0.2, 1);
    const sheltering = clamp(stormShelter * 0.85 + winterSuppression * 0.45, 0, 1);
    const migration = season.season === "autumn" ? clamp(0.2 + season.progress * 0.75, 0, 1) : season.season === "spring" ? clamp(1 - season.progress, 0, 0.55) : 0;
    const activity = clamp((insects + birds + amphibians + fish * 0.35) / 3.2 * (1 - sheltering * 0.48), 0, 1);
    return {
      activity,
      insects,
      birds,
      amphibians,
      fish,
      sheltering,
      migration,
      label: sheltering > 0.65 ? "sheltering" : migration > 0.5 ? "migration" : activity > 0.62 ? "active" : activity > 0.25 ? "quiet" : "sparse",
    };
  }

  private airQuality(sample: WeatherSample, sunExposure: number, fogDensity: number): EnvironmentState["airQuality"] {
    const heatShimmer = clamp((sample.temperature - 28) / 14, 0, 1) * sunExposure;
    const humidityHaze = clamp(sample.humidity - 0.72, 0, 1) * 0.75;
    const dust = clamp((sample.windSpeed - 14) / 18, 0, 1) * clamp((sample.temperature - 18) / 18, 0, 1) * (1 - sample.humidity);
    const haze = clamp(fogDensity * 0.62 + humidityHaze + heatShimmer * 0.35 + dust * 0.45, 0, 1);
    return {
      haze,
      dust,
      humidityHaze,
      heatShimmer,
      clarity: 1 - haze,
    };
  }

  get state(): EnvironmentState | null {
    return this.current;
  }

  forceTemperature(value: number | null): void {
    this.forcedTemperature = Number.isFinite(value) ? value : null;
  }

  forceWind(speed: number | null, directionDegrees = 0): void {
    this.forcedWind = speed !== null && Number.isFinite(speed)
      ? { speed: Math.max(0, speed), directionDegrees }
      : null;
  }

  debugText(): string {
    const s = this.current;
    if (!s) return "Environment unavailable.";
    return [
      `Environment season=${s.season.season} biome=${s.biomeId}`,
      `day=${s.dayOfSeason} hour=${s.hour.toFixed(1)} temp=${s.temperature.toFixed(1)}C feels=${s.thermal.feelsLike.toFixed(1)}C dew=${s.dewPoint.toFixed(1)}C comfort=${s.thermal.label}`,
      `surface=${s.surface.mood} wet=${s.surface.wetness.toFixed(2)} snow=${s.surface.snowDepth.toFixed(2)} frost=${s.surface.frost.toFixed(2)} ice=${s.surface.ice.toFixed(2)}`,
      `fog=${s.fog.density.toFixed(2)} ${s.fog.kind} visibility=${s.fog.visibilityMeters}m gust=${s.gustSpeed.toFixed(1)} river=${s.riverLevel.toFixed(2)} fauna=${s.fauna.label} haze=${s.airQuality.haze.toFixed(2)}`,
    ].join(" | ");
  }

  fogDebugText(): string {
    return this.fogBanks.debug();
  }

  fogRenderSamples(observerX: number, observerZ: number, maxDistance?: number): FogBankRenderSample[] {
    return this.fogBanks.renderSamples(observerX, observerZ, maxDistance);
  }

  sampleAt(world: World, x: number, y: number, z: number, ticks = 0, dayFactor = 1): EnvironmentState {
    const rawSample = this.weather.sampleAt(x, z);
    const sample = this.applyForces(rawSample);
    const season = this.seasons.sample(ticks);
    const biome = world.getBiomeAt(x, z);
    const temperature = sample.temperature + season.temperatureOffset * 0.45 - Math.max(0, y - 72) * 0.0065;
    const adjustedSample: WeatherSample = { ...sample, temperature };
    const dewPoint = dewPointC(temperature, sample.humidity);
    const surface = this.surface.resolve({
      x,
      z,
      weather: adjustedSample,
      dewPoint,
      dayFactor,
      exposedToSky: 1,
      surfaceState: new SurfaceWeatherState((wx, wz) => world.getSurfaceHeight(wx, wz)),
    });
    const sunExposure = clamp(dayFactor * (1 - sample.cloudCover * 0.82), 0, 1);
    const fog = this.fogBanks.renderSamples(x, z, 900).length > 0
      ? { density: Math.min(0.82, sample.humidity * 0.45), visibilityMeters: Math.round(1800 - sample.humidity * 700), bankDensity: sample.humidity * 0.45, nearestBankDistance: 0, kind: "advection" as const }
      : { density: clamp((sample.humidity - 0.82) * 1.35 + sample.precipitation * 0.32, 0, 0.42), visibilityMeters: Math.round(1800 - clamp((sample.humidity - 0.82) * 1.35 + sample.precipitation * 0.32, 0, 0.42) * 1650), bankDensity: 0, nearestBankDistance: -1, kind: "none" as const };
    return {
      season,
      dayOfSeason: Math.floor(season.progress * 24),
      weather: adjustedSample,
      timeOfDay: 0,
      hour: 0,
      dayFactor,
      altitude: y,
      biomeId: biome.id,
      temperature,
      humidity: sample.humidity,
      pressure: sample.pressure,
      dewPoint,
      windSpeed: sample.windSpeed,
      windDirectionDegrees: windDirectionDegrees(sample.windX, sample.windZ),
      gustSpeed: sample.windSpeed * (1.15 + sample.thunderRisk * 0.55 + sample.precipitation * 0.22),
      cloudCover: sample.cloudCover,
      precipitation: sample.precipitation,
      weatherType: sample.weatherType,
      precipitationKind: this.precipitationKind(adjustedSample),
      thunderRisk: sample.thunderRisk,
      sunExposure,
      riverLevel: this.riverLevel(this.waterPresence(world, x, z), season.season, surface.wetness, sample.precipitation),
      fauna: this.faunaState(season, adjustedSample, 0, surface),
      airQuality: this.airQuality(adjustedSample, sunExposure, fog.density),
      surface,
      thermal: this.thermal.resolve({ temperature, humidity: sample.humidity, windSpeed: sample.windSpeed, sunExposure, precipitation: sample.precipitation }),
      fog,
      visual: this.phenology.resolve(season, surface, temperature, sample.humidity, dayFactor),
    };
  }

  private applyForces(sample: WeatherSample): WeatherSample {
    let next = sample;
    if (this.forcedTemperature !== null) {
      next = { ...next, temperature: this.forcedTemperature };
    }
    if (this.forcedWind) {
      const radians = (this.forcedWind.directionDegrees / 180) * Math.PI;
      const windX = Math.sin(radians) * this.forcedWind.speed;
      const windZ = Math.cos(radians) * this.forcedWind.speed;
      next = { ...next, windX, windZ, windSpeed: this.forcedWind.speed };
      this.weather.setWind(windX, windZ);
    }
    return next;
  }

  private waterPresence(world: World, x: number, z: number): number {
    let hits = 0;
    let total = 0;
    for (let dz = -18; dz <= 18; dz += 6) {
      for (let dx = -18; dx <= 18; dx += 6) {
        total += 1;
        const wx = Math.floor(x + dx);
        const wz = Math.floor(z + dz);
        const y = world.getSurfaceHeight(wx, wz);
        if (world.getBlock(wx, y, wz) === BlockId.WATER || world.getBlock(wx, y + 1, wz) === BlockId.WATER) hits += 1;
      }
    }
    return total > 0 ? hits / total : 0;
  }

  private valleyFactor(world: World, x: number, z: number): number {
    const h = world.getSurfaceHeight(x, z);
    const ring = [
      world.getSurfaceHeight(x + 48, z),
      world.getSurfaceHeight(x - 48, z),
      world.getSurfaceHeight(x, z + 48),
      world.getSurfaceHeight(x, z - 48),
    ];
    const above = ring.reduce((sum, v) => sum + Math.max(0, v - h), 0) / ring.length;
    return clamp(above / 26, 0, 1);
  }
}

export function dewPointC(temperature: number, humidity: number): number {
  const h = clamp(humidity, 0.01, 1);
  const a = 17.27;
  const b = 237.7;
  const gamma = (a * temperature) / (b + temperature) + Math.log(h);
  return (b * gamma) / (a - gamma);
}

export function windDirectionDegrees(windX: number, windZ: number): number {
  const degrees = (Math.atan2(windX, windZ) * 180) / Math.PI;
  return (degrees + 360) % 360;
}
