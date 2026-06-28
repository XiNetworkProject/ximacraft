import { WeatherAlert } from "../../weather/alerts/WeatherAlert";
import { ForecastTimeline } from "../../weather/forecast/ForecastTimeline";
import { alertColor } from "../../weather/map/AlertMapLayer";
import { eventTrackEnd } from "../../weather/map/ForecastMapLayer";
import { WeatherMapData, WeatherMapSample } from "../../weather/map/WeatherMapData";
import { DEFAULT_WEATHER_MAP_LAYERS, WeatherMapLayer } from "../../weather/map/WeatherMapLayer";
import { WeatherMapProjection } from "../../weather/map/WeatherMapProjection";
import { pressureColor } from "../../weather/map/PressureMapLayer";
import { radarColor } from "../../weather/map/WeatherRadarLayer";
import { satelliteColor } from "../../weather/map/WeatherSatelliteLayer";
import { windArrow } from "../../weather/map/WindMapLayer";
import { WeatherAlertPanel } from "./WeatherAlertPanel";
import { WeatherForecastPanel } from "./WeatherForecastPanel";
import { WeatherRadarLegend } from "./WeatherRadarLegend";
import { WeatherTimelineSlider } from "./WeatherTimelineSlider";
import { WeatherTooltip } from "./WeatherTooltip";

type MapDataProvider = (timeOffsetSeconds: number, center: { x: number; z: number } | null, radius: number) => WeatherMapData;
type ForecastProvider = (center: { x: number; z: number } | null) => ForecastTimeline;
type AlertProvider = () => WeatherAlert[];

export class WeatherMapUI {
  readonly root = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly context = this.canvas.getContext("2d")!;
  private readonly tooltip = new WeatherTooltip();
  private readonly forecastPanel = new WeatherForecastPanel();
  private readonly alertPanel = new WeatherAlertPanel();
  private readonly legend = new WeatherRadarLegend();
  private readonly timeline = new WeatherTimelineSlider((seconds) => {
    this.timeOffset = seconds;
    this.renderNow();
  });
  private readonly activeLayers = new Set<WeatherMapLayer>(DEFAULT_WEATHER_MAP_LAYERS);
  private center: { x: number; z: number } | null = null;
  private radius = 1600;
  private timeOffset = 0;
  private lastData: WeatherMapData | null = null;
  private refresh = 0;
  private dragStart: { x: number; y: number; centerX: number; centerZ: number } | null = null;

  constructor(
    overlay: HTMLElement,
    private readonly dataProvider: MapDataProvider,
    private readonly forecastProvider: ForecastProvider,
    private readonly alertProvider: AlertProvider,
  ) {
    this.root.className = "weather-map-ui hidden";
    const header = document.createElement("header");
    header.innerHTML = `<h2>Carte météo</h2>`;
    header.innerHTML = `<h2>Carte meteo</h2>`;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "X";
    close.ariaLabel = "Close weather map";
    close.addEventListener("click", () => this.close());
    const recenter = document.createElement("button");
    recenter.type = "button";
    recenter.textContent = "Now";
    recenter.textContent = "Joueur";
    recenter.addEventListener("click", () => {
      this.center = null;
      this.renderNow();
    });
    header.append(recenter, close);

    const layerBar = document.createElement("div");
    layerBar.className = "weather-layer-bar";
    const layerLabels: Record<WeatherMapLayer, string> = {
      radar: "Radar",
      satellite: "Nuages",
      wind: "Vent",
      pressure: "Pression",
      alerts: "Alertes",
      forecast: "Previsions",
      temperature: "Temperature",
      accumulation: "Sol",
    };
    (["radar", "satellite", "wind", "pressure", "alerts", "forecast", "temperature", "accumulation"] as WeatherMapLayer[]).forEach((layer) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = layerLabels[layer];
      button.className = this.activeLayers.has(layer) ? "active" : "";
      button.addEventListener("click", () => {
        this.activeLayers.has(layer) ? this.activeLayers.delete(layer) : this.activeLayers.add(layer);
        button.classList.toggle("active", this.activeLayers.has(layer));
        this.renderNow();
      });
      layerBar.appendChild(button);
    });

    const main = document.createElement("main");
    const mapWrap = document.createElement("div");
    mapWrap.className = "weather-map-canvas-wrap";
    mapWrap.append(this.canvas, this.tooltip.root);
    const side = document.createElement("aside");
    side.append(this.forecastPanel.root, this.alertPanel.root, this.legend.root);
    main.append(mapWrap, side);

    this.root.append(header, this.timeline.root, layerBar, main);
    overlay.appendChild(this.root);
    this.bindCanvas();
  }

  open(): void {
    this.root.classList.remove("hidden");
    this.renderNow();
  }

  close(): void {
    this.root.classList.add("hidden");
    this.tooltip.hide();
  }

  isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  update(delta: number): void {
    if (!this.isOpen()) return;
    this.refresh -= delta;
    if (this.refresh <= 0) {
      this.refresh = 1.2;
      this.renderNow();
    }
  }

  private bindCanvas(): void {
    this.canvas.addEventListener("mousemove", (event) => {
      if (!this.lastData) return;
      const rect = this.canvas.getBoundingClientRect();
      if (this.dragStart) {
        const scale = Math.min(this.canvas.width, this.canvas.height) / (this.lastData.radius * 2);
        this.center = {
          x: this.dragStart.centerX - (event.clientX - this.dragStart.x) / scale,
          z: this.dragStart.centerZ - (event.clientY - this.dragStart.y) / scale,
        };
        this.renderNow();
        return;
      }
      const world = this.projection().screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const sample = this.nearestSample(world.x, world.z);
      if (sample) this.tooltip.show(sample, event.clientX - rect.left, event.clientY - rect.top);
    });
    this.canvas.addEventListener("mouseleave", () => {
      this.dragStart = null;
      this.tooltip.hide();
    });
    this.canvas.addEventListener("mousedown", (event) => {
      const data = this.lastData;
      if (!data) return;
      this.dragStart = { x: event.clientX, y: event.clientY, centerX: data.centerX, centerZ: data.centerZ };
      this.center = { x: data.centerX, z: data.centerZ };
    });
    window.addEventListener("mouseup", () => (this.dragStart = null));
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.radius = Math.max(700, Math.min(7200, this.radius * (event.deltaY > 0 ? 1.12 : 0.88)));
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (!this.isOpen()) return;
    this.resizeCanvas();
    const data = this.dataProvider(this.timeOffset, this.center, this.radius);
    this.lastData = data;
    if (!this.center) this.center = { x: data.centerX, z: data.centerZ };
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.fillStyle = "#071019";
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawWorldBackdrop(data);
    if (this.activeLayers.has("pressure")) this.drawSampleLayer(data, pressureColor);
    if (this.activeLayers.has("temperature")) this.drawSampleLayer(data, this.temperatureColor);
    if (this.activeLayers.has("satellite")) this.drawSampleLayer(data, satelliteColor);
    if (this.activeLayers.has("radar")) this.drawSampleLayer(data, radarColor);
    if (this.activeLayers.has("accumulation")) this.drawSampleLayer(data, this.accumulationColor);
    if (this.activeLayers.has("forecast")) this.drawEventTracks(data);
    if (this.activeLayers.has("alerts")) this.drawAlerts(data);
    if (this.activeLayers.has("wind")) this.drawWind(data);
    this.drawPlayer(data);

    this.forecastPanel.render(this.forecastProvider(this.center));
    this.alertPanel.render(this.alertProvider());
  }

  private drawWorldBackdrop(data: WeatherMapData): void {
    const p = this.projection();
    const scale = Math.min(this.canvas.width, this.canvas.height) / (data.radius * 2);
    const size = data.cellSize * scale + 1;
    for (const sample of data.samples) {
      const screen = p.worldToScreen(sample.x, sample.z);
      this.context.fillStyle = this.terrainColor(sample);
      this.context.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
    }

    this.context.strokeStyle = "rgba(255,255,255,0.08)";
    this.context.lineWidth = 1;
    const grid = 512;
    const left = data.centerX - data.radius;
    const right = data.centerX + data.radius;
    const top = data.centerZ - data.radius;
    const bottom = data.centerZ + data.radius;
    for (let x = Math.ceil(left / grid) * grid; x <= right; x += grid) {
      const a = p.worldToScreen(x, top);
      const b = p.worldToScreen(x, bottom);
      this.context.beginPath();
      this.context.moveTo(a.x, a.y);
      this.context.lineTo(b.x, b.y);
      this.context.stroke();
    }
    for (let z = Math.ceil(top / grid) * grid; z <= bottom; z += grid) {
      const a = p.worldToScreen(left, z);
      const b = p.worldToScreen(right, z);
      this.context.beginPath();
      this.context.moveTo(a.x, a.y);
      this.context.lineTo(b.x, b.y);
      this.context.stroke();
    }
  }

  private drawSampleLayer(data: WeatherMapData, color: (sample: WeatherMapSample) => string): void {
    const p = this.projection();
    const scale = Math.min(this.canvas.width, this.canvas.height) / (data.radius * 2);
    const size = data.cellSize * scale + 1;
    for (const sample of data.samples) {
      const screen = p.worldToScreen(sample.x, sample.z);
      this.context.fillStyle = color(sample);
      this.context.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
    }
  }

  private drawWind(data: WeatherMapData): void {
    const p = this.projection();
    this.context.strokeStyle = "rgba(220,245,255,0.76)";
    this.context.lineWidth = 1.4;
    data.samples.forEach((sample, index) => {
      if (index % 4 !== 0) return;
      const arrow = windArrow(sample);
      const screen = p.worldToScreen(sample.x, sample.z);
      const length = Math.min(26, 8 + arrow.speed * 1.2);
      this.context.beginPath();
      this.context.moveTo(screen.x, screen.y);
      this.context.lineTo(screen.x + arrow.dx * length, screen.y + arrow.dz * length);
      this.context.stroke();
    });
  }

  private drawEventTracks(data: WeatherMapData): void {
    const p = this.projection();
    for (const event of data.events) {
      const start = p.worldToScreen(event.x, event.z);
      const end = p.worldToScreen(eventTrackEnd(event, 30 * 60).x, eventTrackEnd(event, 30 * 60).z);
      this.context.strokeStyle = "rgba(255,255,255,0.62)";
      this.context.lineWidth = 2;
      this.context.beginPath();
      this.context.arc(start.x, start.y, Math.max(8, event.radius * this.scale() * 0.25), 0, Math.PI * 2);
      this.context.moveTo(start.x, start.y);
      this.context.lineTo(end.x, end.y);
      this.context.stroke();
    }
  }

  private drawAlerts(data: WeatherMapData): void {
    const p = this.projection();
    for (const alert of data.alerts) {
      const screen = p.worldToScreen(alert.region.x, alert.region.z);
      this.context.strokeStyle = alertColor(alert.level);
      this.context.lineWidth = 3;
      this.context.beginPath();
      this.context.arc(screen.x, screen.y, Math.max(10, alert.region.radius * this.scale()), 0, Math.PI * 2);
      this.context.stroke();
    }
  }

  private drawPlayer(data: WeatherMapData): void {
    const screen = this.projection().worldToScreen(data.player.x, data.player.z);
    this.context.fillStyle = "#facc15";
    this.context.beginPath();
    this.context.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
    this.context.fill();
  }

  private nearestSample(x: number, z: number): WeatherMapSample | null {
    const data = this.lastData;
    if (!data) return null;
    let best: WeatherMapSample | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const sample of data.samples) {
      const distance = Math.hypot(sample.x - x, sample.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = sample;
      }
    }
    return best;
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

  private projection(): WeatherMapProjection {
    const data = this.lastData;
    return new WeatherMapProjection({
      width: this.canvas.width,
      height: this.canvas.height,
      centerX: data?.centerX ?? this.center?.x ?? 0,
      centerZ: data?.centerZ ?? this.center?.z ?? 0,
      scale: this.scale(),
    });
  }

  private scale(): number {
    const radius = this.lastData?.radius ?? this.radius;
    return Math.min(this.canvas.width, this.canvas.height) / (radius * 2);
  }

  private temperatureColor(sample: WeatherMapSample): string {
    const cold = Math.max(0, Math.min(1, (4 - sample.temperature) / 18));
    const hot = Math.max(0, Math.min(1, (sample.temperature - 20) / 20));
    if (cold > hot) return `rgba(90,170,255,${0.12 + cold * 0.42})`;
    return `rgba(255,120,70,${0.08 + hot * 0.44})`;
  }

  private accumulationColor(sample: WeatherMapSample): string {
    const snow = Math.max(sample.snowDepth, sample.hailDepth);
    if (snow > 0.03) return `rgba(245,250,255,${Math.min(0.72, snow * 0.72)})`;
    if (sample.iceDepth > 0.03) return `rgba(185,230,255,${Math.min(0.65, sample.iceDepth * 0.65)})`;
    if (sample.wetness > 0.08) return `rgba(70,105,130,${Math.min(0.5, sample.wetness * 0.45)})`;
    return "rgba(0,0,0,0)";
  }

  private terrainColor(sample: WeatherMapSample): string {
    if (sample.water) return "rgba(26,84,130,0.78)";
    const heightShade = Math.max(0, Math.min(1, (sample.terrainHeight - 40) / 72));
    const shade = 0.72 + heightShade * 0.28;
    const colors: Record<string, [number, number, number]> = {
      forest: [48, 92, 52],
      plains: [80, 119, 58],
      hills: [85, 105, 62],
      mountains: [104, 106, 96],
      snow: [162, 172, 172],
      desert: [168, 143, 83],
      beach: [176, 154, 101],
      unknown: [76, 95, 70],
    };
    const [r, g, b] = colors[sample.biomeId] ?? colors.unknown;
    return `rgba(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)},0.92)`;
  }
}
