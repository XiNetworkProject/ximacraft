import { WeatherSample, WeatherType } from "../weather/WeatherTypes";
import { SurfaceWeatherState } from "../weather/ground/SurfaceWeatherState";
import { EnvironmentSurfaceState, SurfaceMood } from "./EnvironmentState";
import { DewSystem } from "./DewSystem";
import { FrostSystem } from "./FrostSystem";
import { SnowDepthSystem } from "./SnowDepthSystem";
import { SnowBurialSystem } from "./SnowBurialSystem";
import { SnowCoverRenderer } from "./SnowCoverRenderer";
import { WetnessRenderer } from "./WetnessRenderer";

export interface SurfaceConditionInput {
  x: number;
  z: number;
  weather: WeatherSample;
  dewPoint: number;
  dayFactor: number;
  exposedToSky: number;
  surfaceState: SurfaceWeatherState;
}

export class SurfaceConditionSystem {
  private readonly dew = new DewSystem();
  private readonly frost = new FrostSystem();
  private readonly snow = new SnowDepthSystem();
  private readonly burial = new SnowBurialSystem();
  private readonly snowCover = new SnowCoverRenderer();
  private readonly wetnessVisual = new WetnessRenderer();

  resolve(input: SurfaceConditionInput): EnvironmentSurfaceState {
    const col = input.surfaceState.get(input.x, input.z);
    const wetness = col?.wetness ?? 0;
    const snowDepth = col?.snowDepth ?? 0;
    const hailDepth = col?.hailDepth ?? 0;
    const ice = col?.iceDepth ?? 0;
    const nightCooling = (1 - input.dayFactor) * 3.4;
    const rainCooling = input.weather.precipitation * 2.2;
    const surfaceTemperature = input.weather.temperature - nightCooling - rainCooling + input.dayFactor * input.exposedToSky * 2.1;
    const snowState = this.snow.resolve({
      currentSnowDepth: snowDepth,
      regionalSnowDepth: 0,
      altitude: col?.surfaceY ?? 64,
      exposedToSky: input.exposedToSky,
      canopyCover: 1 - input.exposedToSky,
      windSpeed: input.weather.windSpeed,
      weather: input.weather,
    });
    const dew = this.dew.resolve({
      surfaceTemperature,
      dewPoint: input.dewPoint,
      humidity: input.weather.humidity,
      windSpeed: input.weather.windSpeed,
      dayFactor: input.dayFactor,
      precipitation: input.weather.precipitation,
    });
    const frost = this.frost.resolve({
      surfaceTemperature,
      dewPoint: input.dewPoint,
      humidity: input.weather.humidity,
      windSpeed: input.weather.windSpeed,
      dayFactor: input.dayFactor,
      snowDepth: snowState.snowDepth,
      iceDepth: ice,
    });
    const puddles = Math.max(0, wetness - 0.72) / 0.28;
    const mud = Math.max(0, wetness - 0.48) * (snowDepth > 0.2 || ice > 0.2 ? 0.25 : 1);
    const burial = this.burial.resolve(snowState, input.weather.weatherType === WeatherType.SNOW ? 0.15 : 0);
    const cover = this.snowCover.resolve(snowState, burial, frost);
    const wetVisual = this.wetnessVisual.resolve({ wetness, mud, puddles, ice, dew });
    return {
      wetness,
      mud,
      puddles,
      snowDepth: snowState.snowDepth,
      hailDepth,
      ice,
      frost,
      dew,
      compactedSnow: snowState.compacted,
      snowBurial: snowState.burial,
      driftBias: snowState.driftBias,
      grassBurial: burial.grassBurial,
      flowerBurial: burial.flowerBurial,
      bushCompression: burial.bushCompression,
      roofSnow: cover.roofWhitening,
      roadCompaction: burial.roadCompaction,
      groundSnowWhitening: cover.groundWhitening,
      vegetationSnowWhitening: cover.vegetationWhitening,
      snowEdgeSoftness: cover.edgeSoftness,
      wetDarkening: wetVisual.darkening,
      wetGloss: wetVisual.gloss,
      puddleAlpha: wetVisual.puddleAlpha,
      mudTint: wetVisual.mudTint,
      surfaceTemperature,
      exposedToSky: input.exposedToSky,
      mood: this.moodFor({ wetness, mud, snowDepth: snowState.snowDepth, hailDepth, ice, frost, dew, weatherType: input.weather.weatherType }),
    };
  }

  private moodFor(input: {
    wetness: number;
    mud: number;
    snowDepth: number;
    hailDepth: number;
    ice: number;
    frost: number;
    dew: number;
    weatherType: WeatherType;
  }): SurfaceMood {
    if (input.snowDepth > 0.08 || input.weatherType === WeatherType.SNOW) return "snow";
    if (input.ice > 0.08) return "ice";
    if (input.hailDepth > 0.08 || input.frost > 0.2) return "frost";
    if (input.mud > 0.4) return "muddy";
    if (input.wetness > 0.18) return "wet";
    if (input.dew > 0.16) return "dew";
    return "dry";
  }
}
