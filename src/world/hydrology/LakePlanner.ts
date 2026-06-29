import { SEA_LEVEL } from "../../utils/Constants";
import { clamp, smoothstep } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";
import { WatershedSample } from "./WatershedMap";

export interface LakeSample {
  lake: number;
  waterLevel: number;
}

export class LakePlanner {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, height: number, watershed: WatershedSample): LakeSample {
    const basin = (this.noise.fbm2D(x * 0.00122 + 1900, z * 0.00122 - 440, 4) + 1) * 0.5;
    const localBowl = (this.noise.fbm2D(x * 0.003 + 260, z * 0.003 - 180, 2) + 1) * 0.5;
    const basinStrength = smoothstep(clamp((basin - 0.55) / 0.26, 0, 1));
    const lake = height <= SEA_LEVEL + 7
      ? clamp(basinStrength * (0.35 + watershed.lowland * 0.7) * (0.75 + localBowl * 0.35), 0, 1)
      : height <= SEA_LEVEL + 20 && watershed.valley > 0.78
        ? clamp(basinStrength * 0.45, 0, 0.72)
        : 0;
    const waterLevel = SEA_LEVEL + Math.round(watershed.catchment * 2 + lake * 2);
    return { lake, waterLevel };
  }
}
