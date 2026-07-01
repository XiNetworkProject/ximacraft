import { InventorySlot, MAX_STACK_SIZE, PlayerInventory } from "../player/PlayerInventory";
import { BlockId } from "../world/BlockTypes";

export type SmeltingRecipe = {
  id: string;
  input: BlockId;
  fuel: BlockId;
  output: BlockId;
  outputCount: number;
  seconds: number;
};

export type FurnaceState = {
  input: InventorySlot | null;
  fuel: InventorySlot | null;
  output: InventorySlot | null;
  progressSeconds: number;
  totalSeconds: number;
  activeRecipeId?: string;
};

export class SmeltingSystem {
  readonly recipes: SmeltingRecipe[] = [
    { id: "cobblestone_to_stone", input: BlockId.COBBLESTONE, fuel: BlockId.COAL_ORE, output: BlockId.STONE, outputCount: 1, seconds: 7 },
    { id: "sand_to_glass", input: BlockId.SAND, fuel: BlockId.COAL_ORE, output: BlockId.GLASS, outputCount: 1, seconds: 6 },
    { id: "iron_ore_to_refined", input: BlockId.IRON_ORE, fuel: BlockId.COAL_ORE, output: BlockId.WHITE_WOOL, outputCount: 1, seconds: 8 },
    { id: "gold_ore_to_refined", input: BlockId.GOLD_ORE, fuel: BlockId.COAL_ORE, output: BlockId.YELLOW_WOOL, outputCount: 1, seconds: 8 },
  ];

  createState(): FurnaceState {
    return {
      input: null,
      fuel: null,
      output: null,
      progressSeconds: 0,
      totalSeconds: 0,
    };
  }

  updateFurnace(state: FurnaceState, deltaSeconds: number): boolean {
    let changed = false;
    if (!state.activeRecipeId) {
      changed = this.tryStart(state) || changed;
    }
    if (!state.activeRecipeId) return changed;

    const recipe = this.recipes.find((entry) => entry.id === state.activeRecipeId);
    if (!recipe) {
      state.activeRecipeId = undefined;
      state.progressSeconds = 0;
      state.totalSeconds = 0;
      return true;
    }

    state.progressSeconds += Math.max(0, deltaSeconds);
    changed = true;
    if (state.progressSeconds >= state.totalSeconds) {
      this.finish(state, recipe);
      state.activeRecipeId = undefined;
      state.progressSeconds = 0;
      state.totalSeconds = 0;
      this.tryStart(state);
    }
    return changed;
  }

  previewRecipe(state: FurnaceState): SmeltingRecipe | null {
    if (state.activeRecipeId) {
      return this.recipes.find((entry) => entry.id === state.activeRecipeId) ?? null;
    }
    if (!state.input || !state.fuel) return null;
    return this.recipes.find((entry) => entry.input === state.input!.blockId && entry.fuel === state.fuel!.blockId) ?? null;
  }

  smeltFirstAvailable(inventory: PlayerInventory): boolean {
    for (const recipe of this.recipes) {
      const hasInput = inventory.remove(recipe.input, 1);
      if (!hasInput) continue;
      const hasFuel = inventory.remove(recipe.fuel, 1);
      if (!hasFuel) {
        inventory.add(recipe.input, 1);
        continue;
      }
      inventory.add(recipe.output, recipe.outputCount);
      return true;
    }
    return false;
  }

  private tryStart(state: FurnaceState): boolean {
    const recipe = this.previewRecipe(state);
    if (!recipe || !state.input || !state.fuel) return false;
    if (!this.canAcceptOutput(state, recipe)) return false;
    state.input.count -= 1;
    state.fuel.count -= 1;
    if (state.input.count <= 0) state.input = null;
    if (state.fuel.count <= 0) state.fuel = null;
    state.activeRecipeId = recipe.id;
    state.progressSeconds = 0;
    state.totalSeconds = recipe.seconds;
    return true;
  }

  private finish(state: FurnaceState, recipe: SmeltingRecipe): void {
    if (state.output && state.output.blockId === recipe.output) {
      state.output.count = Math.min(MAX_STACK_SIZE, state.output.count + recipe.outputCount);
    } else {
      state.output = { blockId: recipe.output, count: recipe.outputCount };
    }
  }

  private canAcceptOutput(state: FurnaceState, recipe: SmeltingRecipe): boolean {
    if (!state.output) return true;
    return state.output.blockId === recipe.output && state.output.count + recipe.outputCount <= MAX_STACK_SIZE;
  }
}
