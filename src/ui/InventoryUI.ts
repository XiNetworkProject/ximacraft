import { CraftingGrid, CraftingGridMatch, CraftingSystem } from "../items/CraftingSystem";
import { FurnaceState, SmeltingSystem } from "../items/SmeltingSystem";
import { InventorySlot, MAX_STACK_SIZE, PlayerInventory } from "../player/PlayerInventory";
import { TextureManager } from "../assets/TextureManager";
import { BlockRegistry } from "../world/BlockRegistry";
import { BlockDefinition, BlockId } from "../world/BlockTypes";

type InventoryTab = "inventory" | "blocks" | "craft" | "furnace";
type InventoryOpenMode = "inventory" | "craftingTable" | "furnace";

type SlotRef = {
  get: () => InventorySlot | null;
  set: (slot: InventorySlot | null) => void;
  accepts?: (slot: InventorySlot) => boolean;
};

export class InventoryUI {
  readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly blockGrid: HTMLDivElement;
  private readonly craftGridElement: HTMLDivElement;
  private readonly craftResult: HTMLButtonElement;
  private readonly recipeBook: HTMLDivElement;
  private readonly furnacePanel: HTMLDivElement;
  private readonly furnaceInput: HTMLDivElement;
  private readonly furnaceFuel: HTMLDivElement;
  private readonly furnaceOutput: HTMLDivElement;
  private readonly furnaceProgress: HTMLDivElement;
  private readonly carryElement: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private open = false;
  private activeTab: InventoryTab = "inventory";
  private query = "";
  private craftingTableMode = false;
  private readonly craftGrid: CraftingGrid = Array.from({ length: 9 }, () => null);
  private readonly furnaceState: FurnaceState;
  private carried: InventorySlot | null = null;
  private lastPointerX = window.innerWidth / 2;
  private lastPointerY = window.innerHeight / 2;

  constructor(
    overlay: HTMLElement,
    private readonly inventory: PlayerInventory,
    private readonly blocks: BlockRegistry,
    private readonly textures: TextureManager,
    private readonly crafting: CraftingSystem,
    private readonly smelting: SmeltingSystem,
    private readonly onChanged: () => void,
  ) {
    this.furnaceState = this.smelting.createState();
    this.root = document.createElement("div");
    this.root.className = "inventory-panel hidden";
    this.root.innerHTML = `
      <header class="inventory-header">
        <div>
          <h2>Inventaire</h2>
          <p class="inventory-subtitle">Stacks, craft, four et blocs creatifs</p>
        </div>
        <input class="inventory-search" type="search" placeholder="Rechercher bloc ou recette" />
      </header>
      <nav class="inventory-tabs" aria-label="Sections inventaire"></nav>
      <div class="inventory-layout">
        <section class="inventory-section player-section">
          <div class="section-title">Sac</div>
          <div class="inventory-grid" aria-label="Slots inventaire"></div>
          <div class="inventory-hint">Clic gauche: prendre/poser. Clic droit: demi-stack ou 1 objet. Shift-clic: transfert rapide.</div>
        </section>
        <section class="inventory-section context-section">
          <div class="creative-block-grid" aria-label="Palette blocs"></div>
          <div class="craft-workbench">
            <div class="section-title">Craft</div>
            <div class="craft-board">
              <div class="crafting-grid"></div>
              <div class="craft-arrow">-></div>
              <button class="craft-result inventory-slot" type="button"></button>
            </div>
            <div class="recipe-book"></div>
          </div>
          <div class="furnace-workbench">
            <div class="section-title">Four</div>
            <div class="furnace-board">
              <div class="furnace-stack">
                <span>Entree</span>
                <div class="furnace-input"></div>
              </div>
              <div class="furnace-core">
                <div class="furnace-flame"></div>
                <div class="furnace-progress"><span></span></div>
              </div>
              <div class="furnace-stack">
                <span>Combustible</span>
                <div class="furnace-fuel"></div>
              </div>
              <div class="furnace-arrow">-></div>
              <div class="furnace-stack">
                <span>Sortie</span>
                <div class="furnace-output"></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;
    this.search = this.root.querySelector(".inventory-search")!;
    const tabs = this.root.querySelector(".inventory-tabs")!;
    tabs.append(
      this.tabButton("Sac", "inventory"),
      this.tabButton("Blocs", "blocks"),
      this.tabButton("Craft", "craft"),
      this.tabButton("Four", "furnace"),
    );
    this.grid = this.root.querySelector(".inventory-grid")!;
    this.blockGrid = this.root.querySelector(".creative-block-grid")!;
    this.craftGridElement = this.root.querySelector(".crafting-grid")!;
    this.craftResult = this.root.querySelector(".craft-result")!;
    this.recipeBook = this.root.querySelector(".recipe-book")!;
    this.furnacePanel = this.root.querySelector(".furnace-workbench")!;
    this.furnaceInput = this.root.querySelector(".furnace-input")!;
    this.furnaceFuel = this.root.querySelector(".furnace-fuel")!;
    this.furnaceOutput = this.root.querySelector(".furnace-output")!;
    this.furnaceProgress = this.root.querySelector(".furnace-progress span")!;
    this.carryElement = document.createElement("div");
    this.carryElement.className = "inventory-carry hidden";
    overlay.append(this.root, this.carryElement);
    this.search.addEventListener("input", () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.root.addEventListener("pointermove", (event) => {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.positionCarry();
    });
    this.root.addEventListener("contextmenu", (event) => event.preventDefault());
    this.render();
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open ? this.close() : this.show("inventory");
  }

  show(mode: InventoryOpenMode = "inventory"): void {
    this.open = true;
    this.craftingTableMode = mode === "craftingTable";
    this.activeTab = mode === "furnace" ? "furnace" : mode === "craftingTable" ? "craft" : "inventory";
    this.root.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
  }

  showForBlock(blockId: BlockId): void {
    if (blockId === BlockId.CRAFTING_TABLE) {
      this.show("craftingTable");
    } else if (blockId === BlockId.FURNACE || blockId === BlockId.FURNACE_ON) {
      this.show("furnace");
    } else {
      this.show("inventory");
    }
  }

  close(): void {
    this.returnCraftingGrid();
    this.returnCarried();
    this.open = false;
    this.root.classList.add("hidden");
    this.carryElement.classList.add("hidden");
    this.onChanged();
  }

  update(delta: number): void {
    const changed = this.smelting.updateFurnace(this.furnaceState, delta);
    if (changed && this.open) {
      this.renderFurnace();
      this.onChanged();
    }
  }

  render(): void {
    this.root.dataset.tab = this.activeTab;
    this.root.dataset.craftSize = `${this.craftSize}`;
    this.renderInventorySlots();
    this.renderCreativeBlocks();
    this.renderCrafting();
    this.renderFurnace();
    this.renderCarried();
  }

  private get craftSize(): 2 | 3 {
    return this.craftingTableMode ? 3 : 2;
  }

  private renderInventorySlots(): void {
    this.grid.textContent = "";
    for (let i = 0; i < this.inventory.slots.length; i += 1) {
      const ref: SlotRef = {
        get: () => this.inventory.slots[i],
        set: (slot) => {
          this.inventory.slots[i] = slot;
        },
      };
      const cell = this.createSlotButton(ref, {
        title: i < 9 ? `Hotbar ${i + 1}` : `Slot ${i + 1}`,
        selected: i === this.inventory.selectedHotbarIndex,
        onShiftClick: () => this.quickMoveInventorySlot(i),
      });
      cell.dataset.index = `${i}`;
      if (i < 9) cell.dataset.hotbar = "true";
      this.grid.appendChild(cell);
    }
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
        this.inventory.setSelectedBlock(block.id, MAX_STACK_SIZE);
        this.render();
        this.onChanged();
      });
      this.blockGrid.appendChild(button);
    }
  }

  private renderCrafting(): void {
    this.craftGridElement.textContent = "";
    this.craftGridElement.dataset.size = `${this.craftSize}`;
    const slotCount = this.craftSize * this.craftSize;
    for (let i = 0; i < slotCount; i += 1) {
      const ref: SlotRef = {
        get: () => this.craftGrid[i],
        set: (slot) => {
          this.craftGrid[i] = slot;
        },
      };
      this.craftGridElement.appendChild(this.createSlotButton(ref, { title: `Craft ${i + 1}`, onShiftClick: () => this.quickMoveSlotRef(ref) }));
    }

    const match = this.currentCraftMatch();
    this.paintSlot(this.craftResult, match?.output ?? null, match ? this.blocks.get(match.output.blockId).displayName : "Resultat");
    this.craftResult.disabled = !match;
    this.craftResult.onclick = (event) => {
      event.preventDefault();
      this.takeCraftResult(Boolean((event as MouseEvent).shiftKey));
    };
    this.renderRecipeBook();
  }

  private renderRecipeBook(): void {
    this.recipeBook.textContent = "";
    const label = document.createElement("div");
    label.className = "recipe-book-title";
    label.textContent = "Livre de recettes";
    this.recipeBook.appendChild(label);
    for (const recipe of this.crafting.recipes) {
      const output = this.blocks.get(recipe.output.blockId);
      const text = `${output.displayName} ${recipe.label}`.toLowerCase();
      if (this.query && !text.includes(this.query)) continue;
      const fits = this.crafting.recipeFits(recipe, this.craftSize, this.craftSize, this.craftingTableMode);
      const canCraft = fits && this.crafting.canCraft(recipe, this.inventory);
      const button = document.createElement("button");
      button.className = "recipe-book-entry";
      button.type = "button";
      button.disabled = !canCraft;
      button.title = fits ? recipe.label : "Necessite une table de craft";
      button.append(this.createIcon(recipe.output.blockId, output.color));
      const textNode = document.createElement("span");
      textNode.innerHTML = `<strong>${output.displayName} x${recipe.output.count}</strong><small>${recipe.label}</small>`;
      button.appendChild(textNode);
      button.addEventListener("click", () => {
        this.placeRecipe(recipe.id);
      });
      this.recipeBook.appendChild(button);
    }
  }

  private renderFurnace(): void {
    this.furnaceInput.textContent = "";
    this.furnaceFuel.textContent = "";
    this.furnaceOutput.textContent = "";
    const inputRef: SlotRef = {
      get: () => this.furnaceState.input,
      set: (slot) => {
        this.furnaceState.input = slot;
      },
    };
    const fuelRef: SlotRef = {
      get: () => this.furnaceState.fuel,
      set: (slot) => {
        this.furnaceState.fuel = slot;
      },
    };
    const outputRef: SlotRef = {
      get: () => this.furnaceState.output,
      set: (slot) => {
        this.furnaceState.output = slot;
      },
      accepts: () => false,
    };
    this.furnaceInput.appendChild(this.createSlotButton(inputRef, { title: "Entree four", onShiftClick: () => this.quickMoveSlotRef(inputRef) }));
    this.furnaceFuel.appendChild(this.createSlotButton(fuelRef, { title: "Combustible", onShiftClick: () => this.quickMoveSlotRef(fuelRef) }));
    this.furnaceOutput.appendChild(this.createSlotButton(outputRef, { title: "Sortie four", onShiftClick: () => this.quickMoveSlotRef(outputRef) }));
    const ratio = this.furnaceState.totalSeconds > 0 ? this.furnaceState.progressSeconds / this.furnaceState.totalSeconds : 0;
    this.furnaceProgress.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    this.furnacePanel.classList.toggle("burning", Boolean(this.furnaceState.activeRecipeId));
  }

  private createSlotButton(ref: SlotRef, options: { title: string; selected?: boolean; onShiftClick?: () => void }): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = `inventory-slot${options.selected ? " selected" : ""}`;
    button.type = "button";
    this.paintSlot(button, ref.get(), options.title);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (event.shiftKey && options.onShiftClick) {
        options.onShiftClick();
        this.render();
        this.onChanged();
        return;
      }
      this.handleSlotClick(ref, event.button === 2 ? "right" : "left");
    });
    return button;
  }

  private paintSlot(button: HTMLElement, slot: InventorySlot | null, emptyTitle: string): void {
    button.textContent = "";
    button.classList.toggle("has-item", Boolean(slot));
    if (!slot) {
      button.title = emptyTitle;
      return;
    }
    const block = this.blocks.get(slot.blockId);
    button.title = `${block.displayName} x${slot.count}`;
    const icon = this.createIcon(slot.blockId, block.color);
    const count = document.createElement("span");
    count.className = "slot-count";
    count.textContent = `${slot.count}`;
    button.append(icon, count);
  }

  private handleSlotClick(ref: SlotRef, button: "left" | "right"): void {
    const accepts = ref.accepts ?? (() => true);
    const slot = ref.get();
    if (button === "right") {
      this.handleRightClick(ref, slot, accepts);
    } else {
      this.handleLeftClick(ref, slot, accepts);
    }
    this.render();
    this.onChanged();
  }

  private handleLeftClick(ref: SlotRef, slot: InventorySlot | null, accepts: (slot: InventorySlot) => boolean): void {
    if (!this.carried) {
      ref.set(slot ? { ...slot } : null);
      this.carried = slot ? { ...slot } : null;
      if (slot) ref.set(null);
      return;
    }
    if (!accepts(this.carried)) return;
    if (!slot) {
      ref.set({ ...this.carried });
      this.carried = null;
      return;
    }
    if (slot.blockId === this.carried.blockId && slot.count < MAX_STACK_SIZE) {
      const moved = Math.min(MAX_STACK_SIZE - slot.count, this.carried.count);
      slot.count += moved;
      this.carried.count -= moved;
      ref.set({ ...slot });
      if (this.carried.count <= 0) this.carried = null;
      return;
    }
    ref.set({ ...this.carried });
    this.carried = { ...slot };
  }

  private handleRightClick(ref: SlotRef, slot: InventorySlot | null, accepts: (slot: InventorySlot) => boolean): void {
    if (!this.carried) {
      if (!slot) return;
      const taken = Math.ceil(slot.count / 2);
      this.carried = { blockId: slot.blockId, count: taken };
      const remaining = slot.count - taken;
      ref.set(remaining > 0 ? { blockId: slot.blockId, count: remaining } : null);
      return;
    }
    if (!accepts(this.carried)) return;
    if (!slot) {
      ref.set({ blockId: this.carried.blockId, count: 1 });
      this.carried.count -= 1;
      if (this.carried.count <= 0) this.carried = null;
      return;
    }
    if (slot.blockId === this.carried.blockId && slot.count < MAX_STACK_SIZE) {
      slot.count += 1;
      this.carried.count -= 1;
      ref.set({ ...slot });
      if (this.carried.count <= 0) this.carried = null;
    }
  }

  private quickMoveInventorySlot(index: number): void {
    if (index < 9) {
      this.inventory.moveSlotToRange(index, 9, this.inventory.slots.length);
    } else {
      this.inventory.moveSlotToRange(index, 0, 9);
    }
  }

  private quickMoveSlotRef(ref: SlotRef): void {
    const slot = ref.get();
    if (!slot) return;
    ref.set(this.inventory.insertStack(slot));
  }

  private currentCraftMatch(): CraftingGridMatch | null {
    const size = this.craftSize;
    return this.crafting.matchGrid(this.craftGrid.slice(0, size * size), size, size, this.craftingTableMode);
  }

  private takeCraftResult(shift: boolean): void {
    let crafted = false;
    do {
      const size = this.craftSize;
      const view = this.craftGrid.slice(0, size * size);
      const match = this.crafting.matchGrid(view, size, size, this.craftingTableMode);
      if (!match) break;
      if (shift) {
        const remainder = this.inventory.insertStack({ ...match.output });
        if (remainder) break;
      } else {
        if (this.carried && (this.carried.blockId !== match.output.blockId || this.carried.count + match.output.count > MAX_STACK_SIZE)) break;
        if (this.carried) {
          this.carried.count += match.output.count;
        } else {
          this.carried = { ...match.output };
        }
      }
      this.crafting.consumeMatchedGrid(view, size, size, match.recipe);
      for (let i = 0; i < view.length; i += 1) this.craftGrid[i] = view[i];
      crafted = true;
    } while (shift);
    if (crafted) {
      this.render();
      this.onChanged();
    }
  }

  private placeRecipe(recipeId: string): void {
    const recipe = this.crafting.recipes.find((entry) => entry.id === recipeId);
    if (!recipe || !recipe.pattern || !recipe.ingredients) return;
    if (!this.crafting.recipeFits(recipe, this.craftSize, this.craftSize, this.craftingTableMode)) return;
    if (!this.crafting.canCraft(recipe, this.inventory)) return;
    this.returnCraftingGrid();
    for (let y = 0; y < recipe.pattern.length; y += 1) {
      for (let x = 0; x < recipe.pattern[y].length; x += 1) {
        const symbol = recipe.pattern[y][x];
        if (symbol === " ") continue;
        const blockId = recipe.ingredients[symbol];
        if (!this.inventory.remove(blockId, 1)) continue;
        const index = y * this.craftSize + x;
        const slot = this.craftGrid[index];
        this.craftGrid[index] = slot && slot.blockId === blockId ? { blockId, count: slot.count + 1 } : { blockId, count: 1 };
      }
    }
    this.render();
    this.onChanged();
  }

  private returnCraftingGrid(): void {
    for (let i = 0; i < this.craftGrid.length; i += 1) {
      const slot = this.craftGrid[i];
      if (slot) {
        this.craftGrid[i] = this.inventory.insertStack(slot);
      }
    }
  }

  private returnCarried(): void {
    if (!this.carried) return;
    this.carried = this.inventory.insertStack(this.carried);
  }

  private tabButton(label: string, tab: InventoryTab): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "inventory-tab";
    button.type = "button";
    button.dataset.tabTarget = tab;
    button.textContent = label;
    button.addEventListener("click", () => {
      this.activeTab = tab;
      if (tab === "craft" && !this.craftingTableMode) {
        this.returnOversizedCraftSlots();
      }
      this.render();
    });
    return button;
  }

  private returnOversizedCraftSlots(): void {
    for (let i = 4; i < this.craftGrid.length; i += 1) {
      const slot = this.craftGrid[i];
      if (slot) {
        this.craftGrid[i] = this.inventory.insertStack(slot);
      }
    }
  }

  private matches(block: BlockDefinition): boolean {
    if (!this.query) return true;
    return block.displayName.toLowerCase().includes(this.query) || block.key.includes(this.query);
  }

  private renderCarried(): void {
    this.carryElement.textContent = "";
    if (!this.carried) {
      this.carryElement.classList.add("hidden");
      return;
    }
    this.carryElement.classList.remove("hidden");
    const block = this.blocks.get(this.carried.blockId);
    this.carryElement.append(this.createIcon(this.carried.blockId, block.color));
    const count = document.createElement("span");
    count.className = "slot-count";
    count.textContent = `${this.carried.count}`;
    this.carryElement.appendChild(count);
    this.positionCarry();
  }

  private positionCarry(): void {
    this.carryElement.style.transform = `translate(${this.lastPointerX + 12}px, ${this.lastPointerY + 12}px)`;
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
