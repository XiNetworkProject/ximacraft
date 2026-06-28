import * as THREE from "three";

/**
 * Un puff : la brique élémentaire d'un nuage. C'est une PARTICULE simulée
 * (position, vitesse, âge), pas un sprite. Elle naît petite et peu dense,
 * grossit, peut bourgeonner (créer des enfants au-dessus), puis s'érode et
 * disparaît progressivement.
 *
 * Le rendu en dessine un ellipsoïde 3D (sphère écrasée par `flatten`).
 */
export class CloudPuff {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  /** Rayon visuel courant (blocs). Approche `targetRadius`. */
  radius: number;
  targetRadius: number;

  /** Opacité 0..1 (monte à la naissance, redescend en s'érodant). */
  density = 0.02;
  /** Luminosité de base 0..1 (sommet plus blanc que base) — posée par la sim. */
  brightness = 1;
  /** Assombrissement 0..1 (base d'orage qui précipite). */
  darkness = 0;
  /** Maturité 0..1. */
  growth = 0;
  /** Érosion 0..1 (ronge les bords / petits puffs). */
  erosion = 0;

  age = 0;
  maxAge: number;

  /** Aplatissement vertical (1 = rond, <1 = aplati → enclume). */
  flatten = 1;
  /** Fait partie de l'enclume (advecté par le vent d'altitude). */
  isAnvil = false;

  /** Temps avant de pouvoir bourgeonner à nouveau (s). */
  budCooldown: number;
  /** Combien d'enfants ce puff a déjà créés. */
  budsSpawned = 0;

  /** Graine déterministe pour le bruit de surface au rendu. */
  readonly seed = Math.random() * 1000;

  /** Distance² à la caméra, posée par le renderer pour le tri de profondeur. */
  sortDist = 0;

  constructor(x: number, y: number, z: number, targetRadius: number, maxAge: number) {
    this.position.set(x, y, z);
    this.radius = targetRadius * 0.25;
    this.targetRadius = targetRadius;
    this.maxAge = maxAge;
    this.budCooldown = 1.5 + Math.random() * 2;
  }

  /** Quasiment effacé → peut être retiré. */
  get faded(): boolean {
    return this.density <= 0.012 && this.age > 2;
  }
}
