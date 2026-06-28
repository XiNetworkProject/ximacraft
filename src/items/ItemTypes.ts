import { BlockId } from "../world/BlockTypes";

export type ItemId =
  | "stick"
  | "wooden_pickaxe"
  | "stone_pickaxe"
  | "iron_ingot"
  | "gold_ingot"
  | `block:${BlockId}`;

export type ItemDefinition = {
  id: ItemId;
  displayName: string;
  stackSize: number;
  blockId?: BlockId;
};
