import { SEA_LEVEL } from "../utils/Constants";
import { clamp, smoothstep } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";

export type HydrologySample = {
  river: number;
  stream: number;
  floodplain: number;
  wetland: number;
  lake: number;
  waterLevel: number;
  bank: number;
  waterfallRisk: number;
};

export class HydrologyPlanner {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, height: number): HydrologySample {
    const broadChannel = Math.abs(this.noise.fbm2D(x * 0.00135 + 700, z * 0.00135 - 270, 5));
    const feederChannel = Math.abs(this.noise.fbm2D(x * 0.0042 - 120, z * 0.0042 + 920, 3));
    const catchment = clamp((this.noise.fbm2D(x * 0.0009 - 240, z * 0.0009 + 820, 4) + 1) * 0.5, 0, 1);
    const lowland = clamp((SEA_LEVEL + 10 - height) / 18, 0, 1);
    const riverWidth = 0.018 + catchment * 0.055 + lowland * 0.022;
    const river = 1 - smoothRange(riverWidth * 0.28, riverWidth, broadChannel);
    const stream = 1 - smoothRange(0.012, 0.045, feederChannel);
    const lakeField = this.noise.fbm2D(x * 0.0017 + 1900, z * 0.0017 - 440, 4);
    const lake = height <= SEA_LEVEL + 5 ? smoothstep(clamp((lakeField - 0.46) / 0.28, 0, 1)) : 0;
    const floodplain = clamp(Math.max(river * lowland, lake * 0.7), 0, 1);
    const wetlandNoise = clamp((this.noise.fbm2D(x * 0.007 + 80, z * 0.007 - 80, 3) + 1) * 0.5, 0, 1);
    const wetland = clamp((floodplain * 0.7 + lowland * 0.3) * wetlandNoise, 0, 1);
    const bank = clamp(Math.max(river, stream * 0.52, lake * 0.7), 0, 1);
    const waterLevel = SEA_LEVEL + Math.round(catchment * 2);
    const localSlope = Math.abs(this.noise.fbm2D(x * 0.01 + 33, z * 0.01 - 71, 2));
    const waterfallRisk = river > 0.58 && height > SEA_LEVEL + 15 ? clamp((localSlope - 0.54) / 0.28, 0, 1) : 0;
    return { river, stream, floodplain, wetland, lake, waterLevel, bank, waterfallRisk };
  }
}

function smoothRange(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
