import { SEA_LEVEL } from "../utils/Constants";
import { clamp } from "../utils/MathUtils";
import type { AtmosphericHazeState, FogBankKind, FogMode } from "./EnvironmentState";

export interface FogFieldInput {
  humidity: number;
  dewPoint: number;
  temperature: number;
  windSpeed: number;
  windX: number;
  windZ: number;
  dayFactor: number;
  precipitation: number;
  cloudCover: number;
  waterNearby: number;
  valleyFactor: number;
  playerY: number;
  surfaceY: number;
}

export interface FogFieldState {
  mode: FogMode;
  density: number;
  weatherMist: number;
  humidityHaze: number;
  rainMist: number;
  valleyMist: number;
  lowStratusBlend: number;
  baseY: number;
  topY: number;
  terrainInfluence: number;
  horizonVisibility: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  haze: AtmosphericHazeState;
}

export class FogField {
  resolve(input: FogFieldInput, bankDensity: number, bankKind: FogBankKind | "none"): FogFieldState {
    const dewGap = Math.max(0, input.temperature - input.dewPoint);
    const saturation = clamp(input.humidity * 1.18 - dewGap * 0.095, 0, 1);
    const calm = 1 - clamp((input.windSpeed - 2) / 12, 0, 1);
    const night = 1 - input.dayFactor;
    const terrainInfluence = clamp(input.valleyFactor * 0.68 + input.waterNearby * 0.42, 0, 1);
    const valleyMist = saturation * (0.16 + terrainInfluence * 0.76 + night * 0.28) * (0.44 + calm * 0.56);
    const rainMist = clamp(input.precipitation * 0.86 + Math.max(0, input.humidity - 0.78) * 0.58, 0, 0.78);
    const lowStratusBlend = clamp(saturation * input.cloudCover * (0.28 + calm * 0.62 + terrainInfluence * 0.22), 0, 1);
    const humidityHaze = clamp((input.humidity - 0.56) * 0.5 + input.cloudCover * 0.08, 0, 0.52);
    const weatherMist = clamp(Math.max(rainMist * 0.82, valleyMist * 0.64, lowStratusBlend * 0.5), 0, 0.86);

    let mode: FogMode = "none";
    if (bankDensity > 0.16 || valleyMist > 0.36 || bankKind === "valley" || bankKind === "river" || bankKind === "freezing") mode = "valley";
    if (rainMist > Math.max(0.22, valleyMist * 0.9)) mode = "rain_mist";
    if (lowStratusBlend > 0.58 && input.precipitation < 0.08 && rainMist < 0.42) mode = "low_stratus";
    if (mode === "none" && humidityHaze > 0.06) mode = "haze";

    const surfaceY = Number.isFinite(input.surfaceY) ? input.surfaceY : SEA_LEVEL;
    const baseY = Math.max(SEA_LEVEL + 0.25, surfaceY + (mode === "rain_mist" ? 2.2 : mode === "low_stratus" ? 1.2 : 0.45));
    const topY = this.topForMode(mode, baseY, terrainInfluence, weatherMist, lowStratusBlend, rainMist);
    const altitudeFade = this.altitudeFade(input.playerY, baseY, topY, mode);
    const limitedDensity = Math.max(bankDensity, weatherMist) * altitudeFade;
    const density = clamp(Math.max(limitedDensity, humidityHaze * (mode === "haze" ? 0.7 : 0.28)), 0, 1);
    const horizonVisibility = clamp(1 - Math.max(density * 0.86, humidityHaze * 0.42, rainMist * 0.34), 0.08, 1);

    return {
      mode,
      density,
      weatherMist,
      humidityHaze,
      rainMist,
      valleyMist,
      lowStratusBlend,
      baseY,
      topY,
      terrainInfluence,
      horizonVisibility,
      windX: input.windX,
      windZ: input.windZ,
      windSpeed: input.windSpeed,
      haze: {
        density: clamp(humidityHaze + rainMist * 0.28 + lowStratusBlend * 0.18, 0, 1),
        humidityHaze,
        rainMist,
        lowStratusBlend,
        horizonVisibility,
        sunTransmittance: clamp(1 - density * 0.42 - lowStratusBlend * 0.22 - rainMist * 0.18, 0.16, 1),
        color: mode === "rain_mist" ? 0x8fa0ac : mode === "low_stratus" ? 0xaeb8bf : mode === "valley" ? 0xc9d2d8 : 0xb7cce0,
      },
    };
  }

  private topForMode(mode: FogMode, baseY: number, terrainInfluence: number, weatherMist: number, lowStratusBlend: number, rainMist: number): number {
    const terrainDepth = terrainInfluence * 26;
    switch (mode) {
      case "low_stratus":
        return baseY + 32 + lowStratusBlend * 54 + terrainDepth * 0.35;
      case "rain_mist":
        return baseY + 14 + rainMist * 34 + weatherMist * 16;
      case "valley":
        return baseY + 8 + weatherMist * 28 + terrainDepth;
      case "haze":
        return baseY + 70;
      default:
        return baseY + 4;
    }
  }

  private altitudeFade(playerY: number, baseY: number, topY: number, mode: FogMode): number {
    if (mode === "haze") return 1;
    if (playerY <= topY) return 1;
    const fadeDepth = mode === "low_stratus" ? 82 : mode === "rain_mist" ? 62 : 48;
    return 1 - smoothstep(topY, topY + fadeDepth, playerY);
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
