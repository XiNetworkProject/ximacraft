import { BlockRegistry } from "./BlockRegistry";
import { BlockId } from "./BlockTypes";

export class LightingEngine {
  constructor(private readonly blocks: BlockRegistry) {}

  getEmission(blockId: BlockId): number {
    return this.blocks.get(blockId).lightLevel ?? 0;
  }
}
