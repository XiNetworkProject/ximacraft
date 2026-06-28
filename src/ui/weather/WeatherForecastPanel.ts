import { ForecastTimeline } from "../../weather/forecast/ForecastTimeline";

export class WeatherForecastPanel {
  readonly root = document.createElement("section");

  constructor() {
    this.root.className = "weather-forecast-panel";
  }

  render(timeline: ForecastTimeline): void {
    const rows = timeline.snapshots
      .slice(0, 6)
      .map((snapshot) => {
        const label = snapshot.leadSeconds === 0 ? "Now" : `+${Math.round(snapshot.leadSeconds / 60)}m`;
        return `<div><b>${label}</b><span>${snapshot.weatherType}</span><span>${snapshot.temperature.toFixed(1)}C</span><span>${snapshot.confidence}</span></div>`;
      })
      .join("");
    this.root.innerHTML = `<h3>Prévision</h3>${rows}`;
  }
}
