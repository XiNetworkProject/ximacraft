/**
 * Construction d'un instantané {@link WeatherSceneState} (PUR).
 *
 * Le directeur garde des champs numériques LISSÉS (couverture, humidité, etc.)
 * qu'il fait converger lentement vers la « recette » du ciel cible. Ce module
 * assemble, à partir de ces valeurs lissées + du profil de ciel cible + du
 * contexte, l'état de scène complet consommé par le HUD, le debug et le rendu.
 */

import { SKY_PROFILES, SkyProfile } from "./WeatherScenarioData";
import {
  CloudLayer,
  PrecipitationKind,
  PrecipitationState,
  SkyState,
  SurfaceConditionState,
  TemperatureProfile,
  VisibilityState,
  WeatherContext,
  WeatherSceneState,
  WeatherTransitionState,
  WindState,
  isSnowPrecip,
} from "./WeatherScene";

/** Champs continus lissés détenus par le directeur (transitions douces). */
export interface EasedSceneFields {
  cloudCover: number;
  humidity: number;
  instability: number;
  thunder: number;
  clearingBias: number;
  precipIntensity: number;
  visibilityRange: number;
  fogDensity: number;
  haze: number;
  desaturation: number;
  windSpeed: number;
  gustiness: number;
  surfaceTemperature: number;
  convectivePotential: number;
}

export function profileFor(sky: SkyState): SkyProfile {
  return SKY_PROFILES[sky];
}

/** Cible numérique brute issue d'un profil (avant lissage). */
export function targetFields(sky: SkyState, ctx: WeatherContext): EasedSceneFields {
  const p = SKY_PROFILES[sky];
  const solarHeating = Math.max(0, Math.cos((ctx.timeOfDay - 0.56) * Math.PI * 2));
  const nightCooling = 1 - Math.max(0, Math.cos((ctx.timeOfDay - 0.5) * Math.PI * 2));
  const seasonWarmth = ctx.season === "SUMMER" ? 1.35 : ctx.season === "SPRING" ? 1 : ctx.season === "AUTUMN" ? 0.72 : 0.42;
  // L'humidité du biome rehausse légèrement couverture/humidité (jungle, océan).
  const biomeWet = (ctx.biomeHumidity - 0.45) * 0.18;
  const wetSurface = ctx.surfaceWetness * 0.1 + ctx.snowCover * 0.08;
  const wetCooling = p.precipIntensity * 1.6 + p.cloudCover * 0.55 + ctx.snowCover * 2.2;
  const diurnalTemperature = solarHeating * (2.8 * seasonWarmth) - nightCooling * (ctx.snowCover > 0.2 ? 4.8 : 2.6);
  const pressureLift = Math.max(0, -ctx.currentPressureTrend) * 0.08;
  const solarInstability = solarHeating * Math.max(0, ctx.biomeTemperature - 8) * 0.012;
  return {
    cloudCover: clamp01(p.cloudCover + Math.max(0, biomeWet)),
    humidity: clamp01(p.humidity + biomeWet + wetSurface - solarHeating * 0.04),
    instability: clamp01(p.instability + ctx.terrainLift * 0.1 + solarInstability + pressureLift),
    thunder: clamp01(p.thunder),
    clearingBias: clamp01(p.clearingBias),
    precipIntensity: clamp01(p.precipIntensity),
    visibilityRange: p.visibility.range,
    fogDensity: p.visibility.fogDensity,
    haze: p.visibility.haze,
    desaturation: p.visibility.desaturation,
    windSpeed: p.windSpeed + Math.max(0, -ctx.currentPressureTrend) * 2.2,
    gustiness: p.gustiness,
    surfaceTemperature: ctx.biomeTemperature + diurnalTemperature - wetCooling,
    convectivePotential: clamp01(p.convectivePotential + solarInstability * 0.75 + pressureLift),
  };
}

function buildLayers(p: SkyProfile, windDirX: number, windDirZ: number, eased: EasedSceneFields): CloudLayer[] {
  return p.layers.map((source) => {
    const layer: CloudLayer = { ...source };
    // Les couches hautes filent plus vite et sont plus déviées (vent d'altitude).
    const high = layer.baseHeight > 900;
    const speed = eased.windSpeed * (high ? 1.6 : 1) * 0.6;
    layer.movementX = windDirX * speed;
    layer.movementZ = windDirZ * speed;
    layer.coverage = clamp01(layer.coverage * (0.5 + eased.cloudCover * 0.8));
    return layer;
  });
}

function buildPrecipitation(p: SkyProfile, eased: EasedSceneFields): PrecipitationState {
  const intensity = eased.precipIntensity;
  if (p.precipKind === PrecipitationKind.NONE || intensity <= 0.01) {
    return {
      kind: PrecipitationKind.NONE, intensity: 0, spatialPattern: "none",
      beginsAtCloudBase: false, reachesGround: false, virga: false, windTilt: 0,
    };
  }
  return {
    kind: p.precipKind,
    intensity,
    spatialPattern: p.precipPattern,
    beginsAtCloudBase: true,
    reachesGround: p.reachesGround,
    virga: p.virga,
    windTilt: clamp01(eased.windSpeed / 26) * (p.virga ? 0.8 : 0.5),
  };
}

function buildVisibility(eased: EasedSceneFields): VisibilityState {
  return {
    range: clamp01(eased.visibilityRange),
    fogDensity: clamp01(eased.fogDensity),
    haze: clamp01(eased.haze),
    desaturation: clamp01(eased.desaturation),
  };
}

function buildWind(p: SkyProfile, windDirX: number, windDirZ: number, eased: EasedSceneFields): WindState {
  return {
    dirX: windDirX,
    dirZ: windDirZ,
    speed: eased.windSpeed,
    gustiness: eased.gustiness,
    // Vent d'altitude légèrement tourné (cisaillement) pour orienter cirrus/enclumes.
    upperDirX: windDirX * 0.92 - windDirZ * 0.39,
    upperDirZ: windDirZ * 0.92 + windDirX * 0.39,
  };
}

function buildTemperatureProfile(p: SkyProfile, eased: EasedSceneFields, ctx: WeatherContext): TemperatureProfile {
  const surface = eased.surfaceTemperature;
  const snow = isSnowPrecip(p.precipKind);
  // Niveau de gel : monte avec la température de surface (lapse rate ~6.5°C/km,
  // ici échelle de jeu ~ /250 blocs). Sous la base nuageuse si neige.
  const freezingLevel = 64 + surface * 90;
  return {
    surface,
    cloudBase: surface - 3,
    freezingLevel,
    // Pluie verglaçante : neige attendue mais couche de surface > 0 et froid global.
    warmNoseAloft: snow && surface > 0.5 && ctx.biomeTemperature < 4,
  };
}

function buildSurface(p: SkyProfile, eased: EasedSceneFields): SurfaceConditionState {
  const snow = isSnowPrecip(p.precipKind);
  const rainLike = p.reachesGround && !snow && p.precipKind !== PrecipitationKind.NONE;
  return {
    wetnessTarget: rainLike ? clamp01(0.4 + eased.precipIntensity * 0.6) : 0,
    freshSnowTarget: snow && p.reachesGround ? clamp01(eased.precipIntensity) : 0,
    iceTarget: p.precipKind === PrecipitationKind.FREEZING_RAIN ? 0.8 : 0,
    blowingFromGround: p.precipKind === PrecipitationKind.BLOWING_SNOW || p.precipKind === PrecipitationKind.SNOW_SQUALL,
  };
}

/** Assemble l'état de scène complet à partir des valeurs lissées. */
export function buildSceneState(
  sky: SkyState,
  transition: WeatherTransitionState,
  eased: EasedSceneFields,
  ctx: WeatherContext,
  windDirX: number,
  windDirZ: number,
): WeatherSceneState {
  const p = SKY_PROFILES[sky];
  return {
    synopticRegime: p.synoptic,
    skyState: sky,
    cloudLayers: buildLayers(p, windDirX, windDirZ, eased),
    precipitation: buildPrecipitation(p, eased),
    visibility: buildVisibility(eased),
    wind: buildWind(p, windDirX, windDirZ, eased),
    temperatureProfile: buildTemperatureProfile(p, eased, ctx),
    surfaceState: buildSurface(p, eased),
    convectiveState: {
      potential: eased.convectivePotential,
      toweringCount: p.toweringCount,
      cellActive: p.cellActive,
      organizedLine: p.organizedLine,
    },
    transition,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
