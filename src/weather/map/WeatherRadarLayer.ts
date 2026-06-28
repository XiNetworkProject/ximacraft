import { WeatherMapSample } from "./WeatherMapData";

export function radarColor(sample: WeatherMapSample): string {
  if (sample.hailRisk > 0.45) return "rgba(225,235,255,0.86)";
  if (sample.thunderRisk > 0.55) return "rgba(220,45,42,0.78)";
  if (sample.snowRisk > 0.45) return "rgba(205,235,255,0.72)";
  if (sample.precipitation > 0.75) return "rgba(170,55,190,0.74)";
  if (sample.precipitation > 0.45) return "rgba(48,110,230,0.66)";
  if (sample.precipitation > 0.18) return "rgba(125,195,255,0.55)";
  return "rgba(0,0,0,0)";
}
