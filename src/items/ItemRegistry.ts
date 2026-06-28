import { BlockRegistry } from "../world/BlockRegistry";
import { ItemDefinition, ItemId } from "./ItemTypes";

export class ItemRegistry {
  private readonly items = new Map<ItemId, ItemDefinition>();

  constructor(blockRegistry: BlockRegistry) {
    for (const block of blockRegistry.all()) {
      if (block.key === "air") continue;
      this.items.set(`block:${block.id}`, {
        id: `block:${block.id}`,
        displayName: block.displayName,
        stackSize: 64,
        blockId: block.id,
      });
    }

    this.register({ id: "stick", displayName: "Stick", stackSize: 64 });
    this.register({ id: "wooden_pickaxe", displayName: "Wooden Pickaxe", stackSize: 1 });
    this.register({ id: "stone_pickaxe", displayName: "Stone Pickaxe", stackSize: 1 });
    this.register({ id: "iron_ingot", displayName: "Iron Ingot", stackSize: 64 });
    this.register({ id: "gold_ingot", displayName: "Gold Ingot", stackSize: 64 });
  }

  get(id: ItemId): ItemDefinition | undefined {
    return this.items.get(id);
  }

  private register(item: ItemDefinition): void {
    this.items.set(item.id, item);
  }
}
