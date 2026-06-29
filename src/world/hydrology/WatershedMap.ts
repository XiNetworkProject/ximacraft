import { SEA_LEVEL } from "../../utils/Constants";
import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";

export interface WatershedSample {
  catchment: number;
  lowland: number;
  flowBias: number;
  valley: number;
}

export class WatershedMap {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, height: number): WatershedSample {
    const catchment = clamp((this.noise.fbm2D(x * 0.00072 - 240, z * 0.00072 + 820, 5) + 1) * 0.5, 0, 1);
    const valley = clamp((this.noise.fbm2D(x * 0.00105 + 510, z * 0.00105 - 610, 4) + 1) * 0.5, 0, 1);
    const lowland = clamp((SEA_LEVEL + 12 - height) / 22, 0, 1);
    const flowBias = clamp(catchment * 0.55 + valley * 0.25 + lowland * 0.2, 0, 1);
    return { catchment, lowland, flowBias, valley };
  }
}
