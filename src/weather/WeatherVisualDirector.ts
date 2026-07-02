import type { WeatherVisualLabResult } from "./WeatherVisualLab";
import type { StratiformCloudDebugState } from "../render/weather/StratiformCloudRenderer";
import type { CumulusFieldRenderDebug } from "../render/weather/CumulusFieldRenderer";
import type { DistantPrecipitationRenderDebug } from "../render/weather/DistantPrecipitationRenderer";
import type { FogRendererDebugState } from "../render/weather/fog/FogVolumeRenderer";
import type { AtmosphericHazeState } from "../environment/EnvironmentState";

export type WeatherVisualMode = "new" | "legacy";

export interface ToggleableRenderer {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export interface StratiformCloudTarget extends ToggleableRenderer {
  debugState(): StratiformCloudDebugState;
}

export interface CumulusFieldTarget extends ToggleableRenderer {
  debug(): CumulusFieldRenderDebug;
}

export interface WeatherVisualTargets {
  stratiformDome: ToggleableRenderer;
  stratiformClouds?: StratiformCloudTarget;
  cumulusField?: CumulusFieldTarget;
  cloudSprites: ToggleableRenderer;
  distantPrecipitation?: ToggleableRenderer;
  fogRenderer?: ToggleableRenderer & { debug(): FogRendererDebugState };
}

export interface CumulusFieldMetrics {
  enabled: boolean;
  active: boolean;
  regime: string;
  coverage: number;
  windX: number;
  windZ: number;
  scannedCells: number;
  activeTiles: number;
  formations: number;
  visible: number;
  near: number;
  mid: number;
  horizon: number;
  blueSkyFraction: number;
  spacing: number;
  dominant: boolean;
  largestRadius: number;
  largestMaturity: number;
  legacyMasses: number;
  seed: number;
  tileX: number;
  tileZ: number;
  streamRadius: number;
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
  cumulusField?: CumulusFieldMetrics;
  distantPrecipitation?: DistantPrecipitationRenderDebug;
  fogRenderer?: FogRendererDebugState;
  atmosphericHaze?: AtmosphericHazeState;
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
        authority: "DistantPrecipitationRenderer",
        worldAnchored: true,
        active: () => this.targets.distantPrecipitation?.isEnabled() ?? false,
        note: "Phase 2C-1: patches world-space lies aux rain_band; RainCurtainRenderer legacy reste OFF",
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
        authority: "FogVolumeRenderer + SkySystem atmospheric haze",
        worldAnchored: true,
        active: () => this.targets.fogRenderer?.isEnabled() ?? true,
        note: "Phase 2D-1: FogBankSystem/FogField unique, banques world-space + horizon haze",
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
        phenomenon: "Cumulus de beau temps (champ world-space)",
        authority: "FairWeatherCumulusField + CumulusFieldRenderer",
        worldAnchored: true,
        active: () => this.targets.cumulusField?.debug().active ?? false,
        note: "Phase 2B: champ streame air-mass, LOD proche/inter/horizon",
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
    this.metrics = null;
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
    this.targets.cumulusField?.setEnabled(!legacy);
    this.targets.cloudSprites.setEnabled(legacy);
    this.targets.distantPrecipitation?.setEnabled(!legacy);
    this.targets.fogRenderer?.setEnabled(!legacy);
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
      warnings.push("ATTENTION: RainCurtainRenderer legacy actif alors qu'il doit rester OFF.");
    }
    if (metrics?.fogRenderer?.legacyRendererActive) {
      warnings.push("ATTENTION: renderer fog legacy actif en meme temps que FogVolumeRenderer.");
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
    rows.push(this.row("Fog authority", metrics?.fogRenderer?.authority ?? "FogVolumeRenderer"));
    if (metrics?.fogRenderer) {
      rows.push(this.row("Fog mode", metrics.fogRenderer.mode));
      rows.push(this.row("Density at player", metrics.fogRenderer.densityAtPlayer.toFixed(2)));
      rows.push(this.row("Fog base/top", `${metrics.fogRenderer.baseY.toFixed(1)} / ${metrics.fogRenderer.topY.toFixed(1)}`));
      rows.push(this.row("Nearest fog bank", metrics.fogRenderer.nearestBankDistance < 0 ? "-" : `${Math.round(metrics.fogRenderer.nearestBankDistance)}m`));
      rows.push(this.row("Fog wind", `${this.directionLabel(metrics.fogRenderer.windX, metrics.fogRenderer.windZ)} ${metrics.fogRenderer.windSpeed.toFixed(1)}b/s`));
      rows.push(this.row("Terrain influence", metrics.fogRenderer.terrainInfluence.toFixed(2)));
      rows.push(this.row("Horizon visibility", `${Math.round(metrics.fogRenderer.horizonVisibility * 100)}%`));
      rows.push(this.row("Stratus-fog blend", metrics.fogRenderer.stratusFogBlend.toFixed(2)));
      rows.push(this.row("Fog visible banks/layers", `${metrics.fogRenderer.visibleBanks}/${metrics.fogRenderer.visibleLayers}`));
      rows.push(this.row("Legacy fog renderers", metrics.fogRenderer.legacyRendererActive ? "active" : "OFF"));
    }
    if (metrics?.atmosphericHaze) {
      rows.push(this.row("Atmospheric haze", `${metrics.atmosphericHaze.density.toFixed(2)} / sun ${metrics.atmosphericHaze.sunTransmittance.toFixed(2)}`));
    }
    rows.push(this.row("Distant precipitation", this.formatDistantPrecipitation(metrics?.distantPrecipitation)));
    if (metrics?.distantPrecipitation) {
      rows.push(this.row("Precipitation mode", metrics.distantPrecipitation.mode));
      rows.push(this.row("Rain patches visible", String(metrics.distantPrecipitation.patchesVisible)));
      rows.push(this.row("Nearest rain patch", metrics.distantPrecipitation.nearestPatchDistance == null ? "-" : `${Math.round(metrics.distantPrecipitation.nearestPatchDistance)}m`));
      rows.push(this.row("Rain-band intensity", metrics.distantPrecipitation.rainBandIntensity.toFixed(2)));
      rows.push(this.row("Wind tilt", metrics.distantPrecipitation.windTilt.toFixed(2)));
      rows.push(this.row("Local rain blend", metrics.distantPrecipitation.localRainBlend.toFixed(2)));
      rows.push(this.row("Distant draw", String(metrics.distantPrecipitation.drawCount)));
    }
    const cumulus = metrics?.cumulusField;
    rows.push(this.row("Cumulus field", cumulus ? (cumulus.enabled ? (cumulus.active ? "ON" : "on (idle)") : "OFF") : "-"));
    if (cumulus && cumulus.enabled) {
      rows.push(this.row("Cumulus regime", cumulus.regime));
      rows.push(this.row("Cumulus authority", "CumulusFieldRenderer only"));
      rows.push(this.row("Legacy cumulus renderers", "OFF"));
      rows.push(this.row("Convective renderer", cumulus.active ? "inactive" : "active"));
      rows.push(this.row("Legacy visible masses", String(cumulus.legacyMasses)));
      rows.push(this.row("Blue-sky fraction", `${Math.round(cumulus.blueSkyFraction * 100)}%`));
      rows.push(this.row("Cloud spacing", `${Math.round(cumulus.spacing)}m`));
      rows.push(this.row("Dominant formation", cumulus.dominant ? "ON" : "OFF"));
      rows.push(this.row("Largest cloud radius/mat", `${Math.round(cumulus.largestRadius)}m / ${cumulus.largestMaturity.toFixed(2)}`));
      rows.push(this.row("Cumulus couv/vent", `${Math.round(cumulus.coverage * 100)}% / ${this.directionLabel(cumulus.windX, cumulus.windZ)} ${Math.hypot(cumulus.windX, cumulus.windZ).toFixed(1)}b/s`));
      rows.push(this.row("Cumulus formations", `${cumulus.formations} (vis ${cumulus.visible})`));
      rows.push(this.row("Cumulus LOD proche/inter/horizon", `${cumulus.near}/${cumulus.mid}/${cumulus.horizon}`));
      rows.push(this.row("Cumulus tuiles actives", `${cumulus.activeTiles}/${cumulus.scannedCells}`));
      rows.push(this.row("Cumulus tuile / seed", `(${cumulus.tileX},${cumulus.tileZ}) seed=${cumulus.seed}`));
      rows.push(this.row("Cumulus distance stream", `${Math.round(cumulus.streamRadius)}m`));
      if (cumulus.active && cumulus.legacyMasses > 0) {
        warnings.push(`ATTENTION: ${cumulus.legacyMasses} cumulus legacy actifs pendant le champ fair-weather.`);
      }
    }
    rows.push(this.row("Fog / neige", metrics ? `${(metrics.fogDensity ?? 0).toFixed(2)} / ${(metrics.snowDepth ?? 0).toFixed(2)}` : "-"));
    rows.push(this.row("Renderer precip", metrics?.precipitationRenderer
      ? `rain=${metrics.precipitationRenderer.rain ? "on" : "off"} flakes=${metrics.precipitationRenderer.flakes ? "on" : "off"} draw=${metrics.precipitationRenderer.drawCount}`
      : "-"));
    rows.push(this.row("Rideaux distants", metrics?.rainCurtains
      ? `${metrics.rainCurtains.enabled ? "enabled" : "disabled"} draw=${metrics.rainCurtains.drawCount}`
      : "disabled"));
    rows.push(this.row("Legacy RainCurtainRenderer", metrics?.rainCurtains?.enabled || metrics?.rainCurtains?.visible ? "ON" : "OFF"));

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

  private formatDistantPrecipitation(state: DistantPrecipitationRenderDebug | undefined): string {
    if (!state) return "-";
    if (!state.enabled) return "OFF";
    if (!state.active) return "ON, idle";
    const distance = state.nearestPatchDistance == null ? "-" : `${Math.round(state.nearestPatchDistance)}m`;
    return `ON ${state.mode} patches=${state.patchesVisible} nearest=${distance}`;
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
