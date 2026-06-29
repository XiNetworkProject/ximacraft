import { WeatherSample } from "../weather/WeatherTypes";
import { EnvironmentVisualState } from "./EnvironmentState";

export interface SnowDepthInput {
  currentSnowDepth: number;
  regionalSnowDepth: number;
  altitude: number;
  exposedToSky: number;
  canopyCover: number;
  windSpeed: number;
  weather: WeatherSample;
}

export interface SnowDepthState {
  snowDepth: number;
  driftBias: number;
  burial: number;
  compacted: number;
}

export class SnowDepthSystem {
  resolve(input: SnowDepthInput): SnowDepthState {
    const altitudeBoost = Math.max(0, input.altitude - 90) / 220;
    const windDrift = Math.min(1, input.windSpeed / 24) * Math.max(0.18, input.exposedToSky);
    const canopyReduction = input.canopyCover * 0.42;
    const base = Math.max(input.currentSnowDepth, input.regionalSnowDepth);
    const effective = Math.max(0, base * (1 - canopyReduction) + altitudeBoost * 0.08);
    return {
      snowDepth: effective,
      driftBias: windDrift,
      burial: Math.min(1, effective * 1.15),
      compacted: Math.max(0, effective - 0.22) * 0.55,
    };
  }

  visualSnow(visual: EnvironmentVisualState, state: SnowDepthState): number {
    return Math.max(visual.snow, Math.min(1, state.snowDepth * 1.25 + state.driftBias * 0.08));
  }
}
