import type { WeatherVisualLabResult } from "./WeatherVisualLab";
import type { StratiformCloudDebugState } from "../render/weather/StratiformCloudRenderer";

export type WeatherVisualMode = "new" | "legacy";

export interface ToggleableRenderer {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export interface StratiformCloudTarget extends ToggleableRenderer {
  debugState(): StratiformCloudDebugState;
}

export interface WeatherVisualTargets {
  stratiformDome: ToggleableRenderer;
  stratiformClouds?: StratiformCloudTarget;
  cloudSprites: ToggleableRenderer;
  distantPrecipitation?: ToggleableRenderer;
}

export interface WeatherLayerAuthority {
  phenomenon: string;
  authority: string;
  worldAnchored: boolean;
  active: () => boolean;
  note?: string;
}

export interface WeatherVisualLabMetrics {
  events: readonly {
    id: number;
    type: string;
    x: number;
    z: number;
    radius: number;
    intensity: number;
    precip: string;
    producesLightning: boolean;
  }[];
  playerX: number;
  playerZ: number;
  convectiveMasses: number;
  sample: {
    weatherType: string;
    cloudCover: number;
    precipitation: number;
    thunderRisk: number;
    temperature: number;
    windSpeed: number;
  };
  scenePrecip?: {
    kind: string;
    intensity: number;
    reachesGround: boolean;
  };
  fogDensity?: number;
  snowDepth?: number;
  precipitationRenderer?: { rain: boolean; flakes: boolean; drawCount: number; opacity: number };
  rainCurtains?: { enabled: boolean; visible: boolean; drawCount: number };
  stratiformClouds?: StratiformCloudDebugState;
}

export class WeatherVisualDirector {
  private mode: WeatherVisualMode = "new";
  private readonly authorities: WeatherLayerAuthority[];
  private readonly panel: HTMLDivElement | null;
  private labResult: WeatherVisualLabResult | null = null;
  private metrics: WeatherVisualLabMetrics | null = null;
  private panelOpen = false;

  constructor(
    private readonly targets: WeatherVisualTargets,
    overlay?: HTMLElement,
  ) {
    this.authorities = [
      {
        phenomenon: "Atmosphere / soleil / lune / horizon",
        authority: "SkySystem",
        worldAnchored: false,
        active: () => true,
        note: "coupole camera normale; l'etat vient de WeatherEngine/WeatherDirector",
      },
      {
        phenomenon: "Nuages convectifs: cumulus, congestus, Cb",
        authority: "CloudVolumeRenderer",
        worldAnchored: true,
        active: () => true,
      },
      {
        phenomenon: "Precipitations distantes",
        authority: "RainCurtainRenderer",
        worldAnchored: true,
        active: () => this.targets.distantPrecipitation?.isEnabled() ?? false,
        note: "DESACTIVE en Phase 1: renderer grille/colonnes a remplacer",
      },
      {
        phenomenon: "Precipitations proches",
        authority: "PrecipitationRenderer local",
        worldAnchored: false,
        active: () => true,
        note: "suit la camera mais ne s'active que depuis la meteo locale reelle",
      },
      {
        phenomenon: "Brouillard / brume",
        authority: "FogBankRenderer + SkySystem fog",
        worldAnchored: true,
        active: () => true,
      },
      {
        phenomenon: "Neige au sol / surface",
        authority: "WorldSnowSystem + GroundCoverRenderer",
        worldAnchored: true,
        active: () => true,
      },
      {
        phenomenon: "Nuages stratiformes",
        authority: "StratiformCloudRenderer",
        worldAnchored: true,
        active: () => this.targets.stratiformClouds?.debugState().active ?? false,
        note: "Phase 2A: couches world-space base/sommet, sans dome fBm",
      },
      {
        phenomenon: "Sprites anciens de cumulus",
        authority: "SkyCloudPopulationRenderer",
        worldAnchored: true,
        active: () => this.targets.cloudSprites.isEnabled(),
        note: "legacy coupe en mode new",
      },
    ];
    this.panel = overlay ? this.createPanel(overlay) : null;
    this.apply();
  }

  getMode(): WeatherVisualMode {
    return this.mode;
  }

  setMode(mode: WeatherVisualMode): void {
    this.mode = mode;
    this.apply();
    this.renderPanel();
  }

  setLabScenario(result: WeatherVisualLabResult): void {
    this.labResult = result;
    this.panelOpen = true;
    this.renderPanel();
  }

  openLabPanel(): void {
    this.panelOpen = true;
    this.renderPanel();
  }

  updateLabMetrics(metrics: WeatherVisualLabMetrics): void {
    this.metrics = metrics;
    if (this.panelOpen) this.renderPanel();
  }

  private apply(): void {
    const legacy = this.mode === "legacy";
    this.targets.stratiformDome.setEnabled(legacy);
    this.targets.stratiformClouds?.setEnabled(!legacy);
    this.targets.cloudSprites.setEnabled(legacy);
    this.targets.distantPrecipitation?.setEnabled(false);
  }

  layersReport(): string[] {
    const lines: string[] = [];
    lines.push(`Weather Visual Lab: mode=${this.mode.toUpperCase()} scenario=${this.labResult?.scenario ?? "none"}`);
    lines.push("phenomene -> autorite [ancrage] [etat]");
    for (const authority of this.authorities) {
      const anchor = authority.worldAnchored ? "monde" : "camera";
      const state = authority.active() ? "ON" : "off";
      lines.push(`- ${authority.phenomenon}`);
      lines.push(`  -> ${authority.authority} [${anchor}] [${state}]${authority.note ? ` - ${authority.note}` : ""}`);
    }
    return lines;
  }

  private createPanel(overlay: HTMLElement): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = "weather-visual-lab-panel hidden";
    overlay.appendChild(panel);
    return panel;
  }

  private renderPanel(): void {
    if (!this.panel) return;
    this.panel.classList.toggle("hidden", !this.panelOpen);
    if (!this.panelOpen) return;

    const rows: string[] = [];
    const result = this.labResult;
    const metrics = this.metrics;
    const warnings = [...(result?.warnings ?? [])];
    if (this.mode === "legacy") warnings.push("ATTENTION: renderers legacy actifs.");
    if (result?.incomplete) warnings.push(result.incomplete);
    if (metrics?.rainCurtains?.enabled || metrics?.rainCurtains?.visible) {
      warnings.push("ATTENTION: RainCurtainRenderer actif alors qu'il doit rester coupe en Phase 2A.");
    }

    rows.push(`<div class="weather-visual-lab-title">Weather Visual Lab</div>`);
    rows.push(`<div class="weather-visual-lab-subtitle">${escapeHtml(result?.label ?? "Aucun scenario actif")}</div>`);
    rows.push(this.row("Scenario", result?.scenario ?? "-"));
    rows.push(this.row("Heure forcee", result?.forcedTime ?? "-"));
    rows.push(this.row("Mode", this.mode));
    rows.push(this.row("Evenements", String(metrics?.events.length ?? 0)));
    rows.push(this.row("Cellules orage", String(metrics?.events.filter((event) => event.type === "storm_cell").length ?? 0)));
    rows.push(this.row("Masses nuageuses", String(metrics?.convectiveMasses ?? 0)));
    rows.push(this.row("Precip joueur", metrics ? `${metrics.sample.precipitation.toFixed(2)} / ${metrics.sample.weatherType}` : "-"));
    rows.push(this.row("Nuages", metrics ? `${Math.round(metrics.sample.cloudCover * 100)}%` : "-"));
    rows.push(this.row("Stratiforme", this.formatStratiform(metrics?.stratiformClouds)));
    rows.push(this.row("Fog / neige", metrics ? `${(metrics.fogDensity ?? 0).toFixed(2)} / ${(metrics.snowDepth ?? 0).toFixed(2)}` : "-"));
    rows.push(this.row("Renderer precip", metrics?.precipitationRenderer
      ? `rain=${metrics.precipitationRenderer.rain ? "on" : "off"} flakes=${metrics.precipitationRenderer.flakes ? "on" : "off"} draw=${metrics.precipitationRenderer.drawCount}`
      : "-"));
    rows.push(this.row("Rideaux distants", metrics?.rainCurtains
      ? `${metrics.rainCurtains.enabled ? "enabled" : "disabled"} draw=${metrics.rainCurtains.drawCount}`
      : "disabled"));

    const nearest = this.nearestEvent(metrics);
    if (nearest) rows.push(this.row("Plus proche", nearest));
    if (result?.expected) rows.push(`<div class="weather-visual-lab-expected">${escapeHtml(result.expected)}</div>`);
    if (warnings.length > 0) {
      rows.push(`<div class="weather-visual-lab-warnings">${warnings.map(escapeHtml).join("<br>")}</div>`);
    }
    this.panel.innerHTML = rows.join("");
  }

  private row(label: string, value: string): string {
    return `<div class="weather-visual-lab-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
  }

  private formatStratiform(state: StratiformCloudDebugState | undefined): string {
    if (!state) return "-";
    if (!state.enabled) return "renderer off";
    const nearest = state.nearest;
    if (!nearest) return "renderer on, aucun deck";
    const dir = this.directionLabel(nearest.directionX, nearest.directionZ);
    return `${nearest.kind} base=${Math.round(nearest.baseHeight)} top=${Math.round(nearest.topHeight)} cov=${Math.round(nearest.coverage * 100)}% dist=${Math.round(nearest.distance)}m ${dir} ${nearest.speed.toFixed(1)}b/s`;
  }

  private directionLabel(x: number, z: number): string {
    if (Math.hypot(x, z) < 0.01) return "-";
    const dirs = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
    const angle = Math.atan2(z, x);
    return dirs[Math.round((angle / (Math.PI * 2)) * 8 + 8) % 8];
  }

  private nearestEvent(metrics: WeatherVisualLabMetrics | null): string | null {
    if (!metrics || metrics.events.length === 0) return null;
    let best = metrics.events[0];
    let bestD = Infinity;
    for (const event of metrics.events) {
      const distance = Math.hypot(event.x - metrics.playerX, event.z - metrics.playerZ);
      if (distance < bestD) {
        bestD = distance;
        best = event;
      }
    }
    const dx = best.x - metrics.playerX;
    const dz = best.z - metrics.playerZ;
    const direction = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "E" : "W") : (dz > 0 ? "S" : "N");
    return `#${best.id} ${best.type} ${Math.round(bestD)}m ${direction} precip=${best.precip} int=${best.intensity.toFixed(2)}`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
