import { PrecipitationKind, WeatherSceneState } from "../scene/WeatherScene";

export interface VisibilityResult {
  loss: number;
  fogNear: number;
  fogFar: number;
  frozenPrecipitation: boolean;
  dustTint: number;
}

/** Pure visibility model shared by fog, precipitation and extreme events. */
export class VisibilityController {
  resolve(scene: Readonly<WeatherSceneState>, legacyLoss = 0): VisibilityResult {
    const precip = scene.precipitation;
    const frozen = isFrozen(precip.kind);
    const precipitationLoss = precip.virga
      ? precip.intensity * 0.22
      : precip.intensity * (frozen ? 0.9 : 0.72);
    const dustTint = precip.kind === PrecipitationKind.DUST || precip.kind === PrecipitationKind.SAND
      ? Math.max(scene.visibility.haze, precip.intensity)
      : scene.visibility.haze * 0.25;
    const loss = clamp01(Math.max(
      legacyLoss,
      1 - scene.visibility.range,
      scene.visibility.fogDensity,
      scene.visibility.haze * 0.48,
      precipitationLoss,
    ));
    const extreme = precip.kind === PrecipitationKind.SNOW_SQUALL
      || precip.kind === PrecipitationKind.BLOWING_SNOW
      || precip.kind === PrecipitationKind.SAND;
    return {
      loss,
      fogNear: lerp(150, extreme ? 7 : 16, loss),
      fogFar: lerp(1120, extreme ? 48 : frozen ? 72 : 145, loss),
      frozenPrecipitation: frozen,
      dustTint,
    };
  }
}

function isFrozen(kind: PrecipitationKind): boolean {
  return kind === PrecipitationKind.SNOW_FLURRIES
    || kind === PrecipitationKind.LIGHT_SNOW
    || kind === PrecipitationKind.STEADY_SNOW
    || kind === PrecipitationKind.SNOW_SHOWER
    || kind === PrecipitationKind.SNOW_SQUALL
    || kind === PrecipitationKind.BLOWING_SNOW
    || kind === PrecipitationKind.HAIL
    || kind === PrecipitationKind.GRAUPEL
    || kind === PrecipitationKind.SLEET;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
