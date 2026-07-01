import { InventorySlot, PlayerInventory } from "../player/PlayerInventory";
import { BlockId } from "../world/BlockTypes";

export type CraftingRecipe = {
  id: string;
  label: string;
  inputs: Array<{ blockId: BlockId; count: number }>;
  output: { blockId: BlockId; count: number };
  pattern?: string[];
  ingredients?: Record<string, BlockId>;
  requiresTable?: boolean;
  category?: "basics" | "building" | "utility";
};

export type CraftingGrid = Array<InventorySlot | null>;

export type CraftingGridMatch = {
  recipe: CraftingRecipe;
  output: InventorySlot;
};

export class CraftingSystem {
  readonly recipes: CraftingRecipe[] = [
    {
      id: "oak_log_to_planks",
      label: "1 Oak Log -> 4 Oak Planks",
      inputs: [{ blockId: BlockId.OAK_LOG, count: 1 }],
      output: { blockId: BlockId.OAK_PLANKS, count: 4 },
      pattern: ["L"],
      ingredients: { L: BlockId.OAK_LOG },
      category: "basics",
    },
    {
      id: "planks_to_table",
      label: "4 Oak Planks -> Crafting Table",
      inputs: [{ blockId: BlockId.OAK_PLANKS, count: 4 }],
      output: { blockId: BlockId.CRAFTING_TABLE, count: 1 },
      pattern: ["PP", "PP"],
      ingredients: { P: BlockId.OAK_PLANKS },
      category: "utility",
    },
    {
      id: "cobble_to_furnace",
      label: "8 Cobblestone -> Furnace",
      inputs: [{ blockId: BlockId.COBBLESTONE, count: 8 }],
      output: { blockId: BlockId.FURNACE, count: 1 },
      pattern: ["CCC", "C C", "CCC"],
      ingredients: { C: BlockId.COBBLESTONE },
      requiresTable: true,
      category: "utility",
    },
    {
      id: "glowstone_to_lit_furnace",
      label: "Furnace + Glowstone -> Lit Furnace",
      inputs: [
        { blockId: BlockId.FURNACE, count: 1 },
        { blockId: BlockId.GLOWSTONE, count: 1 },
      ],
      output: { blockId: BlockId.FURNACE_ON, count: 1 },
      pattern: ["G", "F"],
      ingredients: { G: BlockId.GLOWSTONE, F: BlockId.FURNACE },
      category: "utility",
    },
  ];

  craft(recipeId: string, inventory: PlayerInventory): boolean {
    const recipe = this.recipes.find((entry) => entry.id === recipeId);
    if (!recipe) return false;
    if (!this.canCraft(recipe, inventory)) return false;
    for (const input of recipe.inputs) {
      inventory.remove(input.blockId, input.count);
    }
    return inventory.add(recipe.output.blockId, recipe.output.count);
  }

  canCraft(recipe: CraftingRecipe, inventory: PlayerInventory): boolean {
    return recipe.inputs.every((input) => inventory.count(input.blockId) >= input.count);
  }

  matchGrid(grid: CraftingGrid, width: number, height: number, allowTable = false): CraftingGridMatch | null {
    for (const recipe of this.recipes) {
      if (recipe.requiresTable && !allowTable) continue;
      if (!recipe.pattern || !recipe.ingredients) continue;
      if (this.patternMatches(recipe, grid, width, height)) {
        return { recipe, output: { ...recipe.output } };
      }
    }
    return null;
  }

  consumeMatchedGrid(grid: CraftingGrid, width: number, height: number, recipe: CraftingRecipe): boolean {
    if (!recipe.pattern || !recipe.ingredients) return false;
    const offset = this.matchOffset(recipe, grid, width, height);
    if (!offset) return false;
    for (let y = 0; y < recipe.pattern.length; y += 1) {
      for (let x = 0; x < recipe.pattern[y].length; x += 1) {
        const symbol = recipe.pattern[y][x];
        if (symbol === " ") continue;
        const index = (offset.y + y) * width + offset.x + x;
        const slot = grid[index];
        if (!slot || slot.blockId !== recipe.ingredients[symbol] || slot.count <= 0) return false;
      }
    }
    for (let y = 0; y < recipe.pattern.length; y += 1) {
      for (let x = 0; x < recipe.pattern[y].length; x += 1) {
        const symbol = recipe.pattern[y][x];
        if (symbol === " ") continue;
        const index = (offset.y + y) * width + offset.x + x;
        const slot = grid[index];
        if (!slot) continue;
        slot.count -= 1;
        if (slot.count <= 0) grid[index] = null;
      }
    }
    return true;
  }

  recipeFits(recipe: CraftingRecipe, width: number, height: number, allowTable: boolean): boolean {
    if (recipe.requiresTable && !allowTable) return false;
    const pattern = recipe.pattern;
    if (!pattern) return false;
    return pattern.length <= height && Math.max(...pattern.map((row) => row.length)) <= width;
  }

  private patternMatches(recipe: CraftingRecipe, grid: CraftingGrid, width: number, height: number): boolean {
    return this.matchOffset(recipe, grid, width, height) !== null;
  }

  private matchOffset(recipe: CraftingRecipe, grid: CraftingGrid, width: number, height: number): { x: number; y: number } | null {
    const pattern = recipe.pattern;
    const ingredients = recipe.ingredients;
    if (!pattern || !ingredients) return null;
    const recipeHeight = pattern.length;
    const recipeWidth = Math.max(...pattern.map((row) => row.length));
    if (recipeWidth > width || recipeHeight > height) return null;

    for (let oy = 0; oy <= height - recipeHeight; oy += 1) {
      for (let ox = 0; ox <= width - recipeWidth; ox += 1) {
        let ok = true;
        for (let y = 0; y < height && ok; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const slot = grid[y * width + x];
            const inside = x >= ox && y >= oy && x < ox + recipeWidth && y < oy + recipeHeight;
            const symbol = inside ? pattern[y - oy][x - ox] ?? " " : " ";
            const expected = symbol === " " ? null : ingredients[symbol];
            if (expected === null) {
              if (slot) {
                ok = false;
                break;
              }
            } else if (!slot || slot.blockId !== expected) {
              ok = false;
              break;
            }
          }
        }
        if (ok) return { x: ox, y: oy };
      }
    }
    return null;
  }
}
