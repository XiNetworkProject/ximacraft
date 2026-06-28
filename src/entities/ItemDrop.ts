import * as THREE from "three";
import { BlockRegistry } from "../world/BlockRegistry";
import { BlockId } from "../world/BlockTypes";
import { Entity } from "./Entity";

export class ItemDrop extends Entity {
  age = 0;

  constructor(
    readonly blockId: BlockId,
    position: THREE.Vector3,
    blockRegistry: BlockRegistry,
  ) {
    super();
    this.position.copy(position);
    const color = blockRegistry.get(blockId).color;
    const geometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const material = new THREE.MeshLambertMaterial({ color });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.position);
  }

  update(delta: number): void {
    this.age += delta;
    this.velocity.y -= 12 * delta;
    this.position.addScaledVector(this.velocity, delta);
    if (this.position.y < 1) {
      this.position.y = 1;
      this.velocity.y *= -0.25;
    }
    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y += delta * 2;
    }
    if (this.age > 120) {
      this.alive = false;
    }
  }
}
