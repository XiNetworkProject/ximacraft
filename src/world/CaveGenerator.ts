import { Noise } from "../utils/Noise";
import { SEA_LEVEL, WORLD_HEIGHT } from "../utils/Constants";

export class CaveGenerator {
  constructor(private readonly noise: Noise) {}

  shouldCarve(x: number, y: number, z: number, surfaceHeight: number): boolean {
    if (y <= 4 || y >= WORLD_HEIGHT - 8 || y >= surfaceHeight - 3) {
      return false;
    }

    const tunnel = this.noise.fbm3D(x * 0.035, y * 0.055, z * 0.035, 3);
    const pocket = this.noise.fbm3D(x * 0.012 + 80, y * 0.02 - 12, z * 0.012 + 19, 2);
    const depthBias = y < SEA_LEVEL ? 0.05 : -0.03;
    return tunnel + pocket * 0.45 + depthBias > 0.56;
  }
}
