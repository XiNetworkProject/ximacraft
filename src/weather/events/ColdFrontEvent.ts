/**
 * Front froid (v0.2 — vraie asymétrie avant/arrière).
 *
 * DEVANT le front (sens du déplacement) : développement nuageux, humidité et
 * instabilité fortes, pression qui chute → pluie forte voire orage (via le
 * couplage de la cellule). DERRIÈRE : air plus FRAIS et ciel plus CLAIR,
 * pression qui remonte. Rafales dans le sens d'avancée.
 *
 * Concrètement, à mesure que le front traverse une zone, on voit :
 *   ciel se couvre → orage/averse au passage → éclaircie + fraîcheur derrière.
 */

import { WeatherCell } from "../WeatherCell";
import { WeatherEvent, WeatherEventOptions } from "./WeatherEvent";
import { WeatherEventType } from "../WeatherTypes";
import { clamp01, smoothstep } from "../WeatherMath";

export interface ColdFrontOptions extends Omit<WeatherEventOptions, "type" | "radius"> {
  /** Rayon en blocs (défaut : 1400). */
  radius?: number;
}

export class ColdFrontEvent extends WeatherEvent {
  constructor(options: ColdFrontOptions) {
    super({
      radius: 1400,
      maxAge: 600,
      rampSeconds: 25,
      intensity: 0.8,
      speed: 18,
      ...options,
      type: WeatherEventType.COLD_FRONT,
    });
    this.precip = "rain";
    this.producesLightning = true;
    this.cloudBaseY = 100;
  }

  clone(): ColdFrontEvent {
    return this.copyRuntimeTo(
      new ColdFrontEvent({
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

    // ahead ≈ 1 devant le front, 0 derrière, transition douce autour de la ligne.
    const ahead = smoothstep(clamp01((this.along(cell) + this.radius * 0.2) / (this.radius * 0.4)));
    const behind = 1 - ahead;
    const aInf = inf * ahead;
    const bInf = inf * behind;

    // --- DEVANT : dégradation orageuse -------------------------------------
    cell.cloudCover = this.push(cell.cloudCover, 0.96, 0.18, aInf, dt);
    cell.humidity = this.push(cell.humidity, 0.85, 0.12, aInf, dt);
    cell.instability = this.push(cell.instability, 0.55 + this.intensity * 0.4, 0.1, aInf, dt);
    cell.pressure = this.push(cell.pressure, 1000 - this.intensity * 4, 3, aInf, dt);

    // --- DERRIÈRE : plus clair, pression qui remonte -----------------------
    cell.cloudCover = this.push(cell.cloudCover, 0.2, 0.12, bInf, dt);
    cell.humidity = this.push(cell.humidity, 0.4, 0.08, bInf, dt);
    cell.instability = this.push(cell.instability, 0.05, 0.08, bInf, dt);
    cell.pressure = this.push(cell.pressure, 1018, 3, bInf, dt);

    // --- Air froid : refroidit la masse, surtout derrière ------------------
    const coolTarget = cell.baseline.temperature - (5 + this.intensity * 8);
    const coolInf = inf * (0.4 + 0.6 * behind);
    cell.temperature = this.push(cell.temperature, coolTarget, 1.5, coolInf, dt);

    // --- Rafales dans le sens d'avancée ------------------------------------
    const gust = (10 + this.intensity * 12) * inf;
    cell.windX = this.push(cell.windX, this.dirX * gust, 5, inf, dt);
    cell.windZ = this.push(cell.windZ, this.dirZ * gust, 5, inf, dt);
  }
}
