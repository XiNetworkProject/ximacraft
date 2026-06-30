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
  width: number;
  flowX: number;
  flowZ: number;
  current: number;
  source: number;
  category: "dry" | "source" | "stream" | "river" | "great_river" | "lake" | "wetland";
};

export class HydrologyPlanner {
  private readonly watershed: WatershedMap;
  readonly rivers: RiverNetworkPlanner;
  private readonly lakes: LakePlanner;
  private readonly wetlands: WetlandPlanner;

  constructor(
    private readonly noise: Noise,
    /** Champ d'altitude de base réel (RegionalHeightField) pour l'écoulement. */
    heightProvider: (x: number, z: number) => number,
  ) {
    this.watershed = new WatershedMap(noise);
    this.rivers = new RiverNetworkPlanner(noise, heightProvider);
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
    const channelWaterLevel = river > 0.38 || stream > 0.68 ? height + (river > 0.72 ? 2 : 1) : 0;
    const waterLevel = Math.max(lakePlan.waterLevel, channelWaterLevel);
    const waterfallRisk = riverNetwork.waterfallRisk;
    const category =
      lake > 0.55 ? "lake" :
        wetland > 0.55 ? "wetland" :
          river > 0.68 && riverNetwork.width > 10 ? "great_river" :
            river > 0.46 ? "river" :
              stream > 0.5 ? "stream" :
                riverNetwork.source > 0.42 ? "source" :
                  "dry";
    return {
      river,
      stream,
      floodplain,
      wetland,
      lake,
      waterLevel,
      bank,
      waterfallRisk,
      width: riverNetwork.width,
      flowX: riverNetwork.flowX,
      flowZ: riverNetwork.flowZ,
      current: riverNetwork.current,
      source: riverNetwork.source,
      category,
    };
  }
}
