/**
 * Modèle de scène météo multi-axes — CŒUR de l'atlas météo.
 *
 * Le défaut historique du jeu : tout décrire avec un seul `WeatherType`, ce qui
 * pousse vers la séquence pauvre `clair -> humidité -> pluie/orage -> éclaircie`.
 *
 * On sépare ici la météo en AXES INDÉPENDANTS (régime synoptique, état du ciel,
 * couches nuageuses, précipitations, visibilité, vent, profil de température,
 * sol, convection, transition). Un orage n'est plus qu'UN résultat possible
 * parmi des dizaines de ciels « normaux » (clair, voilé, cumulus de beau temps,
 * couvert sec, bruine, brume, post-averse...).
 *
 * Ce module est PUR : aucune dépendance à Three.js ni au moteur de jeu, pour
 * rester portable et testable en isolation (cf. scripts/weather-scene.test.ts).
 */

import { PrecipKind, WeatherType } from "../WeatherTypes";

// --- Axe 1 : régime synoptique (la grande histoire météo) -------------------

export enum SynopticRegime {
  STABLE_HIGH_PRESSURE = "STABLE_HIGH_PRESSURE",
  HUMID_HIGH_PRESSURE = "HUMID_HIGH_PRESSURE",
  WEAK_LOW_PRESSURE = "WEAK_LOW_PRESSURE",
  WARM_FRONT_APPROACH = "WARM_FRONT_APPROACH",
  WARM_SECTOR = "WARM_SECTOR",
  COLD_FRONT_APPROACH = "COLD_FRONT_APPROACH",
  COLD_FRONT_PASSAGE = "COLD_FRONT_PASSAGE",
  POST_FRONTAL_AIR = "POST_FRONTAL_AIR",
  OCCLUDED_FRONT = "OCCLUDED_FRONT",
  CONVECTIVE_DAY = "CONVECTIVE_DAY",
  ISOLATED_CONVECTION = "ISOLATED_CONVECTION",
  ORGANIZED_CONVECTION = "ORGANIZED_CONVECTION",
  WINTER_LOW_PRESSURE = "WINTER_LOW_PRESSURE",
  COLD_CLEAR_OUTBREAK = "COLD_CLEAR_OUTBREAK",
  FOG_PRONE_NIGHT = "FOG_PRONE_NIGHT",
  HEATWAVE = "HEATWAVE",
  DRY_WIND_EVENT = "DRY_WIND_EVENT",
}

// --- Axe 2 : état du ciel (ce que le joueur voit) ---------------------------

export enum SkyState {
  CRYSTAL_CLEAR = "CRYSTAL_CLEAR",
  CLEAR_WITH_CIRRUS = "CLEAR_WITH_CIRRUS",
  CLEAR_WITH_WISPS = "CLEAR_WITH_WISPS",
  FAIR_WEATHER_CUMULUS = "FAIR_WEATHER_CUMULUS",
  SCATTERED_CUMULUS = "SCATTERED_CUMULUS",
  BROKEN_CUMULUS = "BROKEN_CUMULUS",
  TOWERING_CUMULUS_FIELD = "TOWERING_CUMULUS_FIELD",
  STRATOCUMULUS_BROKEN = "STRATOCUMULUS_BROKEN",
  STRATOCUMULUS_OVERCAST = "STRATOCUMULUS_OVERCAST",
  HIGH_VEIL = "HIGH_VEIL",
  MID_OVERCAST = "MID_OVERCAST",
  LOW_OVERCAST = "LOW_OVERCAST",
  NIMBOSTRATUS_RAIN = "NIMBOSTRATUS_RAIN",
  PATCHY_FOG = "PATCHY_FOG",
  DENSE_FOG = "DENSE_FOG",
  POST_SHOWER_SKY = "POST_SHOWER_SKY",
  STORM_VISIBLE_FAR = "STORM_VISIBLE_FAR",
  STORM_APPROACHING = "STORM_APPROACHING",
  STORM_OVERHEAD = "STORM_OVERHEAD",
  STORM_RECEDING = "STORM_RECEDING",
  WINTER_CLEAR = "WINTER_CLEAR",
  SNOWY_OVERCAST = "SNOWY_OVERCAST",
  WHITEOUT = "WHITEOUT",
  DUST_HAZE = "DUST_HAZE",
  SANDSTORM_SKY = "SANDSTORM_SKY",
  HEAT_HAZE = "HEAT_HAZE",
}

// --- Axe 3 : précipitations (ce qui tombe réellement) -----------------------

export enum PrecipitationKind {
  NONE = "NONE",
  DRIZZLE = "DRIZZLE",
  LIGHT_RAIN = "LIGHT_RAIN",
  STEADY_RAIN = "STEADY_RAIN",
  HEAVY_RAIN = "HEAVY_RAIN",
  LOCAL_SHOWER = "LOCAL_SHOWER",
  THUNDERSTORM_RAIN = "THUNDERSTORM_RAIN",
  SNOW_FLURRIES = "SNOW_FLURRIES",
  LIGHT_SNOW = "LIGHT_SNOW",
  STEADY_SNOW = "STEADY_SNOW",
  SNOW_SHOWER = "SNOW_SHOWER",
  SNOW_SQUALL = "SNOW_SQUALL",
  BLOWING_SNOW = "BLOWING_SNOW",
  HAIL = "HAIL",
  GRAUPEL = "GRAUPEL",
  SLEET = "SLEET",
  FREEZING_RAIN = "FREEZING_RAIN",
  DUST = "DUST",
  SAND = "SAND",
}

export type PrecipitationPattern = "none" | "uniform" | "band" | "cell" | "core" | "patchy";

export interface PrecipitationState {
  kind: PrecipitationKind;
  /** Intensité 0..1. */
  intensity: number;
  spatialPattern: PrecipitationPattern;
  sourceCloudId?: string;
  beginsAtCloudBase: boolean;
  /** false = virga / précip qui n'atteint pas le sol (pas d'accumulation). */
  reachesGround: boolean;
  /** Précipitation qui s'évapore avant le sol. */
  virga: boolean;
  /** Inclinaison par le vent (0 = vertical). */
  windTilt: number;
}

// --- Axe 4 : couches nuageuses (le ciel est multi-couches) ------------------

export enum CloudLayerType {
  CIRRUS = "CIRRUS",
  CIRROSTRATUS = "CIRROSTRATUS",
  ALTOCUMULUS = "ALTOCUMULUS",
  ALTOSTRATUS = "ALTOSTRATUS",
  NIMBOSTRATUS = "NIMBOSTRATUS",
  STRATUS = "STRATUS",
  STRATOCUMULUS = "STRATOCUMULUS",
  FAIR_CUMULUS = "FAIR_CUMULUS",
  TOWERING_CUMULUS = "TOWERING_CUMULUS",
  CUMULONIMBUS = "CUMULONIMBUS",
  ANVIL = "ANVIL",
  FOG = "FOG",
}

export interface CloudLayer {
  type: CloudLayerType;
  baseHeight: number;
  topHeight: number;
  /** Couverture 0..1. */
  coverage: number;
  opacity: number;
  movementX: number;
  movementZ: number;
  directionVariance: number;
  persistence: number;
  precipitationPotential: number;
  visibleDistancePriority: number;
}

// --- Axe 5 : visibilité / brume ---------------------------------------------

export interface VisibilityState {
  /** Visibilité 0 (whiteout/brouillard dense) .. 1 (air parfaitement clair). */
  range: number;
  /** Densité de brouillard au sol 0..1. */
  fogDensity: number;
  /** Voile de chaleur / poussière 0..1 (réduit le contraste sans blanchir). */
  haze: number;
  /** Désaturation des couleurs 0..1 (brouillard dense). */
  desaturation: number;
}

// --- Axe 6 : vent -----------------------------------------------------------

export interface WindState {
  /** Direction unitaire de surface. */
  dirX: number;
  dirZ: number;
  /** Vitesse moyenne (blocs/s à l'échelle météo). */
  speed: number;
  /** Force des rafales 0..1. */
  gustiness: number;
  /** Direction du vent d'altitude (oriente cirrus et enclumes). */
  upperDirX: number;
  upperDirZ: number;
}

// --- Axe 7 : profil de température (vertical, pour neige/verglas) ------------

export interface TemperatureProfile {
  surface: number;
  /** Température à la base des nuages (°C). */
  cloudBase: number;
  /** Y du niveau de gel (sous = pluie possible, sur = neige). */
  freezingLevel: number;
  /** Couche chaude en altitude qui transforme neige -> pluie verglaçante. */
  warmNoseAloft: boolean;
}

// --- Axe 8 : état météo de surface ------------------------------------------

export interface SurfaceConditionState {
  /** Humidité du sol 0..1 (cible pour le système d'accumulation). */
  wetnessTarget: number;
  /** Neige fraîche déposée 0..1 (cible). */
  freshSnowTarget: number;
  /** Couche de glace / verglas 0..1 (cible). */
  iceTarget: number;
  /** Reprise de neige au sol par le vent (poudrerie). */
  blowingFromGround: boolean;
}

// --- Axe 9 : convection -----------------------------------------------------

export interface ConvectiveState {
  /** Potentiel convectif 0..1 (CAPE simplifiée). */
  potential: number;
  /** Nombre de tours (towering cumulus) en développement. */
  toweringCount: number;
  /** Une cellule orageuse organisée est-elle active ? */
  cellActive: boolean;
  /** Cellule(s) en ligne (squall line). */
  organizedLine: boolean;
}

// --- Axe 10 : transition ----------------------------------------------------

export interface WeatherTransitionState {
  from: SkyState;
  to: SkyState;
  /** Progression 0..1 de la transition courante. */
  progress: number;
  /** Durée totale prévue de la transition (s). */
  durationSeconds: number;
}

/** Zone active d'éclairs dans une cellule orageuse (localise les décharges). */
export interface LightningChargeZone {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Charge accumulée 0..1 (déclenche un éclair quand pleine). */
  charge: number;
  type: "INTRA_CLOUD" | "CLOUD_TO_CLOUD" | "CLOUD_TO_GROUND" | "EMBEDDED_RAIN";
  cooldown: number;
}

// --- État de scène agrégé ---------------------------------------------------

export interface WeatherSceneState {
  synopticRegime: SynopticRegime;
  skyState: SkyState;
  cloudLayers: CloudLayer[];
  precipitation: PrecipitationState;
  visibility: VisibilityState;
  wind: WindState;
  temperatureProfile: TemperatureProfile;
  surfaceState: SurfaceConditionState;
  convectiveState: ConvectiveState;
  transition: WeatherTransitionState;
}

// --- Population de nuages (4 niveaux simultanés) ----------------------------

export enum CloudPopulationBand {
  BACKGROUND_LAYER = "BACKGROUND_LAYER",
  HORIZON_FIELD = "HORIZON_FIELD",
  MID_FIELD = "MID_FIELD",
  HERO_VOLUMES = "HERO_VOLUMES",
}

export interface CloudCluster {
  id: string;
  seed: number;
  band: CloudPopulationBand;
  x: number;
  z: number;
  baseHeight: number;
  targetCoverage: number;
  targetSize: number;
  type: "FAIR" | "SCATTERED" | "TOWERING" | "DISSIPATING";
  age: number;
  lifetime: number;
  fadeIn: number;
  fadeOut: number;
  weatherInfluence: number;
  canBecomeConvective: boolean;
}

// --- Scénarios (plan météo persistant) --------------------------------------

export enum WeatherScenario {
  CLEAR_DAY = "CLEAR_DAY",
  FAIR_CUMULUS_DAY = "FAIR_CUMULUS_DAY",
  VARIABLE_CLOUD_DAY = "VARIABLE_CLOUD_DAY",
  GREY_DRY_DAY = "GREY_DRY_DAY",
  MORNING_FOG = "MORNING_FOG",
  WARM_FRONT_SEQUENCE = "WARM_FRONT_SEQUENCE",
  FRONTAL_RAIN_SEQUENCE = "FRONTAL_RAIN_SEQUENCE",
  COLD_FRONT_SEQUENCE = "COLD_FRONT_SEQUENCE",
  POST_FRONTAL_SHOWERS = "POST_FRONTAL_SHOWERS",
  ISOLATED_SHOWER_DAY = "ISOLATED_SHOWER_DAY",
  ISOLATED_THUNDERSTORM_DAY = "ISOLATED_THUNDERSTORM_DAY",
  ORGANIZED_THUNDERSTORM_DAY = "ORGANIZED_THUNDERSTORM_DAY",
  WINTER_OVERCAST_SNOW = "WINTER_OVERCAST_SNOW",
  WINTER_SHOWERS = "WINTER_SHOWERS",
  BLIZZARD_EVENT = "BLIZZARD_EVENT",
  FREEZING_FOG_EVENT = "FREEZING_FOG_EVENT",
  HEAT_HAZE_DAY = "HEAT_HAZE_DAY",
  DRY_WIND_DAY = "DRY_WIND_DAY",
}

export type Season = "SPRING" | "SUMMER" | "AUTUMN" | "WINTER";

/** Facteurs d'environnement qui pondèrent le choix d'un scénario. */
export interface WeatherContext {
  season: Season;
  /** Heure normalisée 0..1 (0 = minuit, 0.5 = midi). */
  timeOfDay: number;
  biomeHumidity: number;
  biomeTemperature: number;
  altitude: number;
  terrainLift: number;
  surfaceWetness: number;
  snowCover: number;
  previousScenario: WeatherScenario | null;
  currentPressureTrend: number;
}

/** Plan météo persistant : une histoire de plusieurs phases qui dure. */
export interface WeatherPlan {
  id: string;
  seed: number;
  scenario: WeatherScenario;
  startedAt: number;
  expectedDuration: number;
  phaseIndex: number;
  phaseProgress: number;
  nextScenarioCandidates: WeatherScenario[];
  temperatureTrend: number;
  humidityTrend: number;
  pressureTrend: number;
  windTrend: number;
  convectivePotential: number;
}

// --- Helpers de mapping vers le moteur de jeu existant ----------------------

/** Convertit un genre de précipitation riche vers le `PrecipKind` du moteur. */
export function precipitationKindToEngine(kind: PrecipitationKind): PrecipKind {
  switch (kind) {
    case PrecipitationKind.NONE:
    case PrecipitationKind.DUST:
    case PrecipitationKind.SAND:
      return "none";
    case PrecipitationKind.SNOW_FLURRIES:
    case PrecipitationKind.LIGHT_SNOW:
    case PrecipitationKind.STEADY_SNOW:
    case PrecipitationKind.SNOW_SHOWER:
    case PrecipitationKind.SNOW_SQUALL:
    case PrecipitationKind.BLOWING_SNOW:
      return "snow";
    case PrecipitationKind.HAIL:
    case PrecipitationKind.GRAUPEL:
      return "hail";
    default:
      return "rain";
  }
}

/** true si la précipitation est de la neige (toutes formes confondues). */
export function isSnowPrecip(kind: PrecipitationKind): boolean {
  return precipitationKindToEngine(kind) === "snow";
}

/**
 * Type météo legacy approché à partir d'un état de ciel — pratique pour
 * conserver les libellés HUD/legacy existants et le routage UI.
 */
export function skyStateToWeatherType(sky: SkyState): WeatherType {
  switch (sky) {
    case SkyState.CRYSTAL_CLEAR:
    case SkyState.WINTER_CLEAR:
    case SkyState.HEAT_HAZE:
      return WeatherType.CLEAR;
    case SkyState.CLEAR_WITH_CIRRUS:
    case SkyState.CLEAR_WITH_WISPS:
    case SkyState.FAIR_WEATHER_CUMULUS:
    case SkyState.SCATTERED_CUMULUS:
    case SkyState.DUST_HAZE:
      return WeatherType.PARTLY_CLOUDY;
    case SkyState.BROKEN_CUMULUS:
    case SkyState.STRATOCUMULUS_BROKEN:
    case SkyState.HIGH_VEIL:
    case SkyState.POST_SHOWER_SKY:
    case SkyState.STORM_VISIBLE_FAR:
      return WeatherType.CLOUDY;
    case SkyState.TOWERING_CUMULUS_FIELD:
    case SkyState.STRATOCUMULUS_OVERCAST:
    case SkyState.MID_OVERCAST:
    case SkyState.LOW_OVERCAST:
    case SkyState.SANDSTORM_SKY:
      return WeatherType.OVERCAST;
    case SkyState.NIMBOSTRATUS_RAIN:
      return WeatherType.HEAVY_RAIN;
    case SkyState.SNOWY_OVERCAST:
    case SkyState.WHITEOUT:
      return WeatherType.SNOW;
    case SkyState.STORM_APPROACHING:
    case SkyState.STORM_OVERHEAD:
    case SkyState.STORM_RECEDING:
      return WeatherType.THUNDERSTORM;
    case SkyState.PATCHY_FOG:
    case SkyState.DENSE_FOG:
      return WeatherType.FOG;
  }
}
