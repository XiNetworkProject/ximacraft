/**
 * Données déclaratives de l'atlas météo (PUR, sans Three.js) :
 *
 *  1. {@link SKY_PROFILES} — pour chaque {@link SkyState}, les champs cibles de
 *     l'atmosphère (couverture, humidité, instabilité, précipitation, couches
 *     nuageuses, population, visibilité, convection). C'est la « recette » d'un
 *     ciel : le directeur fait converger lentement le monde vers ces valeurs.
 *
 *  2. {@link SCENARIOS} — pour chaque {@link WeatherScenario}, une suite de
 *     PHASES (états de ciel) avec durées min/max et jalons. C'est l'« histoire »
 *     météo persistante qui remplace les jets aléatoires sur timer.
 *
 * Aucune phase ne saute d'un ciel clair à un orage : les orages naissent
 * toujours d'un champ de cumulus existant, et restent un résultat occasionnel.
 */

import {
  CloudLayer,
  CloudLayerType,
  PrecipitationKind,
  PrecipitationPattern,
  SkyState,
  SynopticRegime,
  VisibilityState,
  WeatherScenario,
} from "./WeatherScene";

/** Élément mobile discret qu'un ciel implique (piloté par un événement moteur). */
export type SceneFeature =
  | "none"
  | "rain_band"
  | "shower_cell"
  | "storm_cell"
  | "supercell"
  | "squall_line"
  | "snow_band"
  | "snow_cell"
  | "snow_squall";

export interface SkyProfile {
  /** Régime synoptique typique de ce ciel. */
  synoptic: SynopticRegime;
  /** Couverture nuageuse cible 0..1 (dôme + classification). */
  cloudCover: number;
  /** Humidité cible 0..1. */
  humidity: number;
  /** Instabilité cible 0..1. */
  instability: number;
  /** Risque d'orage cible 0..1. */
  thunder: number;
  /** Biais d'éclaircie cible 0..1. */
  clearingBias: number;
  /** Genre de précipitation de FOND (uniforme) — null si pilotée par feature. */
  precipKind: PrecipitationKind;
  /** Intensité de la précipitation de fond 0..1. */
  precipIntensity: number;
  precipPattern: PrecipitationPattern;
  reachesGround: boolean;
  virga: boolean;
  /** Visibilité associée. */
  visibility: VisibilityState;
  /** Pile de couches nuageuses représentative. */
  layers: CloudLayer[];
  /** Cibles de population par bande (0..1). */
  population: { background: number; horizon: number; mid: number; hero: number };
  /** Convection. */
  convectivePotential: number;
  toweringCount: number;
  cellActive: boolean;
  organizedLine: boolean;
  /** Élément mobile discret implicite. */
  feature: SceneFeature;
  /** Vent de surface (blocs/s à l'échelle météo). */
  windSpeed: number;
  gustiness: number;
}

function layer(
  type: CloudLayerType,
  baseHeight: number,
  topHeight: number,
  coverage: number,
  opacity: number,
  options: { precip?: number; prio?: number; persistence?: number; variance?: number } = {},
): CloudLayer {
  return {
    type,
    baseHeight,
    topHeight,
    coverage,
    opacity,
    movementX: 0,
    movementZ: 0,
    directionVariance: options.variance ?? 0.1,
    persistence: options.persistence ?? 0.6,
    precipitationPotential: options.precip ?? 0,
    visibleDistancePriority: options.prio ?? 0.5,
  };
}

function vis(range: number, fog = 0, haze = 0, desat = 0): VisibilityState {
  return { range, fogDensity: fog, haze, desaturation: desat };
}

const NO_PRECIP = {
  precipKind: PrecipitationKind.NONE,
  precipIntensity: 0,
  precipPattern: "none" as PrecipitationPattern,
  reachesGround: false,
  virga: false,
};

/**
 * Recette d'atmosphère par état de ciel. Les valeurs sont des CIBLES vers
 * lesquelles le directeur fait converger le monde lentement (transitions douces).
 */
export const SKY_PROFILES: Record<SkyState, SkyProfile> = {
  // === A. Ciels stables et secs =============================================
  [SkyState.CRYSTAL_CLEAR]: {
    synoptic: SynopticRegime.STABLE_HIGH_PRESSURE,
    cloudCover: 0.03, humidity: 0.3, instability: 0.06, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(1, 0, 0.04),
    layers: [],
    population: { background: 0.02, horizon: 0.04, mid: 0, hero: 0 },
    convectivePotential: 0.04, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 4, gustiness: 0.05,
  },
  [SkyState.CLEAR_WITH_CIRRUS]: {
    synoptic: SynopticRegime.STABLE_HIGH_PRESSURE,
    cloudCover: 0.12, humidity: 0.36, instability: 0.08, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.98, 0, 0.06),
    layers: [layer(CloudLayerType.CIRRUS, 1400, 1520, 0.3, 0.4, { prio: 0.9, persistence: 0.4, variance: 0.4 })],
    population: { background: 0.18, horizon: 0.06, mid: 0, hero: 0 },
    convectivePotential: 0.06, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 6, gustiness: 0.08,
  },
  [SkyState.CLEAR_WITH_WISPS]: {
    synoptic: SynopticRegime.STABLE_HIGH_PRESSURE,
    cloudCover: 0.16, humidity: 0.4, instability: 0.12, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.97, 0, 0.07),
    layers: [
      layer(CloudLayerType.CIRRUS, 1380, 1500, 0.34, 0.4, { prio: 0.9, variance: 0.45 }),
      layer(CloudLayerType.FAIR_CUMULUS, 540, 700, 0.08, 0.7, { prio: 0.3 }),
    ],
    population: { background: 0.2, horizon: 0.14, mid: 0.06, hero: 0 },
    convectivePotential: 0.12, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 6, gustiness: 0.12,
  },
  [SkyState.HEAT_HAZE]: {
    synoptic: SynopticRegime.HEATWAVE,
    cloudCover: 0.1, humidity: 0.28, instability: 0.2, thunder: 0.02, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.7, 0, 0.55),
    layers: [layer(CloudLayerType.CIRRUS, 1450, 1560, 0.16, 0.3, { prio: 0.8 })],
    population: { background: 0.08, horizon: 0.05, mid: 0, hero: 0 },
    convectivePotential: 0.18, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 3, gustiness: 0.04,
  },
  [SkyState.DUST_HAZE]: {
    synoptic: SynopticRegime.DRY_WIND_EVENT,
    cloudCover: 0.12, humidity: 0.2, instability: 0.12, thunder: 0, clearingBias: 0,
    precipKind: PrecipitationKind.DUST, precipIntensity: 0.18, precipPattern: "uniform",
    reachesGround: false, virga: false,
    visibility: vis(0.55, 0, 0.7, 0.15),
    layers: [],
    population: { background: 0.06, horizon: 0.04, mid: 0, hero: 0 },
    convectivePotential: 0.08, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 16, gustiness: 0.5,
  },

  // === B. Ciels à cumulus ===================================================
  [SkyState.FAIR_WEATHER_CUMULUS]: {
    synoptic: SynopticRegime.HUMID_HIGH_PRESSURE,
    cloudCover: 0.3, humidity: 0.52, instability: 0.32, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.95, 0, 0.08),
    layers: [layer(CloudLayerType.FAIR_CUMULUS, 540, 760, 0.32, 0.85, { prio: 0.4, persistence: 0.5 })],
    population: { background: 0.12, horizon: 0.45, mid: 0.4, hero: 0.25 },
    convectivePotential: 0.3, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 6, gustiness: 0.18,
  },
  [SkyState.SCATTERED_CUMULUS]: {
    synoptic: SynopticRegime.HUMID_HIGH_PRESSURE,
    cloudCover: 0.42, humidity: 0.58, instability: 0.4, thunder: 0.02, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.92, 0, 0.1),
    layers: [layer(CloudLayerType.FAIR_CUMULUS, 530, 860, 0.45, 0.88, { prio: 0.45, persistence: 0.5 })],
    population: { background: 0.14, horizon: 0.55, mid: 0.6, hero: 0.4 },
    convectivePotential: 0.42, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 7, gustiness: 0.22,
  },
  [SkyState.BROKEN_CUMULUS]: {
    synoptic: SynopticRegime.WEAK_LOW_PRESSURE,
    cloudCover: 0.62, humidity: 0.64, instability: 0.46, thunder: 0.06, clearingBias: 0.1,
    ...NO_PRECIP,
    visibility: vis(0.88, 0, 0.12),
    layers: [
      layer(CloudLayerType.FAIR_CUMULUS, 520, 980, 0.6, 0.9, { prio: 0.5 }),
      layer(CloudLayerType.STRATOCUMULUS, 460, 640, 0.32, 0.7, { prio: 0.4 }),
    ],
    population: { background: 0.22, horizon: 0.6, mid: 0.7, hero: 0.55 },
    convectivePotential: 0.5, toweringCount: 1, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 8, gustiness: 0.3,
  },
  [SkyState.TOWERING_CUMULUS_FIELD]: {
    synoptic: SynopticRegime.CONVECTIVE_DAY,
    cloudCover: 0.6, humidity: 0.72, instability: 0.66, thunder: 0.2, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.85, 0, 0.12),
    layers: [
      layer(CloudLayerType.FAIR_CUMULUS, 520, 900, 0.5, 0.9, { prio: 0.5 }),
      layer(CloudLayerType.TOWERING_CUMULUS, 520, 1240, 0.3, 0.95, { prio: 0.8, precip: 0.3 }),
    ],
    population: { background: 0.2, horizon: 0.5, mid: 0.7, hero: 0.85 },
    convectivePotential: 0.72, toweringCount: 3, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 8, gustiness: 0.35,
  },

  // === C. Ciels stratiformes ================================================
  [SkyState.STRATOCUMULUS_BROKEN]: {
    synoptic: SynopticRegime.WEAK_LOW_PRESSURE,
    cloudCover: 0.66, humidity: 0.62, instability: 0.18, thunder: 0, clearingBias: 0.12,
    ...NO_PRECIP,
    visibility: vis(0.86, 0, 0.12),
    layers: [layer(CloudLayerType.STRATOCUMULUS, 420, 640, 0.66, 0.78, { prio: 0.6, persistence: 0.75 })],
    population: { background: 0.4, horizon: 0.3, mid: 0.15, hero: 0 },
    convectivePotential: 0.12, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 8, gustiness: 0.2,
  },
  [SkyState.STRATOCUMULUS_OVERCAST]: {
    synoptic: SynopticRegime.WEAK_LOW_PRESSURE,
    cloudCover: 0.88, humidity: 0.68, instability: 0.12, thunder: 0, clearingBias: 0.05,
    precipKind: PrecipitationKind.DRIZZLE, precipIntensity: 0.08, precipPattern: "patchy",
    reachesGround: true, virga: false,
    visibility: vis(0.78, 0.05, 0.1),
    layers: [layer(CloudLayerType.STRATOCUMULUS, 380, 600, 0.9, 0.85, { prio: 0.7, persistence: 0.85, precip: 0.1 })],
    population: { background: 0.7, horizon: 0.2, mid: 0.08, hero: 0 },
    convectivePotential: 0.08, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 7, gustiness: 0.18,
  },
  [SkyState.HIGH_VEIL]: {
    synoptic: SynopticRegime.WARM_FRONT_APPROACH,
    cloudCover: 0.5, humidity: 0.58, instability: 0.06, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.9, 0, 0.2),
    layers: [
      layer(CloudLayerType.CIRROSTRATUS, 1100, 1320, 0.7, 0.45, { prio: 0.95, persistence: 0.8 }),
      layer(CloudLayerType.CIRRUS, 1380, 1480, 0.3, 0.4, { prio: 0.9 }),
    ],
    population: { background: 0.6, horizon: 0.1, mid: 0, hero: 0 },
    convectivePotential: 0.04, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 9, gustiness: 0.12,
  },
  [SkyState.MID_OVERCAST]: {
    synoptic: SynopticRegime.WARM_FRONT_APPROACH,
    cloudCover: 0.82, humidity: 0.7, instability: 0.05, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.82, 0, 0.18),
    layers: [layer(CloudLayerType.ALTOSTRATUS, 820, 1080, 0.85, 0.62, { prio: 0.85, persistence: 0.85 })],
    population: { background: 0.8, horizon: 0.08, mid: 0, hero: 0 },
    convectivePotential: 0.04, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 9, gustiness: 0.14,
  },
  [SkyState.LOW_OVERCAST]: {
    synoptic: SynopticRegime.WEAK_LOW_PRESSURE,
    cloudCover: 0.92, humidity: 0.78, instability: 0.05, thunder: 0, clearingBias: 0.04,
    precipKind: PrecipitationKind.DRIZZLE, precipIntensity: 0.12, precipPattern: "uniform",
    reachesGround: true, virga: false,
    visibility: vis(0.68, 0.12, 0.14),
    layers: [layer(CloudLayerType.STRATUS, 240, 420, 0.95, 0.8, { prio: 0.8, persistence: 0.9, precip: 0.2 })],
    population: { background: 0.85, horizon: 0.1, mid: 0, hero: 0 },
    convectivePotential: 0.03, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 6, gustiness: 0.1,
  },
  [SkyState.NIMBOSTRATUS_RAIN]: {
    synoptic: SynopticRegime.OCCLUDED_FRONT,
    cloudCover: 0.98, humidity: 0.92, instability: 0.08, thunder: 0, clearingBias: 0,
    precipKind: PrecipitationKind.STEADY_RAIN, precipIntensity: 0.55, precipPattern: "uniform",
    reachesGround: true, virga: false,
    visibility: vis(0.55, 0.18, 0.1),
    layers: [layer(CloudLayerType.NIMBOSTRATUS, 320, 980, 1, 0.92, { prio: 0.9, persistence: 0.9, precip: 0.9 })],
    population: { background: 0.95, horizon: 0.05, mid: 0, hero: 0 },
    convectivePotential: 0.06, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "rain_band", windSpeed: 10, gustiness: 0.25,
  },

  // === D. Brouillard / brume ===============================================
  [SkyState.PATCHY_FOG]: {
    synoptic: SynopticRegime.FOG_PRONE_NIGHT,
    cloudCover: 0.3, humidity: 0.95, instability: 0.02, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.45, 0.55, 0.1, 0.2),
    layers: [layer(CloudLayerType.FOG, 64, 130, 0.5, 0.6, { prio: 0.3, persistence: 0.7 })],
    population: { background: 0.1, horizon: 0.05, mid: 0, hero: 0 },
    convectivePotential: 0.02, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 1, gustiness: 0.02,
  },
  [SkyState.DENSE_FOG]: {
    synoptic: SynopticRegime.FOG_PRONE_NIGHT,
    cloudCover: 0.4, humidity: 0.99, instability: 0.01, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.12, 0.95, 0.1, 0.5),
    layers: [layer(CloudLayerType.FOG, 64, 160, 0.95, 0.85, { prio: 0.2, persistence: 0.85 })],
    population: { background: 0.05, horizon: 0, mid: 0, hero: 0 },
    convectivePotential: 0.01, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 0.5, gustiness: 0.01,
  },

  // === E. Ciels d'après-averse / variable ===================================
  [SkyState.POST_SHOWER_SKY]: {
    synoptic: SynopticRegime.POST_FRONTAL_AIR,
    cloudCover: 0.45, humidity: 0.66, instability: 0.34, thunder: 0.04, clearingBias: 0.4,
    ...NO_PRECIP,
    visibility: vis(0.9, 0.05, 0.06),
    layers: [
      layer(CloudLayerType.FAIR_CUMULUS, 520, 820, 0.4, 0.88, { prio: 0.5 }),
      layer(CloudLayerType.STRATOCUMULUS, 440, 600, 0.2, 0.7, { prio: 0.4 }),
    ],
    population: { background: 0.2, horizon: 0.5, mid: 0.55, hero: 0.4 },
    convectivePotential: 0.4, toweringCount: 1, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 9, gustiness: 0.35,
  },

  // === F. Convection / orages ===============================================
  [SkyState.STORM_VISIBLE_FAR]: {
    synoptic: SynopticRegime.ISOLATED_CONVECTION,
    cloudCover: 0.5, humidity: 0.7, instability: 0.7, thunder: 0.3, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.88, 0, 0.12),
    layers: [
      layer(CloudLayerType.FAIR_CUMULUS, 520, 900, 0.4, 0.9, { prio: 0.5 }),
      layer(CloudLayerType.CUMULONIMBUS, 520, 1500, 0.18, 0.95, { prio: 0.95, precip: 0.6 }),
    ],
    population: { background: 0.2, horizon: 0.45, mid: 0.55, hero: 0.5 },
    convectivePotential: 0.72, toweringCount: 2, cellActive: true, organizedLine: false,
    feature: "storm_cell", windSpeed: 9, gustiness: 0.3,
  },
  [SkyState.STORM_APPROACHING]: {
    synoptic: SynopticRegime.ISOLATED_CONVECTION,
    cloudCover: 0.78, humidity: 0.82, instability: 0.82, thunder: 0.6, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.7, 0.05, 0.12),
    layers: [
      layer(CloudLayerType.CUMULONIMBUS, 500, 1600, 0.6, 0.97, { prio: 0.98, precip: 0.85 }),
      layer(CloudLayerType.FAIR_CUMULUS, 520, 820, 0.3, 0.88, { prio: 0.5 }),
    ],
    population: { background: 0.3, horizon: 0.3, mid: 0.5, hero: 0.8 },
    convectivePotential: 0.86, toweringCount: 3, cellActive: true, organizedLine: false,
    feature: "storm_cell", windSpeed: 14, gustiness: 0.6,
  },
  [SkyState.STORM_OVERHEAD]: {
    synoptic: SynopticRegime.ORGANIZED_CONVECTION,
    cloudCover: 0.97, humidity: 0.92, instability: 0.9, thunder: 0.92, clearingBias: 0,
    precipKind: PrecipitationKind.THUNDERSTORM_RAIN, precipIntensity: 0.85, precipPattern: "core",
    reachesGround: true, virga: false,
    visibility: vis(0.4, 0.2, 0.1),
    layers: [
      layer(CloudLayerType.CUMULONIMBUS, 480, 1650, 0.95, 0.99, { prio: 1, precip: 1 }),
      layer(CloudLayerType.ANVIL, 1500, 1720, 0.6, 0.7, { prio: 0.9 }),
    ],
    population: { background: 0.4, horizon: 0.2, mid: 0.4, hero: 1 },
    convectivePotential: 0.95, toweringCount: 3, cellActive: true, organizedLine: false,
    feature: "storm_cell", windSpeed: 16, gustiness: 0.9,
  },
  [SkyState.STORM_RECEDING]: {
    synoptic: SynopticRegime.POST_FRONTAL_AIR,
    cloudCover: 0.7, humidity: 0.78, instability: 0.5, thunder: 0.35, clearingBias: 0.3,
    ...NO_PRECIP,
    visibility: vis(0.78, 0.08, 0.1),
    layers: [
      layer(CloudLayerType.CUMULONIMBUS, 500, 1500, 0.4, 0.9, { prio: 0.9, precip: 0.4 }),
      layer(CloudLayerType.ANVIL, 1450, 1680, 0.5, 0.6, { prio: 0.85 }),
      layer(CloudLayerType.FAIR_CUMULUS, 520, 800, 0.3, 0.85, { prio: 0.5 }),
    ],
    population: { background: 0.3, horizon: 0.45, mid: 0.55, hero: 0.6 },
    convectivePotential: 0.55, toweringCount: 1, cellActive: true, organizedLine: false,
    feature: "storm_cell", windSpeed: 11, gustiness: 0.45,
  },

  // === G. Hiver =============================================================
  [SkyState.WINTER_CLEAR]: {
    synoptic: SynopticRegime.COLD_CLEAR_OUTBREAK,
    cloudCover: 0.06, humidity: 0.4, instability: 0.08, thunder: 0, clearingBias: 0,
    ...NO_PRECIP,
    visibility: vis(0.98, 0, 0.02),
    layers: [layer(CloudLayerType.CIRRUS, 1400, 1500, 0.1, 0.35, { prio: 0.8 })],
    population: { background: 0.05, horizon: 0.05, mid: 0, hero: 0 },
    convectivePotential: 0.06, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 5, gustiness: 0.1,
  },
  [SkyState.SNOWY_OVERCAST]: {
    synoptic: SynopticRegime.WINTER_LOW_PRESSURE,
    cloudCover: 0.97, humidity: 0.88, instability: 0.1, thunder: 0, clearingBias: 0,
    precipKind: PrecipitationKind.STEADY_SNOW, precipIntensity: 0.5, precipPattern: "uniform",
    reachesGround: true, virga: false,
    visibility: vis(0.55, 0.2, 0.1, 0.1),
    layers: [layer(CloudLayerType.NIMBOSTRATUS, 320, 900, 1, 0.9, { prio: 0.9, persistence: 0.9, precip: 0.8 })],
    population: { background: 0.95, horizon: 0.05, mid: 0, hero: 0 },
    convectivePotential: 0.06, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "snow_band", windSpeed: 9, gustiness: 0.3,
  },
  [SkyState.WHITEOUT]: {
    synoptic: SynopticRegime.WINTER_LOW_PRESSURE,
    cloudCover: 1, humidity: 0.95, instability: 0.2, thunder: 0, clearingBias: 0,
    precipKind: PrecipitationKind.BLOWING_SNOW, precipIntensity: 0.95, precipPattern: "uniform",
    reachesGround: true, virga: false,
    visibility: vis(0.08, 0.7, 0.1, 0.2),
    layers: [layer(CloudLayerType.NIMBOSTRATUS, 280, 900, 1, 0.95, { prio: 0.9, precip: 1 })],
    population: { background: 1, horizon: 0, mid: 0, hero: 0 },
    convectivePotential: 0.1, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "snow_squall", windSpeed: 26, gustiness: 1,
  },

  // === Désert / extrêmes ====================================================
  [SkyState.SANDSTORM_SKY]: {
    synoptic: SynopticRegime.DRY_WIND_EVENT,
    cloudCover: 0.55, humidity: 0.18, instability: 0.3, thunder: 0.05, clearingBias: 0,
    precipKind: PrecipitationKind.SAND, precipIntensity: 0.8, precipPattern: "band",
    reachesGround: true, virga: false,
    visibility: vis(0.15, 0.4, 0.85, 0.3),
    layers: [],
    population: { background: 0.2, horizon: 0.1, mid: 0, hero: 0 },
    convectivePotential: 0.2, toweringCount: 0, cellActive: false, organizedLine: false,
    feature: "none", windSpeed: 24, gustiness: 0.95,
  },
};

// ============================================================================
// SCÉNARIOS : suites de phases persistantes (l'histoire météo)
// ============================================================================

export interface ScenarioPhase {
  sky: SkyState;
  /** Durée min/max de la phase (s). Le directeur reste DANS la phase ce temps. */
  min: number;
  max: number;
  milestone: string;
  /** Surcharge éventuelle de l'élément mobile (sinon celui du profil de ciel). */
  feature?: SceneFeature;
}

export interface ScenarioDef {
  id: WeatherScenario;
  label: string;
  synoptic: SynopticRegime;
  phases: ScenarioPhase[];
  /** Scénarios candidats à enchaîner (pondérés ensuite par le contexte). */
  next: WeatherScenario[];
}

const S = WeatherScenario;

export const SCENARIOS: Record<WeatherScenario, ScenarioDef> = {
  // S1 — belle journée
  [S.CLEAR_DAY]: {
    id: S.CLEAR_DAY, label: "Clear day", synoptic: SynopticRegime.STABLE_HIGH_PRESSURE,
    phases: [
      { sky: SkyState.CRYSTAL_CLEAR, min: 160, max: 300, milestone: "dry-stable-air" },
      { sky: SkyState.CLEAR_WITH_CIRRUS, min: 120, max: 220, milestone: "high-cirrus" },
      { sky: SkyState.CRYSTAL_CLEAR, min: 140, max: 240, milestone: "clear-evening" },
    ],
    next: [S.FAIR_CUMULUS_DAY, S.CLEAR_DAY, S.MORNING_FOG, S.WARM_FRONT_SEQUENCE],
  },
  [S.FAIR_CUMULUS_DAY]: {
    id: S.FAIR_CUMULUS_DAY, label: "Fair cumulus day", synoptic: SynopticRegime.HUMID_HIGH_PRESSURE,
    phases: [
      { sky: SkyState.CRYSTAL_CLEAR, min: 90, max: 160, milestone: "morning-stability" },
      { sky: SkyState.CLEAR_WITH_WISPS, min: 90, max: 150, milestone: "first-puffs" },
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 180, max: 320, milestone: "cumulus-field" },
      { sky: SkyState.SCATTERED_CUMULUS, min: 140, max: 260, milestone: "afternoon-build" },
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 120, max: 220, milestone: "evening-collapse" },
      { sky: SkyState.CLEAR_WITH_CIRRUS, min: 100, max: 180, milestone: "clearing-evening" },
    ],
    next: [S.FAIR_CUMULUS_DAY, S.VARIABLE_CLOUD_DAY, S.ISOLATED_SHOWER_DAY, S.CLEAR_DAY, S.MORNING_FOG],
  },
  [S.VARIABLE_CLOUD_DAY]: {
    id: S.VARIABLE_CLOUD_DAY, label: "Variable cloud day", synoptic: SynopticRegime.WEAK_LOW_PRESSURE,
    phases: [
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 120, max: 220, milestone: "cumulus-start" },
      { sky: SkyState.SCATTERED_CUMULUS, min: 140, max: 240, milestone: "building" },
      { sky: SkyState.BROKEN_CUMULUS, min: 160, max: 280, milestone: "broken-sky" },
      { sky: SkyState.SCATTERED_CUMULUS, min: 120, max: 220, milestone: "easing" },
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 100, max: 200, milestone: "settling" },
    ],
    next: [S.FAIR_CUMULUS_DAY, S.ISOLATED_SHOWER_DAY, S.GREY_DRY_DAY, S.POST_FRONTAL_SHOWERS],
  },
  [S.GREY_DRY_DAY]: {
    id: S.GREY_DRY_DAY, label: "Grey dry day", synoptic: SynopticRegime.WEAK_LOW_PRESSURE,
    phases: [
      { sky: SkyState.STRATOCUMULUS_BROKEN, min: 160, max: 300, milestone: "low-deck-building" },
      { sky: SkyState.STRATOCUMULUS_OVERCAST, min: 220, max: 420, milestone: "overcast-dry" },
      { sky: SkyState.STRATOCUMULUS_BROKEN, min: 160, max: 300, milestone: "slow-breaks" },
    ],
    next: [S.GREY_DRY_DAY, S.FAIR_CUMULUS_DAY, S.WARM_FRONT_SEQUENCE, S.MORNING_FOG],
  },
  [S.MORNING_FOG]: {
    id: S.MORNING_FOG, label: "Morning fog", synoptic: SynopticRegime.FOG_PRONE_NIGHT,
    phases: [
      { sky: SkyState.PATCHY_FOG, min: 140, max: 260, milestone: "fog-forming" },
      { sky: SkyState.DENSE_FOG, min: 120, max: 220, milestone: "dense-fog" },
      { sky: SkyState.PATCHY_FOG, min: 120, max: 200, milestone: "fog-lifting" },
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 140, max: 240, milestone: "burning-off" },
    ],
    next: [S.FAIR_CUMULUS_DAY, S.CLEAR_DAY, S.GREY_DRY_DAY],
  },
  // S4 — front chaud
  [S.WARM_FRONT_SEQUENCE]: {
    id: S.WARM_FRONT_SEQUENCE, label: "Warm front", synoptic: SynopticRegime.WARM_FRONT_APPROACH,
    phases: [
      { sky: SkyState.CLEAR_WITH_CIRRUS, min: 120, max: 200, milestone: "cirrus-arrival" },
      { sky: SkyState.HIGH_VEIL, min: 160, max: 280, milestone: "high-veil" },
      { sky: SkyState.MID_OVERCAST, min: 180, max: 300, milestone: "thickening" },
      { sky: SkyState.NIMBOSTRATUS_RAIN, min: 220, max: 380, milestone: "steady-rain" },
      { sky: SkyState.LOW_OVERCAST, min: 160, max: 280, milestone: "warm-sector" },
    ],
    next: [S.FRONTAL_RAIN_SEQUENCE, S.COLD_FRONT_SEQUENCE, S.GREY_DRY_DAY, S.POST_FRONTAL_SHOWERS],
  },
  [S.FRONTAL_RAIN_SEQUENCE]: {
    id: S.FRONTAL_RAIN_SEQUENCE, label: "Frontal rain", synoptic: SynopticRegime.OCCLUDED_FRONT,
    phases: [
      { sky: SkyState.MID_OVERCAST, min: 140, max: 240, milestone: "deck-lowering" },
      { sky: SkyState.NIMBOSTRATUS_RAIN, min: 260, max: 460, milestone: "durable-rain" },
      { sky: SkyState.LOW_OVERCAST, min: 160, max: 260, milestone: "rain-easing" },
      { sky: SkyState.STRATOCUMULUS_BROKEN, min: 140, max: 240, milestone: "slow-clearing" },
    ],
    next: [S.POST_FRONTAL_SHOWERS, S.GREY_DRY_DAY, S.FAIR_CUMULUS_DAY],
  },
  // S5 — front froid
  [S.COLD_FRONT_SEQUENCE]: {
    id: S.COLD_FRONT_SEQUENCE, label: "Cold front", synoptic: SynopticRegime.COLD_FRONT_PASSAGE,
    phases: [
      { sky: SkyState.SCATTERED_CUMULUS, min: 120, max: 200, milestone: "prefrontal-build" },
      { sky: SkyState.TOWERING_CUMULUS_FIELD, min: 140, max: 240, milestone: "convective-line", feature: "squall_line" },
      { sky: SkyState.STORM_APPROACHING, min: 120, max: 200, milestone: "frontal-passage", feature: "squall_line" },
      { sky: SkyState.POST_SHOWER_SKY, min: 160, max: 280, milestone: "post-frontal-clearing" },
    ],
    next: [S.POST_FRONTAL_SHOWERS, S.FAIR_CUMULUS_DAY, S.CLEAR_DAY],
  },
  [S.POST_FRONTAL_SHOWERS]: {
    id: S.POST_FRONTAL_SHOWERS, label: "Post-frontal showers", synoptic: SynopticRegime.POST_FRONTAL_AIR,
    phases: [
      { sky: SkyState.BROKEN_CUMULUS, min: 140, max: 240, milestone: "cumulus-and-gaps" },
      { sky: SkyState.POST_SHOWER_SKY, min: 160, max: 260, milestone: "scattered-showers", feature: "shower_cell" },
      { sky: SkyState.BROKEN_CUMULUS, min: 120, max: 220, milestone: "sun-between-showers" },
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 120, max: 220, milestone: "settling" },
    ],
    next: [S.FAIR_CUMULUS_DAY, S.VARIABLE_CLOUD_DAY, S.CLEAR_DAY],
  },
  // S2 / S12 — averses & orages isolés
  [S.ISOLATED_SHOWER_DAY]: {
    id: S.ISOLATED_SHOWER_DAY, label: "Isolated showers", synoptic: SynopticRegime.WEAK_LOW_PRESSURE,
    phases: [
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 140, max: 220, milestone: "cumulus-field" },
      { sky: SkyState.SCATTERED_CUMULUS, min: 120, max: 200, milestone: "building" },
      { sky: SkyState.POST_SHOWER_SKY, min: 140, max: 240, milestone: "isolated-shower", feature: "shower_cell" },
      { sky: SkyState.SCATTERED_CUMULUS, min: 120, max: 200, milestone: "shower-passes" },
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 120, max: 200, milestone: "clearing" },
    ],
    next: [S.FAIR_CUMULUS_DAY, S.ISOLATED_THUNDERSTORM_DAY, S.VARIABLE_CLOUD_DAY, S.CLEAR_DAY],
  },
  [S.ISOLATED_THUNDERSTORM_DAY]: {
    id: S.ISOLATED_THUNDERSTORM_DAY, label: "Isolated thunderstorm", synoptic: SynopticRegime.ISOLATED_CONVECTION,
    phases: [
      { sky: SkyState.FAIR_WEATHER_CUMULUS, min: 140, max: 220, milestone: "morning-cumulus" },
      { sky: SkyState.TOWERING_CUMULUS_FIELD, min: 140, max: 240, milestone: "towers-building" },
      { sky: SkyState.STORM_VISIBLE_FAR, min: 120, max: 200, milestone: "cell-forms", feature: "storm_cell" },
      { sky: SkyState.STORM_APPROACHING, min: 100, max: 180, milestone: "cell-nears", feature: "storm_cell" },
      { sky: SkyState.STORM_RECEDING, min: 120, max: 220, milestone: "cell-moves-on", feature: "storm_cell" },
      { sky: SkyState.POST_SHOWER_SKY, min: 140, max: 240, milestone: "post-storm-sky" },
    ],
    next: [S.POST_FRONTAL_SHOWERS, S.FAIR_CUMULUS_DAY, S.CLEAR_DAY],
  },
  [S.ORGANIZED_THUNDERSTORM_DAY]: {
    id: S.ORGANIZED_THUNDERSTORM_DAY, label: "Organized thunderstorms", synoptic: SynopticRegime.ORGANIZED_CONVECTION,
    phases: [
      { sky: SkyState.SCATTERED_CUMULUS, min: 100, max: 180, milestone: "warm-humid-build" },
      { sky: SkyState.TOWERING_CUMULUS_FIELD, min: 120, max: 200, milestone: "explosive-towers" },
      { sky: SkyState.STORM_APPROACHING, min: 120, max: 200, milestone: "squall-line-arrives", feature: "squall_line" },
      { sky: SkyState.STORM_OVERHEAD, min: 100, max: 180, milestone: "core-overhead", feature: "supercell" },
      { sky: SkyState.STORM_RECEDING, min: 120, max: 220, milestone: "line-moves-on", feature: "storm_cell" },
      { sky: SkyState.POST_SHOWER_SKY, min: 140, max: 240, milestone: "outflow-clearing" },
    ],
    next: [S.POST_FRONTAL_SHOWERS, S.COLD_FRONT_SEQUENCE, S.FAIR_CUMULUS_DAY],
  },
  // S9 / S10 / S11 — hiver
  [S.WINTER_OVERCAST_SNOW]: {
    id: S.WINTER_OVERCAST_SNOW, label: "Winter overcast snow", synoptic: SynopticRegime.WINTER_LOW_PRESSURE,
    phases: [
      { sky: SkyState.MID_OVERCAST, min: 140, max: 240, milestone: "snow-shield-arrival" },
      { sky: SkyState.SNOWY_OVERCAST, min: 280, max: 480, milestone: "steady-snow" },
      { sky: SkyState.LOW_OVERCAST, min: 160, max: 260, milestone: "snow-easing" },
      { sky: SkyState.WINTER_CLEAR, min: 160, max: 280, milestone: "cold-clearing" },
    ],
    next: [S.WINTER_SHOWERS, S.FREEZING_FOG_EVENT, S.WINTER_OVERCAST_SNOW],
  },
  [S.WINTER_SHOWERS]: {
    id: S.WINTER_SHOWERS, label: "Winter showers", synoptic: SynopticRegime.COLD_CLEAR_OUTBREAK,
    phases: [
      { sky: SkyState.WINTER_CLEAR, min: 120, max: 200, milestone: "cold-clear" },
      { sky: SkyState.BROKEN_CUMULUS, min: 140, max: 240, milestone: "cold-cumulus" },
      { sky: SkyState.SNOWY_OVERCAST, min: 120, max: 200, milestone: "snow-shower", feature: "snow_cell" },
      { sky: SkyState.WINTER_CLEAR, min: 140, max: 240, milestone: "clearing-between" },
    ],
    next: [S.WINTER_SHOWERS, S.WINTER_OVERCAST_SNOW, S.BLIZZARD_EVENT, S.FREEZING_FOG_EVENT],
  },
  [S.BLIZZARD_EVENT]: {
    id: S.BLIZZARD_EVENT, label: "Blizzard", synoptic: SynopticRegime.WINTER_LOW_PRESSURE,
    phases: [
      { sky: SkyState.SNOWY_OVERCAST, min: 120, max: 200, milestone: "snow-and-wind-rising" },
      { sky: SkyState.WHITEOUT, min: 160, max: 280, milestone: "whiteout", feature: "snow_squall" },
      { sky: SkyState.SNOWY_OVERCAST, min: 160, max: 260, milestone: "wind-easing" },
      { sky: SkyState.WINTER_CLEAR, min: 160, max: 260, milestone: "visibility-returns" },
    ],
    next: [S.WINTER_OVERCAST_SNOW, S.WINTER_SHOWERS],
  },
  [S.FREEZING_FOG_EVENT]: {
    id: S.FREEZING_FOG_EVENT, label: "Freezing fog", synoptic: SynopticRegime.FOG_PRONE_NIGHT,
    phases: [
      { sky: SkyState.PATCHY_FOG, min: 140, max: 240, milestone: "freezing-fog-forming" },
      { sky: SkyState.DENSE_FOG, min: 180, max: 320, milestone: "dense-rime-fog" },
      { sky: SkyState.PATCHY_FOG, min: 120, max: 200, milestone: "slow-lifting" },
      { sky: SkyState.WINTER_CLEAR, min: 140, max: 240, milestone: "cold-clear" },
    ],
    next: [S.WINTER_SHOWERS, S.WINTER_OVERCAST_SNOW, S.BLIZZARD_EVENT],
  },
  // Désert / chaleur
  [S.HEAT_HAZE_DAY]: {
    id: S.HEAT_HAZE_DAY, label: "Heat haze", synoptic: SynopticRegime.HEATWAVE,
    phases: [
      { sky: SkyState.CRYSTAL_CLEAR, min: 140, max: 240, milestone: "hot-clear-morning" },
      { sky: SkyState.HEAT_HAZE, min: 240, max: 420, milestone: "shimmering-haze" },
      { sky: SkyState.CLEAR_WITH_CIRRUS, min: 120, max: 220, milestone: "evening-cirrus" },
    ],
    next: [S.HEAT_HAZE_DAY, S.DRY_WIND_DAY, S.ISOLATED_THUNDERSTORM_DAY, S.CLEAR_DAY],
  },
  [S.DRY_WIND_DAY]: {
    id: S.DRY_WIND_DAY, label: "Dry wind", synoptic: SynopticRegime.DRY_WIND_EVENT,
    phases: [
      { sky: SkyState.CLEAR_WITH_WISPS, min: 120, max: 220, milestone: "wind-rising" },
      { sky: SkyState.DUST_HAZE, min: 200, max: 340, milestone: "dust-haze" },
      { sky: SkyState.CLEAR_WITH_CIRRUS, min: 120, max: 200, milestone: "wind-easing" },
    ],
    next: [S.HEAT_HAZE_DAY, S.DRY_WIND_DAY, S.CLEAR_DAY],
  },
};
