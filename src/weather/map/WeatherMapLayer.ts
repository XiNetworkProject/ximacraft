export type WeatherMapLayer =
  | "radar"
  | "satellite"
  | "wind"
  | "pressure"
  | "alerts"
  | "forecast"
  | "temperature"
  | "accumulation"
  | "fog"
  | "rivers";

export const DEFAULT_WEATHER_MAP_LAYERS: WeatherMapLayer[] = ["radar", "satellite", "wind", "pressure", "alerts", "forecast", "accumulation", "fog"];
