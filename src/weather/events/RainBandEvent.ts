/**
 * Bande de pluie mobile (v0.2).
 *
 * Zone pluvieuse qui se déplace (typiquement avec le vent). L'intensité règle
 * la force de la pluie : faible (bruine) → forte (averse). Pas d'orage marqué
 * (pour ça : StormCell / SquallLine).
 */

import { WeatherCell } from "../WeatherCell";
import { WeatherEvent, WeatherEventOptions } from "./WeatherEvent";
import { WeatherEventType } from "../WeatherTypes";

export interface RainBandOptions extends Omit<WeatherEventOptions, "type"> {}

export class RainBandEvent extends WeatherEvent {
  constructor(options: RainBandOptions) {
    super({
      maxAge: 320,
      rampSeconds: 20,
      intensity: 0.6,
      speed: 12,
      ...options,
      type: WeatherEventType.RAIN_BAND,
    });
    this.precip = "rain";
    this.cloudBaseY = 100;
  }

  clone(): RainBandEvent {
    return this.copyRuntimeTo(
      new RainBandEvent({
        x: this.x,
        z: this.z,
        radius: this.radius,
        intensity: this.intensity,
        maxAge: this.maxAge,
        speed: this.speed,
        direction: { x: this.dirX, z: this.dirZ },
        rampSeconds: this.rampSeconds,
      }),
    );
  }

  protected applyToCell(cell: WeatherCell, distance: number, dt: number, life: number): void {
    const inf = this.influence(distance, life);
    if (inf <= 0) return;
    // Nuages et humidité d'autant plus forts que l'intensité est élevée :
    // pilote LIGHT_RAIN → HEAVY_RAIN via le couplage de la cellule.
    cell.cloudCover = this.push(cell.cloudCover, 0.88 + this.intensity * 0.09, 0.16, inf, dt);
    cell.humidity = this.push(cell.humidity, 0.7 + this.intensity * 0.22, 0.12, inf, dt);
    cell.pressure = this.push(cell.pressure, 1006, 2, inf, dt);
    cell.instability = this.push(cell.instability, 0.2 + this.intensity * 0.2, 0.05, inf, dt);
  }
}
