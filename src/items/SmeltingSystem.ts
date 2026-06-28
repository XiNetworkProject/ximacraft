import { PlayerInventory } from "../player/PlayerInventory";
import { BlockId } from "../world/BlockTypes";

export type SmeltingRecipe = {
  input: BlockId;
  fuel: BlockId;
  output: BlockId;
  seconds: number;
};

export class SmeltingSystem {
  readonly recipes: SmeltingRecipe[] = [
    { input: BlockId.IRON_ORE, fuel: BlockId.COAL_ORE, output: BlockId.WHITE_WOOL, seconds: 8 },
    { input: BlockId.GOLD_ORE, fuel: BlockId.COAL_ORE, output: BlockId.YELLOW_WOOL, seconds: 8 },
  ];

  smeltFirstAvailable(inventory: PlayerInventory): boolean {
    for (const recipe of this.recipes) {
      const hasInput = inventory.remove(recipe.input, 1);
      if (!hasInput) continue;
      const hasFuel = inventory.remove(recipe.fuel, 1);
      if (!hasFuel) {
        inventory.add(recipe.input, 1);
        continue;
      }
      inventory.add(recipe.output, 1);
      return true;
    }
    return false;
  }
}
