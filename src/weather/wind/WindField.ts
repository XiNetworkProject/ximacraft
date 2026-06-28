/**
 * Champ de vent du monde.
 *
 * v0.1 : un vent global (réglable via commande) + une légère variation spatiale
 * basse fréquence pour que toutes les cellules ne dérivent pas exactement pareil.
 * Le vent de fond de chaque cellule est échantillonné ici à chaque pas, ce qui
 * fait dériver naturellement les perturbations dans la direction du vent.
 *
 * v0.2+ : remplacer `sample()` par un vrai champ (bruit de Perlin advecté,
 * influence du relief, convergences/divergences) sans toucher au reste.
 */

import { WindVector } from "./WindVector";

export class WindField {
  /** Vent global de base (la "tendance" générale). */
  readonly global = new WindVector(0, 0);

  /** Temps interne (s), avance la variation spatiale. */
  private time = 0;

  /** Amplitude de la variation locale autour du vent global (blocs/s). */
  amplitude = 1.5;

  setGlobal(x: number, z: number): void {
    this.global.set(x, z);
  }

  update(dt: number): void {
    this.time += dt;
  }

  reset(): void {
    this.time = 0;
    this.global.set(0, 0);
  }

  clone(): WindField {
    const copy = new WindField();
    copy.global.set(this.global.x, this.global.z);
    copy.time = this.time;
    copy.amplitude = this.amplitude;
    return copy;
  }

  /**
   * Vent à une position monde. Renvoie le vent global modulé par une houle
   * spatiale douce. `out` permet de réutiliser un vecteur (zéro allocation).
   */
  sample(worldX: number, worldZ: number, out = new WindVector()): WindVector {
    const fx = worldX * 0.0006;
    const fz = worldZ * 0.0006;
    const t = this.time * 0.05;
    const swirlX = Math.sin(fz + t) * this.amplitude;
    const swirlZ = Math.cos(fx - t) * this.amplitude;
    return out.set(this.global.x + swirlX, this.global.z + swirlZ);
  }
}
