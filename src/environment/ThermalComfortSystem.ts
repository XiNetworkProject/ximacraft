import { clamp } from "../utils/MathUtils";
import { ThermalComfortState } from "./EnvironmentState";

export interface ThermalComfortInput {
  temperature: number;
  humidity: number;
  windSpeed: number;
  sunExposure: number;
  precipitation: number;
}

export class ThermalComfortSystem {
  resolve(input: ThermalComfortInput): ThermalComfortState {
    const temp = input.temperature;
    const humidityPercent = clamp(input.humidity, 0, 1) * 100;
    const windKmh = Math.max(0, input.windSpeed) * 3.6;
    const windChill = temp <= 10 && windKmh > 4.8
      ? 13.12 + 0.6215 * temp - 11.37 * Math.pow(windKmh, 0.16) + 0.3965 * temp * Math.pow(windKmh, 0.16)
      : temp;
    const vapourPressure = (humidityPercent / 100) * 6.105 * Math.exp((17.27 * temp) / (237.7 + temp));
    const humidex = temp + 0.5555 * (vapourPressure - 10);
    const rainCooling = input.precipitation * 1.8;
    const solarWarmth = input.sunExposure * (temp < 4 ? 2.4 : temp > 24 ? 4.8 : 3.2);
    const feelsLike = temp < 10
      ? Math.min(temp + solarWarmth, windChill + solarWarmth * 0.7) - rainCooling
      : Math.max(temp + solarWarmth * 0.42, humidex) - rainCooling * 0.45;

    const heatStress = clamp((feelsLike - 27) / 15, 0, 1);
    const coldStress = clamp((2 - feelsLike) / 18, 0, 1);
    return {
      feelsLike,
      heatStress,
      coldStress,
      windChill,
      humidex,
      label: this.labelFor(feelsLike, heatStress, coldStress),
    };
  }

  private labelFor(feelsLike: number, heatStress: number, coldStress: number): ThermalComfortState["label"] {
    if (heatStress > 0.82) return "danger";
    if (heatStress > 0.46) return "hot";
    if (feelsLike >= 24) return "warm";
    if (coldStress > 0.82) return "freezing";
    if (coldStress > 0.48) return "cold";
    if (feelsLike < 12) return "cool";
    return "comfortable";
  }
}
