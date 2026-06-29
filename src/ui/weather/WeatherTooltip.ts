import { WeatherMapSample } from "../../weather/map/WeatherMapData";

export class WeatherTooltip {
  readonly root = document.createElement("div");

  constructor() {
    this.root.className = "weather-tooltip hidden";
  }

  show(sample: WeatherMapSample, x: number, y: number): void {
    this.root.classList.remove("hidden");
    this.root.style.left = `${x + 14}px`;
    this.root.style.top = `${y + 14}px`;
    this.root.innerHTML = `
      <strong>x:${Math.round(sample.x)} z:${Math.round(sample.z)}</strong>
      <span>${sample.weatherType}</span>
      <span>Temp ${sample.temperature.toFixed(1)}C | Hum ${(sample.humidity * 100).toFixed(0)}%</span>
      <span>Pression ${sample.pressure.toFixed(0)} hPa</span>
      <span>Vent ${sample.windSpeed.toFixed(1)} blk/s</span>
      <span>Precip ${sample.precipitationKind} | Brouillard ${(sample.fogDensity * 100).toFixed(0)}% | Haze ${(sample.haze * 100).toFixed(0)}%</span>
      <span>Pluie ${(sample.rainRisk * 100).toFixed(0)}% | Orage ${(sample.thunderRisk * 100).toFixed(0)}%</span>
      <span>Neige ${(sample.snowRisk * 100).toFixed(0)}% | Grele ${(sample.hailRisk * 100).toFixed(0)}%</span>
      <span>Sol neige ${sample.snowDepth.toFixed(2)} | eau ${sample.wetness.toFixed(2)} | glace ${sample.iceDepth.toFixed(2)} | riviere ${sample.riverLevel.toFixed(2)}</span>
    `;
  }

  hide(): void {
    this.root.classList.add("hidden");
  }
}
