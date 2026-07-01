import * as THREE from "three";
import { WildlifeMode, WildlifeSpecies } from "./LivingWorldTypes";

export interface WildlifeAnimationInput {
  species: WildlifeSpecies;
  mode: WildlifeMode;
  age: number;
  phase: number;
  visible: number;
  heading: number;
  baseScale: THREE.Vector3;
}

export interface WildlifeAnimationPose {
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  bob: number;
}

export class EntityAnimationController {
  pose(input: WildlifeAnimationInput): WildlifeAnimationPose {
    const winged = input.species === "bird" || input.species === "bat" || input.species === "butterfly" || input.species === "dragonfly";
    const flapSpeed = input.species === "dragonfly" ? 34 : input.species === "butterfly" ? 14 : input.species === "bat" ? 16 : 11;
    const flap = winged ? 1 + Math.sin(input.age * flapSpeed + input.phase) * (input.species === "dragonfly" ? 0.12 : 0.18) : 1;
    const pulse = input.species === "firefly" ? 0.45 + Math.max(0, Math.sin(input.age * 3.4 + input.phase)) * 0.8 : 1;
    const stride = input.mode === "flee" ? 12 : 5.5;
    const groundBob = input.species === "rabbit" || input.species === "deer" || input.species === "frog"
      ? Math.max(0, Math.sin(input.age * stride + input.phase)) * (input.species === "frog" ? 0.08 : 0.035)
      : 0;
    const swim = input.species === "fish" ? Math.sin(input.age * 4.5 + input.phase) * 0.12 : 0;
    const roll = input.species === "butterfly"
      ? Math.sin(input.age * 9 + input.phase) * 0.32
      : input.species === "dragonfly"
        ? Math.sin(input.age * 18 + input.phase) * 0.08
        : 0;
    return {
      rotation: new THREE.Euler(swim, input.heading, roll),
      scale: new THREE.Vector3(
        input.baseScale.x * input.visible * flap * pulse,
        input.baseScale.y * input.visible * pulse * (1 + groundBob * 0.22),
        input.baseScale.z * input.visible,
      ),
      bob: groundBob,
    };
  }
}
