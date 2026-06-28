import { BlockId } from "./BlockTypes";

export class FluidEngine {
  isWater(blockId: BlockId): boolean {
    return blockId === BlockId.WATER;
  }
}
