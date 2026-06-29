import { Player } from "../player/Player";
import { ChunkManager } from "../world/ChunkManager";
import { BlockRegistry } from "../world/BlockRegistry";
import { TextureManager } from "../assets/TextureManager";
import { Time } from "../game/Time";
import { WeatherSystem } from "../world/WeatherSystem";
import { WeatherSample } from "../weather/WeatherTypes";
import type { EnvironmentState } from "../environment/EnvironmentState";
import { WORLD_DAY_TICKS } from "../utils/Constants";

const WEATHER_LABELS: Record<string, string> = {
  clear: "Clair",
  cloudy: "Nuageux",
  rain: "Pluie",
  storm: "Orage",
  thunderstorm: "Orage",
  snow: "Neige",
  blizzard: "Blizzard",
  hail: "Grêle",
  fog: "Brume",
  mist: "Brume",
  rainbow: "Arc-en-ciel",
};

const SEASON_LABELS: Record<string, string> = {
  spring: "Printemps",
  summer: "Été",
  autumn: "Automne",
  fall: "Automne",
  winter: "Hiver",
};

export class HUD {
  readonly root: HTMLDivElement;
  readonly line: HTMLDivElement;
  readonly toasts: HTMLDivElement;
  private lastSignature = "";

  constructor(overlay: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    const crosshair = document.createElement("div");
    crosshair.className = "crosshair";
    this.line = document.createElement("div");
    this.line.className = "hud-line";
    this.toasts = document.createElement("div");
    this.toasts.className = "toast-stack";
    this.root.append(crosshair, this.line, this.toasts);
    overlay.appendChild(this.root);
  }

  update(
    player: Player,
    chunks: ChunkManager,
    blocks: BlockRegistry,
    textures: TextureManager,
    time: Time,
    weather: WeatherSystem,
    regional?: WeatherSample,
    environment?: EnvironmentState,
  ): void {
    const selected = player.inventory.selectedSlot ? blocks.get(player.inventory.selectedSlot.blockId).displayName : "None";
    const stats = chunks.getStats();
    const signature = [
      Math.ceil(player.health / 2),
      Math.ceil(player.hunger / 2),
      player.gameMode,
      player.creativeFlying ? 1 : 0,
      selected,
      player.position.x.toFixed(1),
      player.position.y.toFixed(1),
      player.position.z.toFixed(1),
      stats.loadedChunks,
      stats.triangles,
      Math.floor(time.ticks / 20),
      weather.current,
      weather.intensity.toFixed(2),
      regional?.weatherType ?? "n/a",
      regional ? regional.temperature.toFixed(1) : "n/a",
      regional ? regional.windSpeed.toFixed(1) : "n/a",
      environment?.season.season ?? "n/a",
      environment ? environment.thermal.feelsLike.toFixed(1) : "n/a",
      environment?.surface.mood ?? "n/a",
      environment?.precipitationKind ?? "n/a",
      environment?.fauna.label ?? "n/a",
      environment ? environment.fog.visibilityMeters.toString() : "n/a",
      textures.stats.loadedCount,
      textures.stats.fallbacks.length,
    ].join("|");
    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;

    // HUD compact et contextuel (le détail technique reste dans F3).
    const mode = player.gameMode === "creative" ? "Créatif" : "Survie";
    const dayFrac = (((time.ticks % WORLD_DAY_TICKS) + WORLD_DAY_TICKS) % WORLD_DAY_TICKS) / WORLD_DAY_TICKS;
    const minutes = Math.floor(dayFrac * 24 * 60);
    const clock = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const isDay = dayFrac > 0.25 && dayFrac < 0.75;
    const weatherKey = (regional?.weatherType ?? weather.current ?? "clear").toLowerCase();
    const weatherLabel = WEATHER_LABELS[weatherKey] ?? capitalize(weatherKey);
    const temp = regional ? `${Math.round(regional.temperature)}°` : "";
    const seasonLabel = environment ? SEASON_LABELS[environment.season.season.toLowerCase()] ?? environment.season.season : "";
    const health = Math.max(0, Math.min(1, player.health / 20));
    const hunger = Math.max(0, Math.min(1, player.hunger / 20));
    // Seulement quand pertinent : chaleur/froid ressentis notables.
    const feels = environment?.thermal.feelsLike;
    const feelsChip =
      feels !== undefined && (feels <= 2 || feels >= 30)
        ? `<span class="hud-chip ${feels <= 2 ? "cold" : "hot"}">Ressenti ${Math.round(feels)}°</span>`
        : "";

    this.line.innerHTML = `
      <div class="hud-status">
        <span class="hud-mode ${player.gameMode}">${mode}${player.creativeFlying ? " · vol" : ""}</span>
        <span class="hud-selected">${selected}</span>
      </div>
      <div class="hud-vitals">
        <span class="hud-bar health"><i style="width:${(health * 100).toFixed(0)}%"></i></span>
        <span class="hud-bar hunger"><i style="width:${(hunger * 100).toFixed(0)}%"></i></span>
      </div>
      <div class="hud-env">
        <span class="hud-chip">${isDay ? "☀" : "☾"} ${clock}</span>
        <span class="hud-chip">${weatherLabel}${temp ? ` ${temp}` : ""}</span>
        ${seasonLabel ? `<span class="hud-chip">${seasonLabel}</span>` : ""}
        ${feelsChip}
      </div>
    `;
  }

  message(text: string): void {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = text;
    this.toasts.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
