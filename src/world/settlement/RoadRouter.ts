import type { BiomeId } from "../BiomeGenerator";
import type { SettlementPlan } from "../RegionPlanner";
import type { RoadPath } from "./RoadTypes";
import { RoadPathPlanner } from "./RoadPathPlanner";
import type { RoadPathSample } from "./RoadPathPlanner";
import type { RoadWaterContext } from "./RoadTypes";

export class RoadRouter {
  constructor(private readonly planner: RoadPathPlanner) {}

  route(
    a: SettlementPlan,
    b: SettlementPlan,
    biome: BiomeId,
    getHeight: (x: number, z: number) => number,
    getWater: (x: number, z: number) => RoadWaterContext,
    importance: number,
  ): RoadPath {
    return this.planner.pathBetween(a, b, biome, getHeight, getWater, importance);
  }

  sample(x: number, z: number, path: RoadPath): RoadPathSample {
    return this.planner.samplePath(x, z, path);
  }
}
