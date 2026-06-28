/**
 * Moteur météo principal — façade publique du système.
 *
 * Responsabilités :
 *  - cadencer la simulation à pas fixe (découplé de la fréquence d'images) ;
 *  - suivre la position de l'observateur (= centre par défaut des commandes) ;
 *  - échantillonner la météo en un point (interpolation bilinéaire → bords
 *    doux entre cellules) ;
 *  - exposer une API simple pour les commandes développeur et le rendu.
 *
 * Aucune dépendance à Three.js : c'est purement de la logique.
 */

import { WeatherWorldState } from "./WeatherWorldState";
import { WeatherCell } from "./WeatherCell";
import { WeatherEvent } from "./events/WeatherEvent";
import { CloudyAreaEvent } from "./events/CloudyAreaEvent";
import { ClearingEvent } from "./events/ClearingEvent";
import { RainBandEvent } from "./events/RainBandEvent";
import { ColdFrontEvent } from "./events/ColdFrontEvent";
import { WarmFrontEvent } from "./events/WarmFrontEvent";
import { StormCellEvent } from "./events/StormCellEvent";
import { SquallLineEvent } from "./events/SquallLineEvent";
import { WindVector } from "./wind/WindVector";
import { BaselineProvider } from "./WeatherGrid";
import { classifyWeather } from "./WeatherMath";
import { CELL_SIZE, SIM_STEP, WeatherSample } from "./WeatherTypes";

export interface WeatherEngineOptions {
  /** Climat de fond par cellule (point d'extension biomes). */
  baselineProvider?: BaselineProvider;
  /** Pas de simulation fixe (s). Défaut : SIM_STEP. */
  simStep?: number;
}

export class WeatherEngine {
  readonly state: WeatherWorldState;
  private readonly simStep: number;
  private accumulator = 0;

  /** Position de l'observateur (joueur), centre par défaut des commandes. */
  private observerX = 0;
  private observerZ = 0;

  constructor(options: WeatherEngineOptions = {}) {
    this.state = new WeatherWorldState(options.baselineProvider);
    this.simStep = options.simStep ?? SIM_STEP;
  }

  // --- Boucle ---------------------------------------------------------------

  /** Position du joueur. À appeler chaque frame avant update(). */
  setObserver(x: number, z: number): void {
    this.observerX = x;
    this.observerZ = z;
    this.state.observerX = x;
    this.state.observerZ = z;
  }

  getObserver(): { x: number; z: number } {
    return { x: this.observerX, z: this.observerZ };
  }

  /**
   * Avance la météo. `deltaTime` (s) est accumulé puis consommé par pas fixes,
   * ce qui garantit un comportement identique quelle que soit la fréquence.
   */
  update(deltaTime: number): void {
    // Garde-fou : après un gros lag, on évite la spirale d'accumulation.
    this.accumulator += Math.min(deltaTime, 0.5);
    while (this.accumulator >= this.simStep) {
      this.state.update(this.simStep);
      this.accumulator -= this.simStep;
    }
  }

  reset(): void {
    this.accumulator = 0;
    this.state.reset();
  }

  // --- Lecture --------------------------------------------------------------

  /** Cellule contenant le point (créée si besoin). */
  getCellAt(x: number, z: number): WeatherCell {
    return this.state.grid.getCell(x, z);
  }

  /** Cellule sous l'observateur. */
  getObserverCell(): WeatherCell {
    return this.getCellAt(this.observerX, this.observerZ);
  }

  /**
   * Échantillon météo interpolé (bilinéaire) en un point monde.
   * Lisse les transitions entre cellules voisines — pas de "marche d'escalier"
   * météo aux frontières.
   */
  sampleAt(x: number, z: number): WeatherSample {
    return this.state.sampleAt(x, z);
  }

  /** Échantillon sous l'observateur. */
  sampleObserver(): WeatherSample {
    return this.sampleAt(this.observerX, this.observerZ);
  }

  // --- Vent -----------------------------------------------------------------

  setWind(x: number, z: number): void {
    this.state.windField.setGlobal(x, z);
  }

  getWind(): WindVector {
    return this.state.windField.global.clone();
  }

  // --- Événements (utilisés par les commandes) ------------------------------

  addEvent<T extends WeatherEvent>(event: T): T {
    this.state.addEvent(event);
    return event;
  }

  /** Nombre d'événements actifs (debug). */
  get activeEventCount(): number {
    return this.state.events.length;
  }

  /** Liste (lecture seule) des événements météo actifs, pour le debug. */
  getActiveEvents(): readonly WeatherEvent[] {
    return this.state.events;
  }

  /** Centre par défaut d'un nouvel événement : l'observateur. */
  private origin(x?: number, z?: number): { x: number; z: number } {
    return { x: x ?? this.observerX, z: z ?? this.observerZ };
  }

  spawnCloudyArea(radius = 1000, x?: number, z?: number): CloudyAreaEvent {
    const o = this.origin(x, z);
    return this.addEvent(new CloudyAreaEvent({ x: o.x, z: o.z, radius }));
  }

  spawnClearing(radius = 1000, x?: number, z?: number): ClearingEvent {
    const o = this.origin(x, z);
    return this.addEvent(new ClearingEvent({ x: o.x, z: o.z, radius }));
  }

  spawnRainBand(radius = 900, x?: number, z?: number): RainBandEvent {
    const o = this.origin(x, z);
    return this.addEvent(new RainBandEvent({ x: o.x, z: o.z, radius }));
  }

  spawnStormCell(
    radius = 1200,
    x?: number,
    z?: number,
    precip: "rain" | "snow" | "hail" = "rain",
  ): StormCellEvent {
    const o = this.origin(x, z);
    return this.addEvent(new StormCellEvent({ x: o.x, z: o.z, radius, precip }));
  }

  /**
   * Fait apparaître un front (ou une ligne de grains) qui ENTRE par le bord
   * amont et traverse en direction de l'observateur. `direction` = d'où il
   * vient / vers où il va selon la convention de la commande.
   */
  spawnColdFront(event: ColdFrontEvent): ColdFrontEvent {
    return this.addEvent(event);
  }

  spawnWarmFront(event: WarmFrontEvent): WarmFrontEvent {
    return this.addEvent(event);
  }

  spawnSquallLine(event: SquallLineEvent): SquallLineEvent {
    return this.addEvent(event);
  }
}
