import { PlayerInventory } from "../player/PlayerInventory";
import { BlockId } from "../world/BlockTypes";

export type CraftingRecipe = {
  id: string;
  label: string;
  inputs: Array<{ blockId: BlockId; count: number }>;
  output: { blockId: BlockId; count: number };
};

export class CraftingSystem {
  readonly recipes: CraftingRecipe[] = [
    {
      id: "oak_log_to_planks",
      label: "1 Oak Log -> 4 Oak Planks",
      inputs: [{ blockId: BlockId.OAK_LOG, count: 1 }],
      output: { blockId: BlockId.OAK_PLANKS, count: 4 },
    },
    {
      id: "planks_to_table",
      label: "4 Oak Planks -> Crafting Table",
      inputs: [{ blockId: BlockId.OAK_PLANKS, count: 4 }],
      output: { blockId: BlockId.CRAFTING_TABLE, count: 1 },
    },
    {
      id: "cobble_to_furnace",
      label: "8 Cobblestone -> Furnace",
      inputs: [{ blockId: BlockId.COBBLESTONE, count: 8 }],
      output: { blockId: BlockId.FURNACE, count: 1 },
    },
    {
      id: "glowstone_to_lit_furnace",
      label: "Furnace + Glowstone -> Lit Furnace",
      inputs: [
        { blockId: BlockId.FURNACE, count: 1 },
        { blockId: BlockId.GLOWSTONE, count: 1 },
      ],
      output: { blockId: BlockId.FURNACE_ON, count: 1 },
    },
  ];

  craft(recipeId: string, inventory: PlayerInventory): boolean {
    const recipe = this.recipes.find((entry) => entry.id === recipeId);
    if (!recipe) return false;
    for (const input of recipe.inputs) {
      const available = inventory.slots.reduce((sum, slot) => sum + (slot?.blockId === input.blockId ? slot.count : 0), 0);
      if (available < input.count) return false;
    }
    for (const input of recipe.inputs) {
      inventory.remove(input.blockId, input.count);
    }
    return inventory.add(recipe.output.blockId, recipe.output.count);
  }
}
