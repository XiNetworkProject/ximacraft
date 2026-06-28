import { WorldSummary } from "../world/SaveManager";

export type MainMenuNewWorldOptions = {
  name: string;
  seed?: string;
};

export class MainMenu {
  readonly root: HTMLDivElement;
  readonly continueButton: HTMLButtonElement;
  private readonly worldList: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  private readonly qualitySelect: HTMLSelectElement;
  private readonly renderDistanceInput: HTMLInputElement;
  private selectedWorldId: string | null = null;
  private worlds: WorldSummary[] = [];

  constructor(
    overlay: HTMLElement,
    private readonly callbacks: {
      newGame: (options: MainMenuNewWorldOptions) => void;
      loadWorld: (worldId: string) => void;
      deleteWorld: (worldId: string) => void;
      save: () => void;
      openCommands: () => void;
      setQuality: (quality: "low" | "balanced" | "high") => void;
      setRenderDistance: (distance: number) => void;
    },
  ) {
    this.root = document.createElement("div");
    this.root.className = "main-menu-shell";
    this.root.innerHTML = `
      <section class="main-menu-hero">
        <div>
          <h1>XimaCraft</h1>
          <p>Survie creative locale, meteo regionale, carte radar et construction voxel.</p>
        </div>
        <div class="main-menu-actions"></div>
      </section>
      <section class="main-menu-worlds">
        <header><h2>Mondes</h2><button class="ui-button secondary menu-refresh" type="button">Actualiser</button></header>
        <div class="world-list"></div>
      </section>
      <section class="main-menu-create">
        <h2>Nouveau monde</h2>
        <label>Nom<input class="world-name-input" maxlength="48" placeholder="Mon monde" /></label>
        <label>Seed<input class="world-seed-input" maxlength="96" placeholder="auto" /></label>
        <button class="ui-button create-world" type="button">Creer</button>
      </section>
      <section class="main-menu-settings">
        <h2>Reglages</h2>
        <label>Qualite<select class="quality-select"><option value="balanced">Equilibre</option><option value="high">Elevee</option><option value="low">Legere</option></select></label>
        <label>Chunks<input class="render-distance-input" type="range" min="2" max="16" value="6" /><span class="render-distance-label">6</span></label>
      </section>
    `;

    this.worldList = this.root.querySelector(".world-list")!;
    this.nameInput = this.root.querySelector(".world-name-input")!;
    this.seedInput = this.root.querySelector(".world-seed-input")!;
    this.qualitySelect = this.root.querySelector(".quality-select")!;
    this.renderDistanceInput = this.root.querySelector(".render-distance-input")!;

    const actions = this.root.querySelector(".main-menu-actions")!;
    this.continueButton = this.button("Continuer", () => {
      if (this.selectedWorldId) this.callbacks.loadWorld(this.selectedWorldId);
    });
    this.continueButton.disabled = true;
    actions.append(
      this.continueButton,
      this.button("Commandes", callbacks.openCommands, "secondary"),
      this.button("Sauver monde actif", callbacks.save, "secondary"),
    );

    this.root.querySelector<HTMLButtonElement>(".create-world")!.addEventListener("click", () => this.createWorld());
    this.root.querySelector<HTMLButtonElement>(".menu-refresh")!.addEventListener("click", () => this.renderWorlds(this.worlds));
    this.qualitySelect.addEventListener("change", () => {
      this.callbacks.setQuality(this.qualitySelect.value as "low" | "balanced" | "high");
    });
    this.renderDistanceInput.addEventListener("input", () => {
      const value = Number(this.renderDistanceInput.value);
      this.root.querySelector(".render-distance-label")!.textContent = `${value}`;
      this.callbacks.setRenderDistance(value);
    });
    overlay.appendChild(this.root);
  }

  show(): void {
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  renderWorlds(worlds: WorldSummary[], selectedWorldId = this.selectedWorldId): void {
    this.worlds = worlds;
    const selectedExists = selectedWorldId && worlds.some((world) => world.id === selectedWorldId);
    this.selectedWorldId = selectedExists ? selectedWorldId : worlds[0]?.id ?? null;
    this.continueButton.disabled = !this.selectedWorldId;
    this.worldList.textContent = "";
    if (worlds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "world-empty";
      empty.textContent = "Aucun monde sauvegarde.";
      this.worldList.appendChild(empty);
      return;
    }
    for (const world of worlds) {
      const row = document.createElement("div");
      row.className = `world-row${world.id === this.selectedWorldId ? " selected" : ""}`;
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const date = new Date(world.lastPlayedAt).toLocaleString();
      row.innerHTML = `
        <span><strong>${world.name}</strong><small>${world.seed}</small></span>
        <small>${date}</small>
      `;
      row.addEventListener("click", () => {
        this.selectedWorldId = world.id;
        this.renderWorlds(this.worlds, world.id);
      });
      row.addEventListener("dblclick", () => this.callbacks.loadWorld(world.id));
      row.addEventListener("keydown", (event) => {
        if (event.code === "Enter") this.callbacks.loadWorld(world.id);
      });
      const deleteButton = document.createElement("button");
      deleteButton.className = "world-delete";
      deleteButton.type = "button";
      deleteButton.textContent = "Suppr.";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.deleteWorld(world.id);
      });
      row.appendChild(deleteButton);
      this.worldList.appendChild(row);
    }
  }

  setSettings(quality: "low" | "balanced" | "high", renderDistance: number): void {
    this.qualitySelect.value = quality;
    this.renderDistanceInput.value = `${renderDistance}`;
    this.root.querySelector(".render-distance-label")!.textContent = `${renderDistance}`;
  }

  private createWorld(): void {
    const name = this.nameInput.value.trim() || `Monde ${this.worlds.length + 1}`;
    const seed = this.seedInput.value.trim() || undefined;
    this.callbacks.newGame({ name, seed });
  }

  private button(label: string, onClick: () => void, tone = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = `ui-button ${tone}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }
}
