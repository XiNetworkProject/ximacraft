export class WeatherRadarLegend {
  readonly root = document.createElement("div");

  constructor() {
    this.root.className = "weather-radar-legend";
    this.root.innerHTML = `
      <span><i style="background:#7dc3ff"></i>Pluie faible</span>
      <span><i style="background:#306ee6"></i>Pluie</span>
      <span><i style="background:#aa37be"></i>Forte</span>
      <span><i style="background:#dc2d2a"></i>Orage</span>
      <span><i style="background:#e1ebff"></i>Grele/Neige</span>
    `;
  }
}
