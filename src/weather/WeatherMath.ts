/**
 * Helpers mathématiques propres au moteur météo.
 *
 * Volontairement autonome (ne dépend pas de utils/MathUtils) pour que le
 * dossier weather/ reste portable. La fonction la plus importante est
 * {@link classifyWeather} : c'est l'UNIQUE source de vérité qui transforme des
 * champs physiques en {@link WeatherType}, utilisée à la fois par les cellules
 * et par l'échantillonnage interpolé.
 */

import { Cardinal, WeatherFields, WeatherType } from "./WeatherTypes";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolation inverse : position de `value` entre `a` et `b`, bornée 0..1. */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return clamp01((value - a) / (b - a));
}

export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Déplace `current` vers `target` à une vitesse constante (`ratePerSec`),
 * indépendamment de la fréquence d'images. Plafonné pour ne jamais dépasser
 * la cible. C'est la primitive de transition douce de tout le moteur.
 */
export function approach(current: number, target: number, ratePerSec: number, dt: number): number {
  const maxStep = ratePerSec * dt;
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

export function distance2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.hypot(dx, dz);
}

/** Convertit une direction cardinale en vecteur unitaire {x, z}. */
export function cardinalToVector(dir: Cardinal): { x: number; z: number } {
  // Convention : +x = est, +z = sud (cohérent avec Three.js / le monde voxel).
  const s = Math.SQRT1_2;
  switch (dir) {
    case "north":
      return { x: 0, z: -1 };
    case "south":
      return { x: 0, z: 1 };
    case "east":
      return { x: 1, z: 0 };
    case "west":
      return { x: -1, z: 0 };
    case "ne":
      return { x: s, z: -s };
    case "nw":
      return { x: -s, z: -s };
    case "se":
      return { x: s, z: s };
    case "sw":
      return { x: -s, z: s };
  }
}

/** Étiquette boussole 8 points d'un vecteur de direction (E, SE, S, ...). */
export function vectorToCompass(x: number, z: number): string {
  if (Math.hypot(x, z) < 1e-6) return "-";
  // Convention : +x = est, +z = sud. atan2(z, x) : 0 = E, +PI/2 = S.
  const labels = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
  return labels[Math.round(angle / (Math.PI / 4)) % 8];
}

/** Hash entier déterministe (32 bits) — base du bruit de fond par cellule. */
export function hash2i(x: number, z: number, seed = 0): number {
  let h = (x | 0) * 374761393 + (z | 0) * 668265263 + (seed | 0) * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Valeur pseudo-aléatoire déterministe dans [0, 1) pour une cellule donnée. */
export function cellNoise(x: number, z: number, seed = 0): number {
  return hash2i(x, z, seed) / 4294967296;
}

/**
 * Classifie un jeu de champs physiques en {@link WeatherType}.
 * SOURCE DE VÉRITÉ UNIQUE — appelée par WeatherCell et par l'échantillonnage.
 * L'ordre des tests compte (neige avant orage, précipitations avant nuages).
 */
export function classifyWeather(f: WeatherFields): WeatherType {
  const windSpeed = Math.hypot(f.windX, f.windZ);

  // Éclaircie : marqueur transitoire pendant que les nuages se dissipent.
  if (f.clearingBias > 0.35 && f.cloudCover > 0.2 && f.cloudCover < 0.75) {
    return WeatherType.CLEARING;
  }

  // Précipitations actives.
  if (f.precipitation > 0.05) {
    if (f.temperature <= 0) return WeatherType.SNOW;
    if (f.thunderRisk > 0.55 && f.precipitation > 0.4) return WeatherType.THUNDERSTORM;
    if (f.precipitation >= 0.45) return WeatherType.HEAVY_RAIN;
    return WeatherType.LIGHT_RAIN;
  }

  // Brouillard : air saturé, calme, peu de nuages hauts.
  if (f.humidity > 0.9 && windSpeed < 1.5 && f.cloudCover < 0.5) {
    return WeatherType.FOG;
  }

  // Ciel par couverture nuageuse.
  if (f.cloudCover > 0.85) return WeatherType.OVERCAST;
  if (f.cloudCover > 0.5) return WeatherType.CLOUDY;
  if (f.cloudCover > 0.2) return WeatherType.PARTLY_CLOUDY;
  return WeatherType.CLEAR;
}
