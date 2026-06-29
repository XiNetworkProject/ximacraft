import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";

export class BiomeTransitionMap {
  constructor(private readonly noise: Noise) {}

  edgeSoftness(x: number, z: number, width: number): number {
    const wobble = (this.noise.fbm2D(x * 0.0031 + 40, z * 0.0031 - 40, 3) + 1) * 0.5;
    return clamp(width * (0.72 + wobble * 0.56), 64, 256);
  }
}
