import { WorldSummary } from "../../world/SaveManager";
import { button, clearElement, focusPrimary, MenuPage } from "./MenuPage";

type SortMode = "recent" | "name" | "created";

export class WorldSelectPage implements MenuPage {
  readonly route = "worlds" as const;
  readonly element = document.createElement("section");
  private readonly list = document.createElement("div");
  private readonly search = document.createElement("input");
  private readonly sort = document.createElement("select");
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
    this.element.append(header, toolbar, this.list);
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
    const menu = button("...", () => {
      const action = window.prompt(
        `Action pour "${world.name}"\nrenommer | dupliquer | supprimer | seed`,
        "renommer",
      )?.trim().toLowerCase();
      if (!action) return;
      if (action === "renommer") {
        const name = window.prompt("Nouveau nom du monde", world.name);
        if (name?.trim()) this.callbacks.rename(world.id, name);
        return;
      }
      if (action === "dupliquer") {
        this.callbacks.duplicate(world.id);
        return;
      }
      if (action === "supprimer") {
        if (window.confirm(`Supprimer definitivement "${world.name}" ? Cette action est irreversible.`)) {
          this.callbacks.delete(world.id);
        }
        return;
      }
      if (action === "seed") {
        void navigator.clipboard?.writeText(world.seed);
        window.alert(`Seed: ${world.seed}`);
      }
    }, "secondary");
    menu.ariaLabel = `Actions pour ${world.name}`;
    return menu;
  }
}

function createWorldPreview(world: WorldSummary): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "world-preview";
  const hash = parseInt((world.thumbnailKey ?? world.seed).slice(0, 8), 16) || 1;
  const hue = hash % 360;
  const hue2 = (hue + 42 + (hash % 80)) % 360;
  preview.style.setProperty("--preview-a", `hsl(${hue} 58% 34%)`);
  preview.style.setProperty("--preview-b", `hsl(${hue2} 62% 48%)`);
  preview.style.setProperty("--preview-sun", `hsl(${(hue + 130) % 360} 90% 78%)`);
  preview.appendChild(document.createElement("i"));
  preview.appendChild(document.createElement("b"));
  return preview;
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
