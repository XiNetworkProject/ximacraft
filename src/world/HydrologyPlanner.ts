import { SEA_LEVEL } from "../utils/Constants";
import { clamp } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";
import { LakePlanner } from "./hydrology/LakePlanner";
import { RiverNetworkPlanner } from "./hydrology/RiverNetworkPlanner";
import { WatershedMap } from "./hydrology/WatershedMap";
import { WetlandPlanner } from "./hydrology/WetlandPlanner";

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
  private readonly watershed: WatershedMap;
  private readonly rivers: RiverNetworkPlanner;
  private readonly lakes: LakePlanner;
  private readonly wetlands: WetlandPlanner;

  constructor(private readonly noise: Noise) {
    this.watershed = new WatershedMap(noise);
    this.rivers = new RiverNetworkPlanner(noise);
    this.lakes = new LakePlanner(noise);
    this.wetlands = new WetlandPlanner(noise);
  }

  sample(x: number, z: number, height: number): HydrologySample {
    const watershed = this.watershed.sample(x, z, height);
    const riverNetwork = this.rivers.sample(x, z, height, watershed);
    const lakePlan = this.lakes.sample(x, z, height, watershed);
    const wetlands = this.wetlands.sample(x, z, watershed, riverNetwork, lakePlan);
    const river = riverNetwork.river;
    const stream = riverNetwork.stream;
    const lake = lakePlan.lake;
    const wetland = wetlands.wetland;
    const floodplain = wetlands.floodplain;
    const bank = clamp(Math.max(riverNetwork.bank, lake * 0.7), 0, 1);
    const waterLevel = lakePlan.waterLevel;
    const waterfallRisk = riverNetwork.waterfallRisk;
    return { river, stream, floodplain, wetland, lake, waterLevel, bank, waterfallRisk };
  }
}
