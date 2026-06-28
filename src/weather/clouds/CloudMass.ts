/**
 * Une masse nuageuse discrète : un nuage individuel dans le ciel, avec son
 * cycle de vie (naissance → croissance → assombrissement → dissipation).
 *
 * Données quasi pures : c'est {@link CloudGrowthSystem} qui fait évoluer ces
 * champs en fonction des conditions échantillonnées dans le moteur météo, et
 * {@link CloudMassRenderer} qui les dessine.
 */

import { CloudType } from "./CloudType";

let nextId = 1;

export class CloudMass {
  readonly id = nextId++;

  // Dimensions (blocs).
  width = 16;
  height = 10;

  // État visuel/physique 0..1.
  density = 0; // opacité globale (suit growth)
  darkness = 0; // noirceur de la base (risque d'orage)
  growth = 0; // maturité 0..1
  moisture = 0; // humidité locale lissée
  instability = 0; // instabilité locale lissée
  anvilStretch = 0; // étirement de l'enclume 0..1

  // Direction d'étirement de l'enclume (vent d'altitude local, unitaire).
  anvilDirX = 1;
  anvilDirZ = 0;

  type: CloudType = CloudType.CUMULUS;
  /** Si défini, le type est imposé (spawn par commande) et non reclassé. */
  pinnedType: CloudType | null = null;

  age = 0;
  /** Mis en dissipation forcée (ClearingEvent / commande clear). */
  dissipating = false;

  /** Graine déterministe pour le placement des puffs au rendu. */
  readonly seed = Math.floor(Math.random() * 1_000_000);

  constructor(
    public x: number,
    public y: number,
    public z: number,
    public maxAge = 300,
  ) {}
}
