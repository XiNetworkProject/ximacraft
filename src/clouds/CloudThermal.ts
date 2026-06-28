import * as THREE from "three";

/**
 * Une thermique : une bulle d'air chaud INVISIBLE qui monte depuis la base du
 * nuage. Quand elle dépasse le niveau de condensation, elle « dépose » des
 * puffs sur son passage → c'est ce qui crée les tours convectives et le côté
 * chou-fleur (plusieurs thermiques = plusieurs bourgeons).
 */
export class CloudThermal {
  readonly position = new THREE.Vector3();
  radius: number;
  strength: number;
  verticalVelocity: number;
  age = 0;
  active = true;

  /** Dernière altitude à laquelle un puff a été déposé (espacement vertical). */
  lastPuffY: number;

  constructor(x: number, y: number, z: number, radius: number, strength: number, verticalVelocity: number) {
    this.position.set(x, y, z);
    this.radius = radius;
    this.strength = strength;
    this.verticalVelocity = verticalVelocity;
    this.lastPuffY = y;
  }
}
