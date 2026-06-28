/**
 * Phases de vie d'un événement météo + calcul de la phase courante.
 *
 * La phase combine le CYCLE DE VIE (age/maxAge) et la position SPATIALE par
 * rapport à l'observateur (approche / impact / passage). C'est ce qui rend la
 * météo "lisible" : le joueur voit l'événement se former au loin, se développer,
 * approcher, l'impacter, puis passer et se dissiper.
 */

import { clamp01 } from "../WeatherMath";

export enum WeatherEventPhase {
  FORMING = "FORMING",
  DEVELOPING = "DEVELOPING",
  MATURE = "MATURE",
  APPROACHING = "APPROACHING",
  IMPACTING = "IMPACTING",
  PASSING = "PASSING",
  DISSIPATING = "DISSIPATING",
}

export interface PhaseInputs {
  age: number;
  maxAge: number;
  radius: number;
  /** Distance observateur→centre (undefined si pas d'observateur). */
  distance?: number;
  /** Distance au pas précédent (pour savoir si on approche ou on s'éloigne). */
  prevDistance?: number;
}

/**
 * Calcule la phase courante. La fenêtre de vie domine aux extrêmes
 * (naissance/dissipation) ; au milieu, la relation spatiale à l'observateur
 * décide approche / impact / passage.
 */
export function computePhase(i: PhaseInputs): WeatherEventPhase {
  const f = clamp01(i.age / i.maxAge);
  if (f < 0.12) return WeatherEventPhase.FORMING;
  if (f > 0.9) return WeatherEventPhase.DISSIPATING;

  // Sans observateur : on s'en tient au cycle de vie.
  if (i.distance === undefined) {
    if (f < 0.32) return WeatherEventPhase.DEVELOPING;
    return WeatherEventPhase.MATURE;
  }

  const inside = i.distance < i.radius;
  if (inside) return WeatherEventPhase.IMPACTING;
  if (f < 0.32) return WeatherEventPhase.DEVELOPING;

  const approaching = i.prevDistance !== undefined && i.distance < i.prevDistance - 0.001;
  if (approaching && i.distance < i.radius * 2.5) return WeatherEventPhase.APPROACHING;
  if (!approaching && i.distance < i.radius * 3) return WeatherEventPhase.PASSING;
  return WeatherEventPhase.MATURE;
}
