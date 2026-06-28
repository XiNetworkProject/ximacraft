/**
 * État météo global du monde : agrège la grille de cellules, les événements
 * actifs, le temps météo écoulé et le champ de vent.
 *
 * C'est ici que se joue l'ordre d'un pas de simulation :
 *   1. avancer le champ de vent ;
 *   2. réinjecter le vent de fond dans chaque cellule (advection naturelle) ;
 *   3. appliquer les événements (poussées) puis retirer ceux expirés ;
 *   4. relaxer + classifier chaque cellule.
 * La classification arrive en dernier pour refléter les valeurs finales du pas.
 */

import { WeatherEvent } from "./events/WeatherEvent";
import { WeatherGrid, BaselineProvider } from "./WeatherGrid";
import { WindField } from "./wind/WindField";
import { classifyWeather } from "./WeatherMath";
import { CELL_SIZE, WeatherSample } from "./WeatherTypes";

export class WeatherWorldState {
  readonly grid: WeatherGrid;
  readonly windField: WindField;
  readonly events: WeatherEvent[] = [];

  /** Temps météo cumulé (s). */
  time = 0;

  /** Position de l'observateur (joueur), pour les phases des événements. */
  observerX = 0;
  observerZ = 0;

  constructor(baselineProvider?: BaselineProvider, grid?: WeatherGrid, windField?: WindField) {
    this.grid = grid ?? new WeatherGrid(baselineProvider);
    this.windField = windField ?? new WindField();
  }

  addEvent(event: WeatherEvent): void {
    this.events.push(event);
  }

  reset(): void {
    this.events.length = 0;
    this.grid.clear();
    this.windField.reset();
    this.time = 0;
  }

  sampleAt(x: number, z: number): WeatherSample {
    const half = CELL_SIZE / 2;
    const gx = Math.floor((x - half) / CELL_SIZE);
    const gz = Math.floor((z - half) / CELL_SIZE);
    const c00 = this.grid.ensureCell(gx, gz);
    const c10 = this.grid.ensureCell(gx + 1, gz);
    const c01 = this.grid.ensureCell(gx, gz + 1);
    const c11 = this.grid.ensureCell(gx + 1, gz + 1);

    const tx = (x - c00.centerX) / CELL_SIZE;
    const tz = (z - c00.centerZ) / CELL_SIZE;
    const bl = (a: number, b: number, c: number, d: number): number => {
      const top = a + (b - a) * tx;
      const bottom = c + (d - c) * tx;
      return top + (bottom - top) * tz;
    };

    const sample: WeatherSample = {
      temperature: bl(c00.temperature, c10.temperature, c01.temperature, c11.temperature),
      humidity: bl(c00.humidity, c10.humidity, c01.humidity, c11.humidity),
      pressure: bl(c00.pressure, c10.pressure, c01.pressure, c11.pressure),
      instability: bl(c00.instability, c10.instability, c01.instability, c11.instability),
      cloudCover: bl(c00.cloudCover, c10.cloudCover, c01.cloudCover, c11.cloudCover),
      precipitation: bl(c00.precipitation, c10.precipitation, c01.precipitation, c11.precipitation),
      thunderRisk: bl(c00.thunderRisk, c10.thunderRisk, c01.thunderRisk, c11.thunderRisk),
      windX: bl(c00.windX, c10.windX, c01.windX, c11.windX),
      windZ: bl(c00.windZ, c10.windZ, c01.windZ, c11.windZ),
      clearingBias: bl(c00.clearingBias, c10.clearingBias, c01.clearingBias, c11.clearingBias),
      weatherType: c00.weatherType,
      windSpeed: 0,
    };
    sample.weatherType = classifyWeather(sample);
    sample.windSpeed = Math.hypot(sample.windX, sample.windZ);
    return sample;
  }

  /** Avance l'état d'un pas de simulation fixe. */
  update(dt: number): void {
    this.time += dt;
    this.windField.update(dt);

    // Le vent de fond de chaque cellule suit le champ de vent : les
    // perturbations dérivent donc naturellement avec lui (via leur speed).
    this.grid.forEach((cell) => {
      const w = this.windField.sample(cell.centerX, cell.centerZ);
      cell.baseline.windX = w.x;
      cell.baseline.windZ = w.z;
    });

    // Événements : on applique puis on purge les expirés (parcours arrière).
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      event.update(dt, this.grid, this.observerX, this.observerZ);
      if (event.isExpired()) this.events.splice(i, 1);
    }

    // Physique des cellules (relaxation + dérivations + classification).
    this.grid.update(dt);
  }

  clone(): WeatherWorldState {
    const copy = new WeatherWorldState(undefined, this.grid.clone(), this.windField.clone());
    copy.time = this.time;
    copy.observerX = this.observerX;
    copy.observerZ = this.observerZ;
    this.events.forEach((event) => copy.events.push(event.clone()));
    return copy;
  }
}
