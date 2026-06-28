import { CraftingSystem } from "../items/CraftingSystem";
import { SmeltingSystem } from "../items/SmeltingSystem";
import { PlayerInventory } from "../player/PlayerInventory";
import { TextureManager } from "../assets/TextureManager";
import { BlockRegistry } from "../world/BlockRegistry";
import { BlockDefinition, BlockId } from "../world/BlockTypes";

export class InventoryUI {
  readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly blockGrid: HTMLDivElement;
  private readonly craftList: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private open = false;
  private activeTab: "craft" | "blocks" = "blocks";
  private query = "";

  constructor(
    overlay: HTMLElement,
    private readonly inventory: PlayerInventory,
    private readonly blocks: BlockRegistry,
    private readonly textures: TextureManager,
    private readonly crafting: CraftingSystem,
    private readonly smelting: SmeltingSystem,
    private readonly onChanged: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "inventory-panel hidden";
    this.root.innerHTML = `
      <header class="inventory-header">
        <h2>Inventaire</h2>
        <input class="inventory-search" type="search" placeholder="Rechercher un bloc" />
      </header>
      <nav class="inventory-tabs"></nav>
    `;
    this.search = this.root.querySelector(".inventory-search")!;
    const tabs = this.root.querySelector(".inventory-tabs")!;
    tabs.append(this.tabButton("Blocs", "blocks"), this.tabButton("Craft", "craft"));
    this.grid = document.createElement("div");
    this.grid.className = "inventory-grid";
    this.blockGrid = document.createElement("div");
    this.blockGrid.className = "creative-block-grid";
    this.craftList = document.createElement("div");
    this.craftList.className = "craft-list";
    this.root.append(this.grid, this.blockGrid, this.craftList);
    overlay.appendChild(this.root);
    this.search.addEventListener("input", () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.render();
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open ? this.close() : this.show();
  }

  show(): void {
    this.open = true;
    this.root.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
  }

  close(): void {
    this.open = false;
    this.root.classList.add("hidden");
  }

  render(): void {
    this.root.dataset.tab = this.activeTab;
    this.grid.textContent = "";
    for (let i = 0; i < this.inventory.slots.length; i += 1) {
      const slot = this.inventory.slots[i];
      const cell = document.createElement("button");
      cell.className = `inventory-slot${i === this.inventory.selectedHotbarIndex ? " selected" : ""}`;
      cell.type = "button";
      cell.title = i < 9 ? `Hotbar ${i + 1}` : `Slot ${i + 1}`;
      cell.addEventListener("click", () => {
        if (i < 9) this.inventory.select(i);
        this.render();
        this.onChanged();
      });
      if (slot) {
        const block = this.blocks.get(slot.blockId);
        cell.title = `${block.displayName} x${slot.count}`;
        const swatch = this.createIcon(slot.blockId, block.color);
        const count = document.createElement("span");
        count.className = "slot-count";
        count.textContent = `${slot.count}`;
        cell.append(swatch, count);
      }
      this.grid.appendChild(cell);
    }

    this.renderCreativeBlocks();
    this.renderCrafting();
  }

  private renderCreativeBlocks(): void {
    this.blockGrid.textContent = "";
    const blocks = this.blocks
      .placeable()
      .filter((block) => this.matches(block))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    for (const block of blocks) {
      const button = document.createElement("button");
      button.className = "creative-block-button";
      button.type = "button";
      button.title = block.displayName;
      const icon = this.createIcon(block.id, block.color);
      const label = document.createElement("span");
      label.textContent = block.displayName;
      button.append(icon, label);
      button.addEventListener("click", () => {
        this.inventory.setSelectedBlock(block.id, 64);
        this.render();
        this.onChanged();
      });
      this.blockGrid.appendChild(button);
    }
  }

  private renderCrafting(): void {
    this.craftList.textContent = "";
    for (const recipe of this.crafting.recipes) {
      const button = document.createElement("button");
      button.className = "craft-recipe";
      button.type = "button";
      button.disabled = !this.canCraft(recipe.inputs);
      const output = this.blocks.get(recipe.output.blockId);
      const outputIcon = this.createIcon(recipe.output.blockId, output.color);
      const content = document.createElement("span");
      content.className = "craft-recipe-text";
      content.innerHTML = `<strong>${output.displayName} x${recipe.output.count}</strong><small>${recipe.label}</small>`;
      button.append(outputIcon, content);
      button.addEventListener("click", () => {
        if (this.crafting.craft(recipe.id, this.inventory)) {
          this.render();
          this.onChanged();
        }
      });
      this.craftList.appendChild(button);
    }

    const smeltButton = document.createElement("button");
    smeltButton.className = "craft-recipe";
    smeltButton.type = "button";
    smeltButton.innerHTML = "<span class=\"craft-recipe-text\"><strong>Cuisson auto</strong><small>Fondre le premier minerai avec du charbon</small></span>";
    smeltButton.addEventListener("click", () => {
      if (this.smelting.smeltFirstAvailable(this.inventory)) {
        this.render();
        this.onChanged();
      }
    });
    this.craftList.appendChild(smeltButton);
  }

  private tabButton(label: string, tab: "craft" | "blocks"): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "inventory-tab";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      this.activeTab = tab;
      this.render();
    });
    return button;
  }

  private matches(block: BlockDefinition): boolean {
    if (!this.query) return true;
    return block.displayName.toLowerCase().includes(this.query) || block.key.includes(this.query);
  }

  private canCraft(inputs: Array<{ blockId: BlockId; count: number }>): boolean {
    return inputs.every((input) => this.inventory.slots.reduce((sum, slot) => sum + (slot?.blockId === input.blockId ? slot.count : 0), 0) >= input.count);
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
