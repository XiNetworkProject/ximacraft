import { PlayerInventory } from "../player/PlayerInventory";
import { TextureManager } from "../assets/TextureManager";
import { BlockRegistry } from "../world/BlockRegistry";

export class HotbarUI {
  readonly root: HTMLDivElement;
  private lastSignature = "";

  constructor(
    overlay: HTMLElement,
    private readonly inventory: PlayerInventory,
    private readonly blocks: BlockRegistry,
    private readonly textures: TextureManager,
  ) {
    this.root = document.createElement("div");
    this.root.className = "hotbar";
    overlay.appendChild(this.root);
    this.render(true);
  }

  render(force = false): void {
    const signature = this.signature();
    if (!force && signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;
    this.root.textContent = "";
    for (let i = 0; i < 9; i += 1) {
      const slot = this.inventory.slots[i];
      const cell = document.createElement("div");
      cell.className = `hotbar-slot${i === this.inventory.selectedHotbarIndex ? " selected" : ""}`;
      const key = document.createElement("span");
      key.className = "slot-key";
      key.textContent = `${i + 1}`;
      cell.appendChild(key);
      if (slot) {
        const block = this.blocks.get(slot.blockId);
        const icon = this.createIcon(slot.blockId, block.color);
        icon.title = block.displayName;
        cell.appendChild(icon);
        const count = document.createElement("span");
        count.className = "slot-count";
        count.textContent = `${slot.count}`;
        cell.appendChild(count);
      }
      this.root.appendChild(cell);
    }
  }

  private signature(): string {
    const atlasReady = this.textures.atlas ? "atlas" : "fallback";
    const slots = this.inventory.slots
      .slice(0, 9)
      .map((slot) => (slot ? `${slot.blockId}:${slot.count}` : "empty"))
      .join("|");
    return `${atlasReady};${this.inventory.selectedHotbarIndex};${slots}`;
  }

  private createIcon(blockId: number, fallbackColor: number): HTMLSpanElement {
    const icon = document.createElement("span");
    icon.className = "slot-texture";
    const atlas = this.textures.atlas;
    if (atlas) {
      const textureName = this.blocks.getIconTextureForBlock(blockId);
      icon.style.backgroundImage = `url("${atlas.getTileDataUrl(textureName)}")`;
    } else {
      icon.style.background = `#${fallbackColor.toString(16).padStart(6, "0")}`;
    }
    return icon;
  }
}
