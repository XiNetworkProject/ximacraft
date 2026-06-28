import { WeatherMapSample } from "./WeatherMapData";

export function windArrow(sample: WeatherMapSample): { dx: number; dz: number; speed: number } {
  const length = Math.max(0.001, Math.hypot(sample.windX, sample.windZ));
  return { dx: sample.windX / length, dz: sample.windZ / length, speed: sample.windSpeed };
}
