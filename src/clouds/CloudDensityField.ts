import * as THREE from "three";
import { CloudLifecycle } from "./CloudLifecycle";
import { CloudMass } from "./CloudMass";

function hash3(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function lifecycleOpacity(mass: CloudMass): number {
  if (mass.lifecycle === CloudLifecycle.DISSIPATED) return 0;
  if (mass.lifecycle === CloudLifecycle.DISSIPATING) return Math.max(0, mass.humidity);
  return THREE.MathUtils.smoothstep(Math.max(mass.age, mass.maturity * 12), 0, 8);
}

/** CPU reference field used by debug tools and density-grid validation. */
export class CloudDensityField {
  constructor(readonly mass: CloudMass) {}

  sampleDensity(worldPosition: THREE.Vector3): number {
    let density = 0;
    for (const puff of this.mass.puffs) {
      const scaleX = Math.max(1, puff.radius);
      const scaleY = Math.max(1, puff.radius * puff.flatten);
      const scaleZ = Math.max(1, puff.radius);
      const dx = (worldPosition.x - puff.position.x) / scaleX;
      const dy = (worldPosition.y - puff.position.y) / scaleY;
      const dz = (worldPosition.z - puff.position.z) / scaleZ;
      const q = dx * dx + dy * dy + dz * dz;
      if (q > 4) continue;
      density += Math.exp(-q * 2.5) * puff.density;
    }

    const height = THREE.MathUtils.clamp(
      (worldPosition.y - this.mass.condensationLevel)
        / Math.max(1, this.mass.inversionHeight - this.mass.condensationLevel),
      0,
      1,
    );
    const heightProfile = THREE.MathUtils.smoothstep(height, 0, 0.08)
      * (1 - THREE.MathUtils.smoothstep(height, 0.92, 1));
    const erosionNoise = hash3(worldPosition.x * 0.018, worldPosition.y * 0.014, worldPosition.z * 0.018);
    const thresholded = THREE.MathUtils.smoothstep(density, 0.16, 0.58);
    const erosionStrength = this.mass.puffs.length < 12 ? 0.08 : 0.16;
    const eroded = thresholded - erosionNoise * erosionStrength;
    return THREE.MathUtils.clamp(eroded * heightProfile * lifecycleOpacity(this.mass), 0, 1);
  }
}
