import { WorldMemorySnapshot } from "../living/WorldMemorySystem";
import { World } from "../world/World";

export type WorldMapSample = {
  x: number;
  z: number;
  height: number;
  biome: string;
  water: number;
  road: number;
  settlement?: "hamlet" | "village";
};

export type WorldMapMarker = {
  id: string;
  type: "hamlet" | "village" | "poi";
  label: string;
  x: number;
  z: number;
};

export type WorldMapData = {
  centerX: number;
  centerZ: number;
  radius: number;
  cellSize: number;
  player: { x: number; z: number };
  samples: WorldMapSample[];
  markers: WorldMapMarker[];
  journal: WorldMemorySnapshot;
};

export function buildWorldMapData(
  world: World,
  player: { x: number; z: number },
  radius: number,
  cellSize: number,
  journal: WorldMemorySnapshot,
  center: { x: number; z: number } = player,
): WorldMapData {
  const samples: WorldMapSample[] = [];
  const markers = new Map<string, WorldMapMarker>();
  const startX = Math.floor((center.x - radius) / cellSize) * cellSize;
  const endX = Math.ceil((center.x + radius) / cellSize) * cellSize;
  const startZ = Math.floor((center.z - radius) / cellSize) * cellSize;
  const endZ = Math.ceil((center.z + radius) / cellSize) * cellSize;
  const getHeight = (x: number, z: number) => world.getSurfaceHeight(x, z);

  for (let z = startZ; z <= endZ; z += cellSize) {
    for (let x = startX; x <= endX; x += cellSize) {
      const height = world.getSurfaceHeight(x, z);
      const macro = world.terrain.macro.sample(x, z);
      const biome = world.terrain.biomes.sample(x, z, height, macro.hydrology).id;
      const water = Math.max(macro.hydrology.river, macro.hydrology.stream * 0.66, macro.hydrology.lake, macro.hydrology.wetland * 0.38);
      const road = world.terrain.regions.roadStrengthAt(x, z, height, biome, getHeight);
      const settlement = world.terrain.regions.settlementAt(x, z, height, biome, getHeight);
      const sample: WorldMapSample = {
        x,
        z,
        height,
        biome,
        water,
        road,
        settlement: settlement?.kind,
      };
      samples.push(sample);

      if (settlement) {
        markers.set(`settlement:${settlement.id}`, {
          id: `settlement:${settlement.id}`,
          type: settlement.kind,
          label: settlement.kind === "village" ? "Village" : "Hameau",
          x: settlement.centerX,
          z: settlement.centerZ,
        });
      }

      const poi = world.terrain.living.poiAt(x, z, biome, height);
      if (poi) {
        markers.set(`poi:${x}:${z}`, {
          id: `poi:${x}:${z}`,
          type: "poi",
          label: labelForPoi(poi),
          x,
          z,
        });
      }
    }
  }

  return {
    centerX: center.x,
    centerZ: center.z,
    radius,
    cellSize,
    player: { x: player.x, z: player.z },
    samples,
    markers: [...markers.values()],
    journal,
  };
}

export class WorldMapJournalUI {
  readonly root = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly context = this.canvas.getContext("2d")!;
  private readonly journalPanel = document.createElement("div");
  private activeTab: "map" | "journal" = "map";
  private radius = 1800;
  private center: { x: number; z: number } | null = null;
  private lastData: WorldMapData | null = null;
  private dragStart: { x: number; y: number; centerX: number; centerZ: number } | null = null;
  private refresh = 0;

  constructor(
    overlay: HTMLElement,
    private readonly dataProvider: (center: { x: number; z: number } | null, radius: number) => WorldMapData | null,
  ) {
    this.root.className = "world-map-journal hidden";
    const header = document.createElement("header");
    header.innerHTML = `<div><span>Exploration</span><h2>Carte monde & journal</h2></div>`;
    const tabs = document.createElement("div");
    tabs.className = "world-map-tabs";
    const mapButton = this.tabButton("Carte", "map");
    const journalButton = this.tabButton("Journal", "journal");
    const recenter = document.createElement("button");
    recenter.type = "button";
    recenter.textContent = "Joueur";
    recenter.addEventListener("click", () => {
      this.center = null;
      this.render();
    });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "X";
    close.ariaLabel = "Fermer carte monde";
    close.addEventListener("click", () => this.close());
    tabs.append(mapButton, journalButton, recenter, close);
    header.appendChild(tabs);
    const body = document.createElement("main");
    const mapWrap = document.createElement("div");
    mapWrap.className = "world-map-canvas-wrap";
    mapWrap.appendChild(this.canvas);
    this.journalPanel.className = "world-journal-panel";
    body.append(mapWrap, this.journalPanel);
    this.root.append(header, body);
    overlay.appendChild(this.root);
    this.bindCanvas();
  }

  open(tab: "map" | "journal" = "map"): void {
    this.activeTab = tab;
    this.root.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
  }

  close(): void {
    this.root.classList.add("hidden");
  }

  isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  update(delta: number): void {
    if (!this.isOpen()) return;
    this.refresh -= delta;
    if (this.refresh <= 0) {
      this.refresh = 0.8;
      this.render();
    }
  }

  private bindCanvas(): void {
    this.canvas.addEventListener("mousedown", (event) => {
      const data = this.lastData;
      if (!data) return;
      this.dragStart = { x: event.clientX, y: event.clientY, centerX: data.centerX, centerZ: data.centerZ };
      this.center = { x: data.centerX, z: data.centerZ };
    });
    this.canvas.addEventListener("mousemove", (event) => {
      const data = this.lastData;
      if (!data || !this.dragStart) return;
      const scale = Math.min(this.canvas.width, this.canvas.height) / (data.radius * 2);
      this.center = {
        x: this.dragStart.centerX - (event.clientX - this.dragStart.x) / scale,
        z: this.dragStart.centerZ - (event.clientY - this.dragStart.y) / scale,
      };
      this.render();
    });
    window.addEventListener("mouseup", () => {
      this.dragStart = null;
    });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.radius = Math.max(500, Math.min(9000, this.radius * (event.deltaY > 0 ? 1.14 : 0.86)));
      this.render();
    });
  }

  private render(): void {
    this.root.dataset.tab = this.activeTab;
    const data = this.dataProvider(this.center, this.radius);
    if (!data) return;
    this.refresh = Math.max(this.refresh, 0.25);
    this.lastData = data;
    this.renderMap(data);
    this.renderJournal(data.journal);
  }

  private renderMap(data: WorldMapData): void {
    this.resizeCanvas();
    const scale = Math.min(this.canvas.width, this.canvas.height) / (data.radius * 2);
    const size = data.cellSize * scale + 1;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.fillStyle = "#071019";
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const sample of data.samples) {
      const screen = this.worldToScreen(data, sample.x, sample.z);
      this.context.fillStyle = terrainColor(sample);
      this.context.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
      if (sample.water > 0.16) {
        this.context.fillStyle = `rgba(42,128,180,${Math.min(0.76, sample.water)})`;
        this.context.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
      }
      if (sample.road > 0.35) {
        this.context.fillStyle = `rgba(195,155,90,${Math.min(0.9, sample.road)})`;
        this.context.fillRect(screen.x - size / 3, screen.y - size / 3, size * 0.66, size * 0.66);
      }
    }
    this.drawMarkers(data);
    this.drawPlayer(data);
    this.drawCompass();
    this.drawFogOfWar(data);
  }

  private renderJournal(journal: WorldMemorySnapshot): void {
    this.journalPanel.textContent = "";
    const cards = document.createElement("div");
    cards.className = "journal-card-grid";
    cards.append(
      journalCard("Biomes decouverts", journal.biomes.length, journal.biomes.join(", ") || "Aucun biome observe"),
      journalCard("Meteo observee", journal.weather.length, journal.weather.join(", ") || "Pas encore"),
      journalCard("Structures", journal.structures.length, journal.structures.join(", ") || "Aucune structure proche"),
      journalCard("Records", `${Math.round(journal.maxAltitude)}m`, `${Math.round(journal.distanceTravelled)} blocs parcourus - ${journal.traceCount} traces actives`),
    );
    const current = document.createElement("div");
    current.className = "journal-current";
    current.innerHTML = `<strong>Actuel</strong><span>${journal.lastBiome ?? "biome inconnu"} / ${journal.lastWeather ?? "meteo inconnue"}</span>`;
    this.journalPanel.append(current, cards);
  }

  private tabButton(label: string, tab: "map" | "journal"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tabTarget = tab;
    button.textContent = label;
    button.addEventListener("click", () => {
      this.activeTab = tab;
      this.render();
    });
    return button;
  }

  private drawMarkers(data: WorldMapData): void {
    for (const marker of data.markers) {
      const screen = this.worldToScreen(data, marker.x, marker.z);
      this.context.fillStyle = marker.type === "village" ? "#facc15" : marker.type === "hamlet" ? "#fbbf24" : "#d9f99d";
      this.context.strokeStyle = "rgba(0,0,0,0.55)";
      this.context.lineWidth = 2;
      this.context.beginPath();
      this.context.arc(screen.x, screen.y, marker.type === "poi" ? 4 : 6, 0, Math.PI * 2);
      this.context.fill();
      this.context.stroke();
      this.context.font = "600 11px system-ui, sans-serif";
      this.context.fillStyle = "#f8fafc";
      this.context.fillText(marker.label, screen.x + 8, screen.y - 6);
    }
  }

  private drawPlayer(data: WorldMapData): void {
    const screen = this.worldToScreen(data, data.player.x, data.player.z);
    this.context.fillStyle = "#7dd3fc";
    this.context.strokeStyle = "#082f49";
    this.context.lineWidth = 2;
    this.context.beginPath();
    this.context.moveTo(screen.x, screen.y - 9);
    this.context.lineTo(screen.x + 7, screen.y + 7);
    this.context.lineTo(screen.x - 7, screen.y + 7);
    this.context.closePath();
    this.context.fill();
    this.context.stroke();
  }

  private drawCompass(): void {
    this.context.fillStyle = "rgba(4,10,18,0.68)";
    this.context.fillRect(this.canvas.width - 62, 14, 46, 46);
    this.context.fillStyle = "#f8fafc";
    this.context.font = "800 14px system-ui, sans-serif";
    this.context.fillText("N", this.canvas.width - 40, 32);
    this.context.strokeStyle = "#7dd3fc";
    this.context.beginPath();
    this.context.moveTo(this.canvas.width - 39, 54);
    this.context.lineTo(this.canvas.width - 39, 36);
    this.context.stroke();
  }

  private drawFogOfWar(data: WorldMapData): void {
    const player = this.worldToScreen(data, data.player.x, data.player.z);
    const gradient = this.context.createRadialGradient(player.x, player.y, 80, player.x, player.y, Math.max(this.canvas.width, this.canvas.height) * 0.72);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.68, "rgba(0,0,0,0.12)");
    gradient.addColorStop(1, "rgba(0,0,0,0.48)");
    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private worldToScreen(data: WorldMapData, x: number, z: number): { x: number; y: number } {
    const scale = Math.min(this.canvas.width, this.canvas.height) / (data.radius * 2);
    return {
      x: this.canvas.width / 2 + (x - data.centerX) * scale,
      y: this.canvas.height / 2 + (z - data.centerZ) * scale,
    };
  }

  private resizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(260, Math.floor(rect.height));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
}

function terrainColor(sample: WorldMapSample): string {
  const heightShade = Math.max(0, Math.min(1, (sample.height - 38) / 82));
  const shade = 0.7 + heightShade * 0.34;
  const palette: Record<string, [number, number, number]> = {
    plains: [82, 125, 62],
    meadow: [92, 136, 66],
    flower_meadow: [96, 132, 68],
    forest: [42, 88, 48],
    old_forest: [35, 76, 44],
    birch_forest: [68, 110, 74],
    pine_forest: [42, 86, 62],
    dark_forest: [28, 62, 44],
    marsh: [55, 86, 64],
    bog: [60, 76, 58],
    beach: [176, 154, 103],
    dunes: [179, 141, 76],
    desert: [174, 132, 74],
    canyon: [148, 92, 62],
    hills: [90, 110, 70],
    plateau: [104, 112, 78],
    cliffs: [112, 112, 102],
    mountains: [116, 120, 112],
    alpine: [132, 140, 128],
    snow: [168, 176, 174],
    tundra: [132, 144, 118],
    snow_forest: [116, 142, 128],
    lake: [48, 110, 152],
    riverbank: [92, 112, 76],
    mountain_lake: [58, 118, 158],
  };
  const [r, g, b] = palette[sample.biome] ?? [78, 100, 74];
  return `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)})`;
}

function journalCard(title: string, value: number | string, body: string): HTMLElement {
  const card = document.createElement("article");
  card.className = "journal-card";
  const h = document.createElement("h3");
  h.textContent = title;
  const strong = document.createElement("strong");
  strong.textContent = `${value}`;
  const p = document.createElement("p");
  p.textContent = body;
  card.append(h, strong, p);
  return card;
}

function labelForPoi(poi: string): string {
  return poi
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
