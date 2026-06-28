/**
 * Zone qui devient progressivement nuageuse.
 *
 * Effets : monte l'humidité et la couverture nuageuse, baisse légèrement la
 * pression. L'humidité reste sous le seuil de pluie (~0.6) : il fait gris, mais
 * il ne pleut pas. La progression CLEAR → PARTLY_CLOUDY → CLOUDY → OVERCAST se
 * fait toute seule via la classification, au rythme de la montée du cloudCover.
 */

import { WeatherCell } from "../WeatherCell";
import { WeatherEvent, WeatherEventOptions } from "./WeatherEvent";
import { WeatherEventType } from "../WeatherTypes";

export interface CloudyAreaOptions extends Omit<WeatherEventOptions, "type"> {}

export class CloudyAreaEvent extends WeatherEvent {
  constructor(options: CloudyAreaOptions) {
    super({
      maxAge: 480,
      rampSeconds: 30,
      intensity: 0.8,
      ...options,
      type: WeatherEventType.CLOUDY_AREA,
    });
  }

  clone(): CloudyAreaEvent {
    return this.copyRuntimeTo(
      new CloudyAreaEvent({
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
    cell.cloudCover = this.push(cell.cloudCover, 0.95, 0.12, inf, dt);
    // Taux > relaxation de la cellule, sinon l'humidité ne décolle pas du fond
    // (et les nuages ne grossissent pas). Cible 0.6 = juste sous le seuil pluie.
    cell.humidity = this.push(cell.humidity, 0.6, 0.12, inf, dt);
    cell.pressure = this.push(cell.pressure, 1006, 2, inf, dt);
    cell.instability = this.push(cell.instability, 0.2, 0.04, inf, dt);
  }
}
