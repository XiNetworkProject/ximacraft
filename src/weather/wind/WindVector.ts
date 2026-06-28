/**
 * Vecteur de vent 2D (plan x/z) avec quelques helpers.
 * Léger et mutable — utilisé comme vent global et comme résultat d'échantillon.
 */
export class WindVector {
  constructor(public x = 0, public z = 0) {}

  set(x: number, z: number): this {
    this.x = x;
    this.z = z;
    return this;
  }

  copy(other: WindVector): this {
    this.x = other.x;
    this.z = other.z;
    return this;
  }

  clone(): WindVector {
    return new WindVector(this.x, this.z);
  }

  /** Norme du vent. */
  get speed(): number {
    return Math.hypot(this.x, this.z);
  }

  /** Direction en radians (0 = +x / est), ou 0 si vent nul. */
  get angle(): number {
    return this.speed > 1e-6 ? Math.atan2(this.z, this.x) : 0;
  }

  /** Renvoie une copie normalisée (vecteur unitaire), ou (0,0) si vent nul. */
  normalized(): WindVector {
    const s = this.speed;
    return s > 1e-6 ? new WindVector(this.x / s, this.z / s) : new WindVector(0, 0);
  }
}
