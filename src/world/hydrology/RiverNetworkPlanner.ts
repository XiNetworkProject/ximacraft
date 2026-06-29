import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";
import { WatershedSample } from "./WatershedMap";

export interface RiverNetworkSample {
  river: number;
  stream: number;
  bank: number;
  waterfallRisk: number;
}

export class RiverNetworkPlanner {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, height: number, watershed: WatershedSample): RiverNetworkSample {
    const broadMeander = this.noise.fbm2D(x * 0.00115 + 700, z * 0.00115 - 270, 4) * 92;
    const secondaryMeander = this.noise.fbm2D(x * 0.0019 - 310, z * 0.0019 + 190, 3) * 38;
    const riverAxisA = Math.abs(this.noise.noise2D((x + broadMeander) * 0.00105, (z - broadMeander * 0.35) * 0.00105));
    const riverAxisB = Math.abs(this.noise.noise2D((x * 0.82 - z * 0.31 + secondaryMeander) * 0.00125, (z * 0.72 + x * 0.25) * 0.00125));
    const axis = Math.min(riverAxisA, riverAxisB * 1.12);
    const width = 0.014 + watershed.catchment * 0.066 + watershed.lowland * 0.03;
    const river = 1 - smoothRange(width * 0.24, width, axis);

    const feederMeander = this.noise.fbm2D(x * 0.0035 - 120, z * 0.0035 + 920, 3) * 19;
    const feederAxis = Math.abs(this.noise.noise2D((x + feederMeander) * 0.0041, (z - feederMeander) * 0.0041));
    const sourceBoost = clamp((height - 68) / 42, 0, 1) * clamp(watershed.catchment + 0.15, 0, 1);
    const stream = (1 - smoothRange(0.011, 0.041 + sourceBoost * 0.018, feederAxis)) * (0.35 + sourceBoost * 0.65);

    const localSlope = Math.abs(this.noise.fbm2D(x * 0.009 + 33, z * 0.009 - 71, 2));
    const waterfallRisk = river > 0.6 && height > 78 ? clamp((localSlope - 0.52) / 0.3, 0, 1) : 0;
    return {
      river: clamp(river * (0.52 + watershed.flowBias * 0.58), 0, 1),
      stream: clamp(stream, 0, 1),
      bank: clamp(Math.max(river, stream * 0.56), 0, 1),
      waterfallRisk,
    };
  }
}

function smoothRange(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
