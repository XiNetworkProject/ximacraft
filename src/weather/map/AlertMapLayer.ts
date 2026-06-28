import { WeatherAlertLevel } from "../alerts/WeatherAlertLevel";

export function alertColor(level: WeatherAlertLevel): string {
  switch (level) {
    case "INFO":
      return "rgba(120,190,255,0.38)";
    case "YELLOW":
      return "rgba(255,220,80,0.45)";
    case "ORANGE":
      return "rgba(255,145,45,0.52)";
    case "RED":
      return "rgba(255,50,55,0.56)";
    case "EXTREME":
      return "rgba(190,60,255,0.62)";
  }
}
