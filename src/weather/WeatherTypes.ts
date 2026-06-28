/**
 * Types et constantes partagés du moteur météo régional.
 *
 * Ce module ne dépend de RIEN (ni Three.js, ni du moteur de jeu) :
 * c'est volontaire. Toute la logique météo doit rester portable et testable
 * en isolation. Le rendu (src/render/weather) consomme ces types mais ne les
 * modifie jamais.
 */

/**
 * Familles de temps prises en charge par la v0.1.
 * On utilise un `enum` chaîne pour que le debug (`/weather debug cell`) et la
 * future carte météo affichent des libellés lisibles.
 */
export enum WeatherType {
  CLEAR = "CLEAR",
  PARTLY_CLOUDY = "PARTLY_CLOUDY",
  CLOUDY = "CLOUDY",
  OVERCAST = "OVERCAST",
  LIGHT_RAIN = "LIGHT_RAIN",
  HEAVY_RAIN = "HEAVY_RAIN",
  THUNDERSTORM = "THUNDERSTORM",
  SNOW = "SNOW",
  FOG = "FOG",
  CLEARING = "CLEARING",
}

/** Catégories d'événements météo (perturbations) gérées par le moteur. */
export enum WeatherEventType {
  CLOUDY_AREA = "cloudy_area",
  CLEARING = "clearing",
  RAIN_BAND = "rain_band",
  COLD_FRONT = "cold_front",
  WARM_FRONT = "warm_front",
  STORM_CELL = "storm_cell",
  SQUALL_LINE = "squall_line",
}

/** Directions cardinales acceptées par les commandes (`direction=east`). */
export type Cardinal = "north" | "south" | "east" | "west" | "ne" | "nw" | "se" | "sw";

/** Nature de précipitation produite par un événement (pour rendu/sol). */
export type PrecipKind = "none" | "rain" | "snow" | "hail";

/**
 * Signature visuelle d'un événement : ce dont les renderers (rideaux, éclairs,
 * sol) ont besoin pour dessiner SANS connaître le type concret de l'événement.
 */
export interface WeatherVisualSignature {
  /** Type de précipitation dominant. */
  precip: PrecipKind;
  /** L'événement produit-il des éclairs ? */
  lightning: boolean;
  /** Altitude (Y monde) de la base nuageuse, pour poser le rideau de pluie. */
  cloudBaseY: number;
}

/** Niveaux d'intensité nommés acceptés par les commandes (`intensity=strong`). */
export type IntensityLevel = "weak" | "moderate" | "strong" | "extreme";

/**
 * Champs physiques bruts d'une parcelle d'atmosphère.
 * Partagé entre {@link WeatherCell} et les échantillons interpolés
 * ({@link WeatherSample}) pour avoir une SEULE fonction de classification.
 */
export interface WeatherFields {
  /** Température de l'air en °C. */
  temperature: number;
  /** Humidité relative normalisée 0..1. */
  humidity: number;
  /** Pression au niveau du sol en hPa (~1013 = normale). */
  pressure: number;
  /** Instabilité convective 0..1 (potentiel orageux). */
  instability: number;
  /** Couverture nuageuse 0..1. */
  cloudCover: number;
  /** Précipitations 0..1. */
  precipitation: number;
  /** Risque d'orage 0..1 (dérivé d'instabilité + précipitations). */
  thunderRisk: number;
  /** Composante de vent est-ouest (blocs/s à l'échelle météo, signé). */
  windX: number;
  /** Composante de vent nord-sud (blocs/s à l'échelle météo, signé). */
  windZ: number;
  /**
   * Biais d'éclaircie 0..1. Marqueur transitoire posé par {@link ClearingEvent}
   * pour afficher l'état CLEARING tant que les nuages se dissipent.
   */
  clearingBias: number;
}

/**
 * Lecture météo prête à consommer à un point précis du monde.
 * Produit par {@link WeatherEngine.sampleAt} (interpolation bilinéaire) puis
 * consommé par le rendu, l'UI et les sons.
 */
export interface WeatherSample extends WeatherFields {
  /** Type météo classifié à partir des champs. */
  weatherType: WeatherType;
  /** Norme du vent (hypot(windX, windZ)). */
  windSpeed: number;
}

/** Valeurs de repos (climat de fond) d'une cellule, vers lesquelles elle relaxe. */
export interface CellBaseline {
  temperature: number;
  humidity: number;
  pressure: number;
  instability: number;
  cloudCover: number;
  windX: number;
  windZ: number;
}

/** Taille d'une cellule météo en blocs. Une cellule = une grande zone du monde. */
export const CELL_SIZE = 512;

/** Pas de simulation fixe (s). Découple la météo de la fréquence d'images. */
export const SIM_STEP = 0.2;

/**
 * Climat de fond par défaut (tempéré). Le moteur peut remplacer ce baseline
 * par cellule via un fournisseur (futur : couplage aux biomes).
 */
export const DEFAULT_BASELINE: CellBaseline = {
  temperature: 14,
  humidity: 0.42,
  pressure: 1013,
  instability: 0.1,
  cloudCover: 0.15,
  windX: 0,
  windZ: 0,
};

/** Conversion d'un niveau nommé en valeur 0..1. */
export function intensityToValue(level: IntensityLevel): number {
  switch (level) {
    case "weak":
      return 0.35;
    case "moderate":
      return 0.6;
    case "strong":
      return 0.85;
    case "extreme":
      return 1;
  }
}
