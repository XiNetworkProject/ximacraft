import * as THREE from "three";
import { clamp } from "../utils/MathUtils";
import { Input } from "./Input";

export class CameraController {
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0023;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(input: Input, lookEnabled: boolean): void {
    if (lookEnabled) {
      this.yaw -= input.mouseDeltaX * this.sensitivity;
      this.pitch -= input.mouseDeltaY * this.sensitivity;
      this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    }

    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(target).normalize();
  }

  getFlatForward(target = new THREE.Vector3()): THREE.Vector3 {
    this.camera.getWorldDirection(target);
    target.y = 0;
    if (target.lengthSq() < 0.0001) {
      target.set(0, 0, -1);
    }
    target.normalize();
    return target;
  }

  getRight(target = new THREE.Vector3()): THREE.Vector3 {
    const forward = this.getFlatForward(target);
    return forward.cross(new THREE.Vector3(0, 1, 0)).normalize();
  }
}
