/**
 * Éclaircie : une zone de ciel bleu qui dissipe les nuages.
 *
 * Effets : baisse la couverture nuageuse, l'humidité et les précipitations,
 * remonte la pression. Pose un `clearingBias` qui affiche l'état CLEARING tant
 * que le ciel se dégage, avant de retomber sur CLEAR.
 *
 * Comme les cibles sont BASSES, la poussée tire les champs vers le bas : une
 * éclaircie mobile (avec speed/direction) "ouvre" littéralement une trouée qui
 * traverse une couche nuageuse existante.
 */

import { WeatherCell } from "../WeatherCell";
import { WeatherEvent, WeatherEventOptions } from "./WeatherEvent";
import { WeatherEventType } from "../WeatherTypes";

export interface ClearingOptions extends Omit<WeatherEventOptions, "type"> {}

export class ClearingEvent extends WeatherEvent {
  constructor(options: ClearingOptions) {
    super({
      maxAge: 360,
      rampSeconds: 12,
      intensity: 0.9,
      ...options,
      type: WeatherEventType.CLEARING,
    });
  }

  clone(): ClearingEvent {
    return this.copyRuntimeTo(
      new ClearingEvent({
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
    // Le marqueur d'éclaircie monte AVANT que les nuages partent (rate élevé),
    // pour que l'état CLEARING s'affiche pendant la dissipation.
    cell.clearingBias = this.push(cell.clearingBias, 1, 0.6, inf, dt);
    cell.cloudCover = this.push(cell.cloudCover, 0.05, 0.09, inf, dt);
    cell.precipitation = this.push(cell.precipitation, 0, 0.25, inf, dt);
    cell.humidity = this.push(cell.humidity, 0.35, 0.05, inf, dt);
    cell.pressure = this.push(cell.pressure, 1020, 2, inf, dt);
    cell.instability = this.push(cell.instability, 0.05, 0.05, inf, dt);
  }
}
