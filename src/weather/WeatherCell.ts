/**
 * Une cellule météo : un grand carré du monde (CELL_SIZE × CELL_SIZE blocs)
 * partageant les mêmes conditions atmosphériques.
 *
 * Modèle physique simplifié mais cohérent :
 *  - chaque champ "relaxe" en permanence vers un climat de fond (baseline) ;
 *  - les événements météo poussent les champs au-dessus/en dessous du fond ;
 *  - les précipitations et le risque d'orage sont DÉRIVÉS des nuages/humidité/
 *    instabilité (couplage), pas posés arbitrairement.
 *
 * Résultat : quand un événement passe, le temps se dégrade progressivement,
 * puis revient seul au calme une fois l'événement parti.
 */

import { classifyWeather } from "./WeatherMath";
import { approach } from "./WeatherMath";
import { CellBaseline, CELL_SIZE, WeatherFields, WeatherType } from "./WeatherTypes";

/** Vitesses de relaxation (unités/seconde) vers le baseline. Volontairement
 *  plus lentes que les poussées des événements, pour que ceux-ci dominent
 *  au centre et que les bords se reforment naturellement. */
const RELAX = {
  temperature: 0.5, // °C/s
  humidity: 0.04,
  pressure: 1.5, // hPa/s
  instability: 0.05,
  cloudCover: 0.05,
  wind: 1.5,
  precipitation: 0.12,
  thunderRisk: 0.1,
  // Lent : le marqueur d'éclaircie doit survivre le temps que les nuages
  // partent, sinon l'état CLEARING n'apparaît jamais.
  clearingBias: 0.06,
} as const;

export class WeatherCell implements WeatherFields {
  temperature: number;
  humidity: number;
  pressure: number;
  instability = 0.1;
  cloudCover: number;
  precipitation = 0;
  thunderRisk = 0;
  windX: number;
  windZ: number;
  clearingBias = 0;

  weatherType: WeatherType = WeatherType.CLEAR;

  constructor(
    /** Indices de cellule (pas des coordonnées monde). */
    readonly cellX: number,
    readonly cellZ: number,
    /** Climat de fond ; mutable car le vent de fond est réinjecté chaque pas. */
    readonly baseline: CellBaseline,
  ) {
    this.temperature = baseline.temperature;
    this.humidity = baseline.humidity;
    this.pressure = baseline.pressure;
    this.instability = baseline.instability;
    this.cloudCover = baseline.cloudCover;
    this.windX = baseline.windX;
    this.windZ = baseline.windZ;
    this.weatherType = classifyWeather(this);
  }

  clone(): WeatherCell {
    const copy = new WeatherCell(this.cellX, this.cellZ, { ...this.baseline });
    copy.temperature = this.temperature;
    copy.humidity = this.humidity;
    copy.pressure = this.pressure;
    copy.instability = this.instability;
    copy.cloudCover = this.cloudCover;
    copy.precipitation = this.precipitation;
    copy.thunderRisk = this.thunderRisk;
    copy.windX = this.windX;
    copy.windZ = this.windZ;
    copy.clearingBias = this.clearingBias;
    copy.weatherType = this.weatherType;
    return copy;
  }

  /** Coordonnée monde du centre de la cellule (X). */
  get centerX(): number {
    return this.cellX * CELL_SIZE + CELL_SIZE / 2;
  }

  /** Coordonnée monde du centre de la cellule (Z). */
  get centerZ(): number {
    return this.cellZ * CELL_SIZE + CELL_SIZE / 2;
  }

  /**
   * Avance la physique de la cellule d'un pas. Appelé APRÈS les événements
   * (qui ont déjà poussé les champs). Ici on relaxe vers le fond, on dérive
   * les précipitations/orages, puis on classifie.
   */
  update(dt: number): void {
    const b = this.baseline;

    // Relaxation vers le climat de fond.
    this.temperature = approach(this.temperature, b.temperature, RELAX.temperature, dt);
    this.humidity = approach(this.humidity, b.humidity, RELAX.humidity, dt);
    this.pressure = approach(this.pressure, b.pressure, RELAX.pressure, dt);
    this.instability = approach(this.instability, b.instability, RELAX.instability, dt);
    this.cloudCover = approach(this.cloudCover, b.cloudCover, RELAX.cloudCover, dt);
    this.windX = approach(this.windX, b.windX, RELAX.wind, dt);
    this.windZ = approach(this.windZ, b.windZ, RELAX.wind, dt);
    this.clearingBias = approach(this.clearingBias, 0, RELAX.clearingBias, dt);

    // Couplage : la pluie naît de nuages épais + air humide.
    const precipTarget =
      Math.max(0, (this.cloudCover - 0.8) * 5) * Math.max(0, (this.humidity - 0.6) / 0.4);
    this.precipitation = approach(this.precipitation, Math.min(1, precipTarget), RELAX.precipitation, dt);

    // Couplage : l'orage naît d'instabilité + précipitations.
    const thunderTarget = Math.min(1, this.instability * this.precipitation * 1.6);
    this.thunderRisk = approach(this.thunderRisk, thunderTarget, RELAX.thunderRisk, dt);

    this.weatherType = classifyWeather(this);
  }
}
