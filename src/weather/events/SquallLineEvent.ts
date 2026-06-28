/**
 * Ligne de grains (v0.2) — vraie géométrie de LIGNE, pas un disque.
 *
 * Bande étroite (thickness) mais très ÉTIRÉE (length) perpendiculaire au
 * déplacement, qui balaie le monde RAPIDEMENT. Passage BRUTAL : orage violent +
 * rafales sur le front, puis ÉCLAIRCIE nette juste derrière.
 *
 * Géométrie : `along` = distance perpendiculaire à la ligne (épaisseur),
 * `across` = position le long de la ligne (longueur). Le rayon de recherche
 * englobe toute la ligne ; la forme réelle est filtrée dans applyToCell.
 */

import { WeatherCell } from "../WeatherCell";
import { WeatherEvent, WeatherEventOptions } from "./WeatherEvent";
import { WeatherEventType } from "../WeatherTypes";
import { clamp01, smoothstep } from "../WeatherMath";

export interface SquallLineOptions extends Omit<WeatherEventOptions, "type" | "radius"> {
  /** Longueur de la ligne en blocs (défaut : 2000). */
  length?: number;
  /** Épaisseur de la bande en blocs (défaut : 500). */
  thickness?: number;
}

export class SquallLineEvent extends WeatherEvent {
  readonly length: number;
  readonly thickness: number;

  constructor(options: SquallLineOptions) {
    const length = options.length ?? 2000;
    const thickness = options.thickness ?? 500;
    super({
      maxAge: 380,
      rampSeconds: 14,
      intensity: 0.9,
      speed: 28, // rapide
      ...options,
      type: WeatherEventType.SQUALL_LINE,
      // Disque de recherche couvrant toute la ligne ; la forme est filtrée plus bas.
      radius: length / 2 + thickness,
    });
    this.length = length;
    this.thickness = thickness;
    this.precip = "rain";
    this.producesLightning = true;
    this.cloudBaseY = 95;
  }

  clone(): SquallLineEvent {
    return this.copyRuntimeTo(
      new SquallLineEvent({
        x: this.x,
        z: this.z,
        length: this.length,
        thickness: this.thickness,
        intensity: this.intensity,
        maxAge: this.maxAge,
        speed: this.speed,
        direction: { x: this.dirX, z: this.dirZ },
        rampSeconds: this.rampSeconds,
      }),
    );
  }

  protected applyToCell(cell: WeatherCell, _distance: number, dt: number, life: number): void {
    const along = this.along(cell); // distance à la ligne (épaisseur)
    const across = this.across(cell); // position le long de la ligne

    const band = 1 - smoothstep(clamp01(Math.abs(along) / this.thickness));
    if (band <= 0) return;
    const endFade = 1 - smoothstep(clamp01((Math.abs(across) - this.length / 2) / this.thickness));
    if (endFade <= 0) return;

    const inf = band * endFade * life * this.intensity;
    if (inf <= 0) return;

    const ahead = smoothstep(clamp01((along + this.thickness * 0.3) / (this.thickness * 0.6)));
    const aInf = inf * ahead;
    const bInf = inf * (1 - ahead);

    // --- FRONT : orage violent + rafales -----------------------------------
    // Poussées rapides : la ligne passe vite, les seuils de pluie/orage doivent
    // être franchis pendant le court passage.
    cell.cloudCover = this.push(cell.cloudCover, 1, 0.5, aInf, dt);
    cell.humidity = this.push(cell.humidity, 0.95, 0.45, aInf, dt);
    cell.instability = this.push(cell.instability, 0.9, 0.35, aInf, dt);
    cell.pressure = this.push(cell.pressure, 998 - this.intensity * 4, 4, aInf, dt);
    cell.temperature = this.push(cell.temperature, cell.baseline.temperature - 5, 1.2, aInf, dt);
    const gust = (18 + this.intensity * 14) * aInf;
    cell.windX = this.push(cell.windX, this.dirX * gust, 6, aInf, dt);
    cell.windZ = this.push(cell.windZ, this.dirZ * gust, 6, aInf, dt);

    // --- DERRIÈRE : éclaircie nette ----------------------------------------
    cell.cloudCover = this.push(cell.cloudCover, 0.12, 0.18, bInf, dt);
    cell.humidity = this.push(cell.humidity, 0.4, 0.1, bInf, dt);
    cell.instability = this.push(cell.instability, 0.05, 0.1, bInf, dt);
    cell.pressure = this.push(cell.pressure, 1015, 3, bInf, dt);
  }
}
