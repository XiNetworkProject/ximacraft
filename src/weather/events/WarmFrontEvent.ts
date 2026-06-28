/**
 * Front chaud (v0.2).
 *
 * Doux, large et LENT. Monte progressivement l'humidité, installe une couche
 * nuageuse stratiforme étendue et une pluie faible mais RÉGULIÈRE, avec un
 * léger réchauffement. Derrière, le ciel se dégage lentement (les fronts chauds
 * ne « cassent » pas, ils s'estompent).
 */

import { WeatherCell } from "../WeatherCell";
import { WeatherEvent, WeatherEventOptions } from "./WeatherEvent";
import { WeatherEventType } from "../WeatherTypes";
import { clamp01, smoothstep } from "../WeatherMath";

export interface WarmFrontOptions extends Omit<WeatherEventOptions, "type" | "radius"> {
  /** Rayon en blocs (défaut : 1800). */
  radius?: number;
}

export class WarmFrontEvent extends WeatherEvent {
  constructor(options: WarmFrontOptions) {
    super({
      radius: 1800,
      maxAge: 720,
      rampSeconds: 45,
      intensity: 0.55,
      speed: 8, // plus lent qu'un front froid
      ...options,
      type: WeatherEventType.WARM_FRONT,
    });
  }

  clone(): WarmFrontEvent {
    return this.copyRuntimeTo(
      new WarmFrontEvent({
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

    const ahead = smoothstep(clamp01((this.along(cell) + this.radius * 0.3) / (this.radius * 0.6)));
    const aInf = inf * ahead;
    const bInf = inf * (1 - ahead);

    // DEVANT : humidité douce, nuages progressifs, pluie régulière, réchauffement.
    cell.humidity = this.push(cell.humidity, 0.72, 0.06, aInf, dt);
    cell.cloudCover = this.push(cell.cloudCover, 0.9, 0.08, aInf, dt);
    cell.instability = this.push(cell.instability, 0.18, 0.04, aInf, dt);
    cell.pressure = this.push(cell.pressure, 1009, 1.5, aInf, dt);
    const warmTarget = cell.baseline.temperature + (3 + this.intensity * 4);
    cell.temperature = this.push(cell.temperature, warmTarget, 0.8, inf, dt);

    // DERRIÈRE : éclaircie lente.
    cell.cloudCover = this.push(cell.cloudCover, 0.45, 0.05, bInf, dt);
    cell.humidity = this.push(cell.humidity, 0.5, 0.05, bInf, dt);
  }
}
