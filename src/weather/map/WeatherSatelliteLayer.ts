import { WeatherMapSample } from "./WeatherMapData";

export function satelliteColor(sample: WeatherMapSample): string {
  const alpha = Math.max(0, Math.min(0.68, sample.cloudCover * 0.6));
  const dark = Math.max(0, Math.min(70, sample.thunderRisk * 70));
  return `rgba(${220 - dark}, ${226 - dark}, ${235 - dark}, ${alpha})`;
}
