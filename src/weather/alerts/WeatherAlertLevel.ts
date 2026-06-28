export type WeatherAlertLevel = "INFO" | "YELLOW" | "ORANGE" | "RED" | "EXTREME";

export function strongerAlertLevel(a: WeatherAlertLevel, b: WeatherAlertLevel): WeatherAlertLevel {
  const order: WeatherAlertLevel[] = ["INFO", "YELLOW", "ORANGE", "RED", "EXTREME"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
