export type WeatherMapLayer =
  | "radar"
  | "satellite"
  | "wind"
  | "pressure"
  | "alerts"
  | "forecast"
  | "temperature"
  | "accumulation";

export const DEFAULT_WEATHER_MAP_LAYERS: WeatherMapLayer[] = ["radar", "satellite", "wind", "pressure", "alerts", "forecast", "accumulation"];
