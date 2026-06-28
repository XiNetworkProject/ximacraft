import { WeatherSample, WeatherType } from "../WeatherTypes";

export interface CloudLayerState {
  /** Broad horizontal veils/layers rendered by the sky dome. */
  stratiformCover: number;
  /** Potential for separate fair-weather cumulus volumes. */
  fairCumulusPotential: number;
  /** Deep-convection signal consumed by event-driven storm volumes. */
  deepConvection: number;
}

export function deriveCloudLayerState(sample: WeatherSample): CloudLayerState {
  const cloud = clamp01(sample.cloudCover);
  const instability = smoothRange(0.08, 0.62, sample.instability);
  const thunder = clamp01(sample.thunderRisk);
  const deepConvection = clamp01(Math.max(thunder, instability * smoothRange(0.48, 0.95, cloud)));

  const typeWeight = stratiformWeight(sample.weatherType);
  const broadPrecipitation = deepConvection < 0.32 ? sample.precipitation * 0.22 : 0;
  const stratiformCover = clamp01(cloud * typeWeight + broadPrecipitation);

  const moisture = 0.38 + smoothRange(0.3, 0.72, sample.humidity) * 0.62;
  const lift = 0.32 + instability * 0.68;
  // Les cumulus de beau temps apparaissent dès une faible couverture, et un
  // FOND de cumulus existe par temps chaud/humide même par ciel quasi clair
  // (un vrai ciel d'été n'est presque jamais totalement vide). Reste vide si
  // l'air est sec/froid/stable.
  const availableCloud = smoothRange(0.03, 0.34, cloud);
  const fairCumulusPotential = clamp01(
    (0.14 + availableCloud) * moisture * lift * (1 - stratiformCover * 0.92) * (1 - deepConvection * 0.78),
  );

  return { stratiformCover, fairCumulusPotential, deepConvection };
}

function stratiformWeight(type: WeatherType): number {
  switch (type) {
    case WeatherType.CLOUDY:
    case WeatherType.OVERCAST:
    case WeatherType.LIGHT_RAIN:
    case WeatherType.HEAVY_RAIN:
    case WeatherType.SNOW:
      return 1;
    case WeatherType.FOG:
      return 0.55;
    case WeatherType.CLEARING:
      return 0.28;
    case WeatherType.PARTLY_CLOUDY:
      return 0.1;
    case WeatherType.THUNDERSTORM:
      return 0.04;
    case WeatherType.CLEAR:
      return 0;
  }
}

function smoothRange(min: number, max: number, value: number): number {
  const t = clamp01((value - min) / Math.max(0.0001, max - min));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
