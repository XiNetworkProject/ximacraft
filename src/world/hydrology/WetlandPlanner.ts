import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";
import { LakeSample } from "./LakePlanner";
import { RiverNetworkSample } from "./RiverNetworkPlanner";
import { WatershedSample } from "./WatershedMap";

export interface WetlandSample {
  floodplain: number;
  wetland: number;
}

export class WetlandPlanner {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, watershed: WatershedSample, river: RiverNetworkSample, lake: LakeSample): WetlandSample {
    const wetlandNoise = clamp((this.noise.fbm2D(x * 0.0058 + 80, z * 0.0058 - 80, 3) + 1) * 0.5, 0, 1);
    const floodplain = clamp(Math.max(river.river * watershed.lowland, lake.lake * 0.72), 0, 1);
    const wetland = clamp((floodplain * 0.74 + watershed.lowland * 0.22 + river.stream * 0.18) * wetlandNoise, 0, 1);
    return { floodplain, wetland };
  }
}
