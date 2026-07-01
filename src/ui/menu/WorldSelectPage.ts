import { WorldSummary } from "../../world/SaveManager";
import { button, clearElement, focusPrimary, MenuPage } from "./MenuPage";

type SortMode = "recent" | "name" | "created";

export class WorldSelectPage implements MenuPage {
  readonly route = "worlds" as const;
  readonly element = document.createElement("section");
  private readonly list = document.createElement("div");
  private readonly search = document.createElement("input");
  private readonly sort = document.createElement("select");
  private readonly modal = document.createElement("div");
  private worlds: WorldSummary[] = [];

  constructor(
    private readonly callbacks: {
      back: () => void;
      createWorld: () => void;
      play: (worldId: string) => void;
      rename: (worldId: string, name: string) => void;
      duplicate: (worldId: string) => void;
      delete: (worldId: string) => void;
      refresh: () => void;
    },
  ) {
    this.element.className = "menu-worlds-page";
    const header = document.createElement("header");
    header.className = "menu-page-header";
    const title = document.createElement("div");
    title.innerHTML = `<span>Jouer</span><h2>Mes mondes</h2>`;
    header.append(title, button("Retour", callbacks.back, "secondary"));

    const toolbar = document.createElement("div");
    toolbar.className = "world-toolbar";
    this.search.type = "search";
    this.search.placeholder = "Rechercher un monde";
    this.search.addEventListener("input", () => this.render());
    for (const [value, label] of [
      ["recent", "Recents"],
      ["name", "Nom"],
      ["created", "Creation"],
    ] as Array<[SortMode, string]>) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      this.sort.appendChild(option);
    }
    this.sort.addEventListener("change", () => this.render());
    toolbar.append(this.search, this.sort, button("Creer un monde", callbacks.createWorld, "", true), button("Actualiser", callbacks.refresh, "secondary"));
    this.list.className = "world-card-grid";
    this.modal.className = "world-action-modal hidden";
    this.element.append(header, toolbar, this.list, this.modal);
  }

  setWorlds(worlds: WorldSummary[]): void {
    this.worlds = worlds;
    this.render();
  }

  focusPrimary(): void {
    focusPrimary(this.element);
  }

  private render(): void {
    clearElement(this.list);
    const worlds = this.filteredWorlds();
    if (worlds.length === 0) {
      const empty = document.createElement("div");
      empty.className = "world-empty-state";
      empty.innerHTML = `<h3>Aucun monde trouve</h3><p>Cree un monde pour commencer, ou ajuste la recherche.</p>`;
      empty.appendChild(button("Creer un monde", this.callbacks.createWorld, "", true));
      this.list.appendChild(empty);
      return;
    }
    worlds.forEach((world, index) => this.list.appendChild(this.worldCard(world, index === 0)));
  }

  private filteredWorlds(): WorldSummary[] {
    const query = this.search.value.trim().toLowerCase();
    const sort = this.sort.value as SortMode;
    const worlds = this.worlds.filter((world) => !query || world.name.toLowerCase().includes(query) || world.seed.toLowerCase().includes(query));
    worlds.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "created") return b.createdAt - a.createdAt;
      return b.lastPlayedAt - a.lastPlayedAt;
    });
    return worlds;
  }

  private worldCard(world: WorldSummary, featured: boolean): HTMLElement {
    const card = document.createElement("article");
    card.className = featured ? "world-card featured" : "world-card";
    const preview = createWorldPreview(world);
    const title = document.createElement("div");
    title.className = "world-card-title";
    title.innerHTML = `<h3>${escapeText(world.name)}</h3><small>Seed ${escapeText(world.seed)}</small>`;
    const meta = document.createElement("dl");
    meta.className = "world-meta";
    meta.append(
      datum("Mode", world.mode ?? "inconnu"),
      datum("Derniere ouverture", formatDate(world.lastPlayedAt)),
      datum("Saison", world.season ?? "inconnue"),
      datum("Meteo", world.weather ?? "inconnue"),
      datum("Temps", formatWorldTime(world.timeTicks ?? world.playTimeTicks ?? 0)),
    );
    const actions = document.createElement("div");
    actions.className = "world-card-actions";
    actions.append(
      button("Jouer", () => this.callbacks.play(world.id), "", featured),
      this.moreButton(world),
    );
    card.append(preview, title, meta, actions);
    card.addEventListener("dblclick", () => this.callbacks.play(world.id));
    return card;
  }

  private moreButton(world: WorldSummary): HTMLButtonElement {
    const menu = button("...", () => this.openActions(world), "secondary");
    menu.ariaLabel = `Actions pour ${world.name}`;
    return menu;
  }

  private openActions(world: WorldSummary): void {
    this.modal.textContent = "";
    this.modal.classList.remove("hidden");
    const panel = document.createElement("div");
    panel.className = "world-action-panel";
    const title = document.createElement("h3");
    title.textContent = world.name;
    const seed = document.createElement("p");
    seed.textContent = `Seed ${world.seed}`;
    const nameInput = document.createElement("input");
    nameInput.value = world.name;
    nameInput.maxLength = 48;
    const status = document.createElement("span");
    status.className = "world-action-status";
    const actions = document.createElement("div");
    actions.className = "world-action-buttons";
    actions.append(
      button("Renommer", () => {
        if (nameInput.value.trim()) {
          this.callbacks.rename(world.id, nameInput.value.trim());
          this.closeActions();
        }
      }, "", true),
      button("Dupliquer", () => {
        this.callbacks.duplicate(world.id);
        this.closeActions();
      }, "secondary"),
      button("Copier seed", () => {
        void navigator.clipboard?.writeText(world.seed);
        status.textContent = "Seed copiee";
      }, "secondary"),
      button("Supprimer", () => this.openDeleteConfirm(world), "danger"),
      button("Fermer", () => this.closeActions(), "secondary"),
    );
    panel.append(title, seed, nameInput, actions, status);
    this.modal.appendChild(panel);
  }

  private openDeleteConfirm(world: WorldSummary): void {
    this.modal.textContent = "";
    const panel = document.createElement("div");
    panel.className = "world-action-panel danger";
    const title = document.createElement("h3");
    title.textContent = `Supprimer ${world.name} ?`;
    const text = document.createElement("p");
    text.textContent = "Cette sauvegarde sera retiree de l'index et du stockage local.";
    const actions = document.createElement("div");
    actions.className = "world-action-buttons";
    actions.append(
      button("Annuler", () => this.openActions(world), "secondary"),
      button("Supprimer definitivement", () => {
        this.callbacks.delete(world.id);
        this.closeActions();
      }, "danger", true),
    );
    panel.append(title, text, actions);
    this.modal.appendChild(panel);
  }

  private closeActions(): void {
    this.modal.classList.add("hidden");
    this.modal.textContent = "";
  }
}

function createWorldPreview(world: WorldSummary): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "world-preview";
  const canvas = document.createElement("canvas");
  canvas.width = 260;
  canvas.height = 132;
  drawWorldPreview(canvas, world);
  preview.appendChild(canvas);
  return preview;
}

function drawWorldPreview(canvas: HTMLCanvasElement, world: WorldSummary): void {
  const ctx = canvas.getContext("2d")!;
  const hash = hashText(`${world.seed}:${world.thumbnailKey ?? ""}`);
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  const season = world.season ?? "spring";
  sky.addColorStop(0, season === "winter" ? "#9dc4e8" : season === "autumn" ? "#f2b27a" : "#6fb7ec");
  sky.addColorStop(1, season === "winter" ? "#dce8ee" : "#c7e8ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,239,178,0.86)";
  ctx.beginPath();
  ctx.arc(42 + (hash % 130), 30 + ((hash >> 4) % 18), 12, 0, Math.PI * 2);
  ctx.fill();

  const ridgeCount = 3;
  for (let layer = 0; layer < ridgeCount; layer += 1) {
    const yBase = 70 + layer * 17;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (let x = 0; x <= canvas.width; x += 16) {
      const n = Math.sin((x + hash * (layer + 1)) * 0.035) * 8 + Math.sin((x - hash) * 0.071) * 5;
      ctx.lineTo(x, yBase + n);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    const forest = world.worldOptions?.worldQuality === "wild";
    const colors = season === "winter"
      ? ["#d9e3df", "#b8c9c2", "#8fa59b"]
      : season === "autumn"
        ? ["#9a6e3e", "#6f7b44", "#385b3f"]
        : forest
          ? ["#547d4a", "#315f42", "#244b34"]
          : ["#7aa55b", "#5e8a4d", "#3f6e45"];
    ctx.fillStyle = colors[layer];
    ctx.fill();
  }

  if ((hash & 3) !== 0) {
    ctx.strokeStyle = "rgba(56,133,174,0.82)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo((hash % 70) + 12, canvas.height);
    ctx.bezierCurveTo(90, 106, 120, 96, 146 + (hash % 38), 78);
    ctx.stroke();
  }
  if ((hash & 7) < 4) {
    ctx.fillStyle = "rgba(244,205,104,0.9)";
    ctx.fillRect(176, 82, 18, 10);
    ctx.fillRect(192, 76, 22, 16);
    ctx.fillStyle = "rgba(70,43,28,0.8)";
    ctx.fillRect(179, 92, 38, 4);
  }
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function datum(label: string, value: string): HTMLElement {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  wrapper.append(dt, dd);
  return wrapper;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatWorldTime(ticks: number): string {
  const day = Math.floor(ticks / 24000);
  const hour = Math.floor(((ticks % 24000) / 24000) * 24);
  return `Jour ${day}, ${hour.toString().padStart(2, "0")}h`;
}

function escapeText(value: string): string {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
