import { BlockId } from "../BlockTypes";
import type { RegionColumnBlock, RegionColumnPlan } from "../RegionPlanner";
import type { RoadSample, RoadWaterContext } from "./RoadTypes";

export class FordPlanner {
  canFord(road: RoadSample, water: RoadWaterContext): boolean {
    return road.strength > 0.82 && water.strength > 0.32 && water.strength < 0.66 && water.width <= 6.5 && water.current < 0.72;
  }

  columnAt(_x: number, _z: number, road: RoadSample, water: RoadWaterContext): RegionColumnPlan {
    const shallow = water.width <= 3.6 || water.strength < 0.48;
    const surface = shallow ? BlockId.GRAVEL_PATH : BlockId.COBBLESTONE_PATH;
    const blocks: RegionColumnBlock[] = road.importance > 0.58
      ? [{ dy: 1, block: shallow ? BlockId.GRAVEL : BlockId.COBBLESTONE_SLAB }]
      : [];
    return { surface, blocks, blocksDecoration: true };
  }
}
