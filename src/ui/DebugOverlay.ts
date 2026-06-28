import { Player } from "../player/Player";
import { ChunkManager } from "../world/ChunkManager";
import { TextureManager } from "../assets/TextureManager";
import { Time } from "../game/Time";
import { WeatherSystem } from "../world/WeatherSystem";
import { WeatherSample } from "../weather/WeatherTypes";

export class DebugOverlay {
  readonly root: HTMLDivElement;
  visible = false;
  private fps = 0;
  private averageDelta = 1 / 60;

  constructor(overlay: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "debug-overlay hidden";
    overlay.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle("hidden", !this.visible);
  }

  update(delta: number, player: Player, chunks: ChunkManager, textures: TextureManager, time: Time, weather: WeatherSystem, seed: string, regional?: WeatherSample, alertCount = 0): void {
    this.averageDelta = this.averageDelta * 0.92 + delta * 0.08;
    this.fps = Math.round(1 / Math.max(0.0001, this.averageDelta));
    if (!this.visible) return;
    const stats = chunks.getStats();
    this.root.textContent = [
      `FPS: ${this.fps}`,
      `XYZ: ${player.position.x.toFixed(2)} ${player.position.y.toFixed(2)} ${player.position.z.toFixed(2)}`,
      `Seed: ${seed}`,
      `Chunks: ${stats.loadedChunks}`,
      `Triangles: ${stats.triangles.toLocaleString()}`,
      `Time: ${Math.floor(time.ticks)} speed ${time.speed.toFixed(2)}`,
      `Weather: ${weather.current} intensity ${weather.intensity.toFixed(2)}`,
      `Regional: ${regional?.weatherType ?? "n/a"} temp ${regional ? regional.temperature.toFixed(1) : "n/a"} wind ${regional ? regional.windSpeed.toFixed(1) : "n/a"}`,
      `Weather alerts: ${alertCount}`,
      `Textures: ${textures.stats.loadedCount} loaded`,
      `Fallbacks: ${textures.stats.fallbacks.length}`,
    ].join("\n");
  }

  summary(): string {
    return `FPS ${this.fps}`;
  }
}
