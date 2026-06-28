/**
 * Cellule orageuse (v0.2) : orage LOCALISÉ, petit rayon, intense et bref.
 *
 * Fort développement nuageux, forte pluie, pression basse, thunderRisk élevé →
 * THUNDERSTORM via le couplage. Rayon réduit : un orage peut donc passer juste
 * à côté du joueur sans le toucher.
 */

import { WeatherCell } from "../WeatherCell";
import { WeatherEvent, WeatherEventOptions } from "./WeatherEvent";
import { PrecipKind, WeatherEventType } from "../WeatherTypes";

export interface StormCellOptions extends Omit<WeatherEventOptions, "type" | "radius"> {
  /** Rayon en blocs (défaut : 400). */
  radius?: number;
  precip?: Exclude<PrecipKind, "none">;
}

export class StormCellEvent extends WeatherEvent {
  constructor(options: StormCellOptions) {
    super({
      radius: 1200,
      maxAge: 520,
      rampSeconds: 32,
      intensity: 0.95,
      speed: 11,
      ...options,
      type: WeatherEventType.STORM_CELL,
    });
    this.precip = options.precip ?? "rain";
    this.producesLightning = true;
    this.cloudBaseY = this.precip === "snow" ? 260 : 310;
  }

  clone(): StormCellEvent {
    return this.copyRuntimeTo(
      new StormCellEvent({
        x: this.x,
        z: this.z,
        radius: this.radius,
        intensity: this.intensity,
        maxAge: this.maxAge,
        speed: this.speed,
        direction: { x: this.dirX, z: this.dirZ },
        rampSeconds: this.rampSeconds,
        precip: this.precip === "none" ? "rain" : this.precip,
      }),
    );
  }

  protected applyToCell(cell: WeatherCell, distance: number, dt: number, life: number): void {
    const inf = this.influence(distance, life);
    if (inf <= 0) return;
    cell.cloudCover = this.push(cell.cloudCover, 1, 0.22, inf, dt); // fort développement
    cell.humidity = this.push(cell.humidity, 0.95, 0.18, inf, dt); // forte pluie
    cell.instability = this.push(cell.instability, 0.85 + this.intensity * 0.13, 0.16, inf, dt); // thunderRisk élevé
    cell.pressure = this.push(cell.pressure, 996 - this.intensity * 3, 4, inf, dt); // pression basse
    if (this.precip === "snow") {
      cell.temperature = this.push(cell.temperature, -5 - this.intensity * 3, 3.2, inf, dt);
    } else if (this.precip === "hail") {
      cell.temperature = this.push(cell.temperature, 5, 0.55, inf, dt);
    }
    const gust = 16 * inf;
    cell.windX = this.push(cell.windX, this.dirX * gust, 5, inf, dt);
    cell.windZ = this.push(cell.windZ, this.dirZ * gust, 5, inf, dt);
  }
}
