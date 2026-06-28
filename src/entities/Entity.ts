import * as THREE from "three";

export abstract class Entity {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  mesh: THREE.Object3D | null = null;
  alive = true;

  abstract update(delta: number): void;

  dispose(): void {
    if (this.mesh instanceof THREE.Mesh) {
      this.mesh.geometry.dispose();
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach((material) => material.dispose());
      } else {
        this.mesh.material.dispose();
      }
    }
  }
}
