import { Player } from "../player/Player";
import { ChunkManager } from "../world/ChunkManager";
import { BlockRegistry } from "../world/BlockRegistry";
import { TextureManager } from "../assets/TextureManager";
import { Time } from "../game/Time";
import { WeatherSystem } from "../world/WeatherSystem";
import { WeatherSample } from "../weather/WeatherTypes";

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
      textures.stats.loadedCount,
      textures.stats.fallbacks.length,
    ].join("|");
    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;
    this.line.innerHTML = `
      <div><span class="hearts">${"H".repeat(Math.ceil(player.health / 2)).padEnd(10, "-")}</span> <span class="hunger">${"F".repeat(Math.ceil(player.hunger / 2)).padEnd(10, "-")}</span></div>
      <div>${player.gameMode}${player.creativeFlying ? " flying" : ""} | ${selected} | XYZ ${player.position.x.toFixed(1)} ${player.position.y.toFixed(1)} ${player.position.z.toFixed(1)}</div>
      <div>Chunks ${stats.loadedChunks} | Triangles ${stats.triangles.toLocaleString()} | Time ${Math.floor(time.ticks)} | Weather ${weather.current} ${weather.intensity.toFixed(2)}</div>
      <div>Regional ${regional?.weatherType ?? "n/a"} | Temp ${regional ? regional.temperature.toFixed(1) : "n/a"}C | Wind ${regional ? regional.windSpeed.toFixed(1) : "n/a"}</div>
      <div>Textures ${textures.stats.loadedCount} loaded, ${textures.stats.fallbacks.length} fallback</div>
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
