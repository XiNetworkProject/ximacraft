import * as THREE from "three";

export type EntityAnimationName = "idle" | "walk" | "run" | "fly" | "swim" | "hide";

export class EntityAnimationController {
  private readonly mixers = new Map<THREE.Object3D, THREE.AnimationMixer>();

  bind(model: THREE.Object3D): THREE.AnimationMixer {
    let mixer = this.mixers.get(model);
    if (!mixer) {
      mixer = new THREE.AnimationMixer(model);
      this.mixers.set(model, mixer);
    }
    return mixer;
  }

  update(delta: number): void {
    for (const mixer of this.mixers.values()) mixer.update(delta);
  }

  dispose(): void {
    this.mixers.clear();
  }
}
