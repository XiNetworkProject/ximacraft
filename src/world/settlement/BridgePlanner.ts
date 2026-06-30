import { Noise } from "../../utils/Noise";
import { BlockId } from "../BlockTypes";
import type { RegionColumnBlock, RegionColumnPlan } from "../RegionPlanner";
import type { RoadSample, RoadWaterContext } from "./RoadTypes";

export class BridgePlanner {
  constructor(private readonly noise: Noise) {}

  columnAt(x: number, z: number, road: RoadSample, water: RoadWaterContext): RegionColumnPlan {
    const alongX = Math.abs(road.dirX) >= Math.abs(road.dirZ);
    const along = alongX ? x : z;
    const perp = alongX ? z : x;
    const deckWidth = this.deckWidth(road, water);
    const side = Math.abs(modCentered(perp, deckWidth + 2));
    const edge = side > deckWidth * 0.43;
    const support = Math.abs(modCentered(along, water.width > 12 ? 9 : 6)) < 0.65;
    const ruined = water.width > 9 && this.noise.random2D(Math.floor(x / 48) * 61, Math.floor(z / 48) * 61) > 0.982;
    const blocks: RegionColumnBlock[] = [];

    if (water.width > 13 || water.category === "great_river") {
      blocks.push({ dy: -2, block: BlockId.STONE_BRICK_WALL }, { dy: -1, block: support ? BlockId.STONE_BRICK_WALL : BlockId.COBBLESTONE });
      blocks.push({ dy: 0, block: BlockId.COBBLESTONE });
      blocks.push({ dy: 1, block: ruined && Math.abs(modCentered(along, 11)) < 1.2 ? BlockId.AIR : BlockId.COBBLESTONE_SLAB });
      if (edge && !ruined) blocks.push({ dy: 2, block: BlockId.STONE_BRICK_WALL });
      if (support && edge) blocks.push({ dy: 3, block: BlockId.LANTERN_POST });
      return { surface: BlockId.COBBLESTONE_PATH, blocks, blocksDecoration: true };
    }

    const beam = alongX ? BlockId.WEATHERED_BEAM_X : BlockId.WEATHERED_BEAM_Z;
    blocks.push({ dy: support ? -2 : -1, block: BlockId.WEATHERED_BEAM });
    blocks.push({ dy: 0, block: beam });
    blocks.push({ dy: 1, block: ruined && Math.abs(modCentered(along, 7)) < 1.1 ? BlockId.AIR : BlockId.OAK_SLAB });
    if (edge && !ruined) blocks.push({ dy: 2, block: BlockId.OAK_FENCE });
    if (support && edge && !ruined) blocks.push({ dy: 3, block: BlockId.HANGING_LANTERN });
    return { surface: BlockId.GRAVEL, blocks, blocksDecoration: true };
  }

  private deckWidth(road: RoadSample, water: RoadWaterContext): number {
    return Math.max(5, Math.min(11, road.width + (water.width > 8 ? 2 : 0)));
  }
}

function modCentered(value: number, period: number): number {
  return ((value + period * 0.5) % period + period) % period - period * 0.5;
}
