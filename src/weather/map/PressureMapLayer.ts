import { WeatherMapSample } from "./WeatherMapData";

export function pressureColor(sample: WeatherMapSample): string {
  const low = Math.max(0, Math.min(1, (1013 - sample.pressure) / 22));
  const high = Math.max(0, Math.min(1, (sample.pressure - 1013) / 22));
  if (low > high) return `rgba(120,80,220,${0.12 + low * 0.38})`;
  return `rgba(255,180,70,${0.08 + high * 0.32})`;
}
