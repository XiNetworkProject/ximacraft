import { BlockId } from "../world/BlockTypes";

export type InventorySlot = {
  blockId: BlockId;
  count: number;
};

export const MAX_STACK_SIZE = 64;

export class PlayerInventory {
  readonly slots: Array<InventorySlot | null> = Array.from({ length: 36 }, () => null);
  selectedHotbarIndex = 0;

  constructor() {
    const defaults = [
      BlockId.STONE,
      BlockId.GRASS,
      BlockId.DIRT,
      BlockId.SAND,
      BlockId.OAK_LOG,
      BlockId.OAK_PLANKS,
      BlockId.OAK_LEAVES,
      BlockId.COBBLESTONE,
      BlockId.GLOWSTONE,
      BlockId.ANDESITE,
      BlockId.DIORITE,
      BlockId.GRANITE,
      BlockId.BRICKS,
      BlockId.GLASS,
      BlockId.SEA_LANTERN,
      BlockId.COPPER_BLOCK,
      BlockId.GOLD_BLOCK,
      BlockId.IRON_BLOCK,
      BlockId.BIRCH_LOG,
      BlockId.BIRCH_PLANKS,
      BlockId.SPRUCE_PLANKS,
      BlockId.DARK_OAK_PLANKS,
      BlockId.ACACIA_PLANKS,
      BlockId.JUNGLE_PLANKS,
      BlockId.PRISMARINE_BRICKS,
      BlockId.QUARTZ_BRICKS,
      BlockId.QUARTZ_PILLAR,
      BlockId.BLUE_ICE,
      BlockId.PACKED_ICE,
      BlockId.OBSIDIAN,
      BlockId.CRYING_OBSIDIAN,
      BlockId.NETHER_BRICKS,
      BlockId.END_STONE_BRICKS,
      BlockId.MOSSY_COBBLESTONE,
      BlockId.MOSSY_STONE_BRICKS,
      BlockId.TUFF_BRICKS,
    ];
    defaults.forEach((blockId, index) => {
      this.slots[index] = { blockId, count: 64 };
    });
  }

  get selectedSlot(): InventorySlot | null {
    return this.slots[this.selectedHotbarIndex];
  }

  select(index: number): void {
    this.selectedHotbarIndex = ((index % 9) + 9) % 9;
  }

  scroll(delta: number): void {
    this.select(this.selectedHotbarIndex + (delta > 0 ? 1 : -1));
  }

  setSelectedBlock(blockId: BlockId, count = 64): void {
    this.slots[this.selectedHotbarIndex] = { blockId, count };
  }

  setSlot(index: number, blockId: BlockId, count = 64): void {
    if (index < 0 || index >= this.slots.length) return;
    this.slots[index] = { blockId, count: Math.max(1, Math.min(MAX_STACK_SIZE, count)) };
  }

  add(blockId: BlockId, count = 1): boolean {
    const remaining = this.insertStack({ blockId, count });
    return remaining === null;
  }

  insertStack(stack: InventorySlot, start = 0, end = this.slots.length): InventorySlot | null {
    const carried = { blockId: stack.blockId, count: Math.max(0, stack.count) };
    const from = Math.max(0, start);
    const to = Math.min(this.slots.length, end);
    for (let i = from; i < to && carried.count > 0; i += 1) {
      const slot = this.slots[i];
      if (slot && slot.blockId === carried.blockId && slot.count < MAX_STACK_SIZE) {
        const accepted = Math.min(MAX_STACK_SIZE - slot.count, carried.count);
        slot.count += accepted;
        carried.count -= accepted;
      }
    }

    for (let i = from; i < to && carried.count > 0; i += 1) {
      if (!this.slots[i]) {
        const accepted = Math.min(MAX_STACK_SIZE, carried.count);
        this.slots[i] = { blockId: carried.blockId, count: accepted };
        carried.count -= accepted;
      }
    }

    return carried.count > 0 ? carried : null;
  }

  moveSlotToRange(index: number, start: number, end: number): boolean {
    const slot = this.slots[index];
    if (!slot) return false;
    this.slots[index] = null;
    const remaining = this.insertStack(slot, start, end);
    this.slots[index] = remaining;
    return !remaining || remaining.count !== slot.count;
  }

  count(blockId: BlockId): number {
    return this.slots.reduce((sum, slot) => sum + (slot?.blockId === blockId ? slot.count : 0), 0);
  }

  consumeSelected(isCreative: boolean): BlockId | null {
    const slot = this.selectedSlot;
    if (!slot || slot.count <= 0) {
      return null;
    }
    const blockId = slot.blockId;
    if (!isCreative) {
      slot.count -= 1;
      if (slot.count <= 0) {
        this.slots[this.selectedHotbarIndex] = null;
      }
    }
    return blockId;
  }

  remove(blockId: BlockId, count: number): boolean {
    let available = this.count(blockId);
    if (available < count) return false;

    for (let i = 0; i < this.slots.length && count > 0; i += 1) {
      const slot = this.slots[i];
      if (!slot || slot.blockId !== blockId) continue;
      const take = Math.min(slot.count, count);
      slot.count -= take;
      count -= take;
      if (slot.count <= 0) this.slots[i] = null;
    }
    return true;
  }

  serialize(): Array<InventorySlot | null> {
    return this.slots.map((slot) => (slot ? { ...slot } : null));
  }

  restore(slots: Array<InventorySlot | null>, selectedHotbarIndex: number): void {
    for (let i = 0; i < this.slots.length; i += 1) {
      this.slots[i] = slots[i] ? { ...slots[i]!, count: Math.max(1, Math.min(MAX_STACK_SIZE, slots[i]!.count)) } : null;
    }
    this.select(selectedHotbarIndex);
  }
}
