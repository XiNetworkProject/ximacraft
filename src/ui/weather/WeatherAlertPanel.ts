import { WeatherAlert } from "../../weather/alerts/WeatherAlert";

export class WeatherAlertPanel {
  readonly root = document.createElement("section");

  constructor() {
    this.root.className = "weather-alert-panel";
  }

  render(alerts: WeatherAlert[]): void {
    const rows = alerts.slice(0, 6).map((alert) => `<div class="alert-${alert.level.toLowerCase()}"><b>${alert.level}</b><span>${alert.type}</span><small>${alert.description}</small></div>`).join("");
    this.root.innerHTML = `<h3>Alertes</h3>${rows || "<p>Aucune alerte active.</p>"}`;
  }
}
