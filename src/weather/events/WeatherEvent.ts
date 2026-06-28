/**
 * Classe de base des perturbations météo (événements).
 *
 * Un événement est une "tache" mobile qui pousse les champs des cellules
 * qu'elle survole. Le cycle de vie est géré ici ; les sous-classes ne décrivent
 * QUE leur effet local via {@link applyToCell}.
 *
 * Deux notions clés assurent la progressivité demandée :
 *  - `falloff(distance)` : influence forte au centre, nulle au bord ;
 *  - `lifeFactor()` : montée puis descente douce sur la durée de vie.
 * Combinées, elles font apparaître/disparaître les effets sans à-coup.
 */

import { WeatherCell } from "../WeatherCell";
import { WeatherGrid } from "../WeatherGrid";
import { Cardinal, PrecipKind, WeatherEventType, WeatherVisualSignature } from "../WeatherTypes";
import { approach, cardinalToVector, clamp01, smoothstep } from "../WeatherMath";
import { computePhase, WeatherEventPhase } from "./WeatherEventPhase";

let nextEventId = 1;

export interface WeatherEventOptions {
  type: WeatherEventType;
  /** Centre monde de l'événement. */
  x: number;
  z: number;
  /** Rayon d'influence en blocs. */
  radius: number;
  /** Intensité 0..1. */
  intensity?: number;
  /** Durée de vie en secondes. */
  maxAge?: number;
  /** Vitesse de déplacement en blocs/seconde. */
  speed?: number;
  /** Direction de déplacement : vecteur (sera normalisé) ou cardinale. */
  direction?: { x: number; z: number } | Cardinal;
  /** Durée des rampes d'apparition/disparition en secondes. */
  rampSeconds?: number;
}

export abstract class WeatherEvent {
  id: number;
  readonly type: WeatherEventType;
  x: number;
  z: number;
  radius: number;
  intensity: number;
  age = 0;
  maxAge: number;
  speed: number;
  /** Direction de déplacement, vecteur unitaire (0,0 = stationnaire). */
  dirX = 0;
  dirZ = 0;
  protected rampSeconds: number;

  /** Phase de vie courante (FORMING → DISSIPATING). */
  phase: WeatherEventPhase = WeatherEventPhase.FORMING;
  private prevObserverDistance: number | undefined;

  // --- Signature visuelle (les sous-classes la spécialisent) ---------------
  /** Type de précipitation pour les rideaux de pluie/neige/grêle. */
  precip: PrecipKind = "none";
  /** L'événement produit-il des éclairs (orages) ? */
  producesLightning = false;
  /** Altitude de la base nuageuse (rideau de précipitation posé dessous). */
  cloudBaseY = 105;
  /** Cinematic-only hint: seed the renderer at this event's current age. */
  visualWarmStart = false;

  constructor(options: WeatherEventOptions) {
    this.id = nextEventId++;
    this.type = options.type;
    this.x = options.x;
    this.z = options.z;
    this.radius = options.radius;
    this.intensity = clamp01(options.intensity ?? 0.6);
    this.maxAge = options.maxAge ?? 600;
    this.speed = options.speed ?? 0;
    this.rampSeconds = options.rampSeconds ?? 20;
    if (options.direction) this.setDirection(options.direction);
  }

  /** Définit la direction de déplacement (vecteur normalisé ou cardinale). */
  setDirection(direction: { x: number; z: number } | Cardinal): void {
    const v = typeof direction === "string" ? cardinalToVector(direction) : direction;
    const len = Math.hypot(v.x, v.z);
    if (len > 1e-6) {
      this.dirX = v.x / len;
      this.dirZ = v.z / len;
    } else {
      this.dirX = 0;
      this.dirZ = 0;
    }
  }

  /**
   * Avance l'événement : vieillit, se déplace, met à jour sa phase (selon
   * l'observateur), puis applique son effet aux cellules survolées.
   */
  update(dt: number, grid: WeatherGrid, observerX?: number, observerZ?: number): void {
    this.age += dt;
    this.move(dt);

    const distance =
      observerX !== undefined && observerZ !== undefined
        ? Math.hypot(observerX - this.x, observerZ - this.z)
        : undefined;
    this.phase = computePhase({
      age: this.age,
      maxAge: this.maxAge,
      radius: this.radius,
      distance,
      prevDistance: this.prevObserverDistance,
    });
    this.prevObserverDistance = distance;

    const cells = grid.getCellsInRadius(this.x, this.z, this.radius);
    const life = this.lifeFactor();
    for (const cell of cells) {
      const cellDistance = Math.hypot(cell.centerX - this.x, cell.centerZ - this.z);
      this.applyToCell(cell, cellDistance, dt, life);
    }
  }

  /** Signature pour les renderers (rideaux, éclairs) sans coupler le type. */
  visualSignature(): WeatherVisualSignature {
    return { precip: this.precip, lightning: this.producesLightning, cloudBaseY: this.cloudBaseY };
  }

  abstract clone(): WeatherEvent;

  protected copyRuntimeTo<T extends WeatherEvent>(copy: T): T {
    copy.id = this.id;
    copy.age = this.age;
    copy.phase = this.phase;
    copy.precip = this.precip;
    copy.producesLightning = this.producesLightning;
    copy.cloudBaseY = this.cloudBaseY;
    copy.visualWarmStart = this.visualWarmStart;
    copy.rampSeconds = this.rampSeconds;
    copy.dirX = this.dirX;
    copy.dirZ = this.dirZ;
    return copy;
  }

  /** Déplacement linéaire dans la direction courante. */
  move(dt: number): void {
    if (this.speed === 0) return;
    this.x += this.dirX * this.speed * dt;
    this.z += this.dirZ * this.speed * dt;
  }

  /** Vrai quand l'événement a dépassé sa durée de vie. */
  isExpired(): boolean {
    return this.age >= this.maxAge;
  }

  /** Influence radiale 0..1 : 1 au centre, lissée jusqu'à 0 au rayon. */
  protected falloff(distance: number): number {
    return 1 - smoothstep(clamp01(distance / this.radius));
  }

  /** Facteur de cycle de vie 0..1 : monte au début, redescend à la fin. */
  protected lifeFactor(): number {
    const fadeIn = smoothstep(clamp01(this.age / this.rampSeconds));
    const fadeOut = smoothstep(clamp01((this.maxAge - this.age) / this.rampSeconds));
    return Math.min(fadeIn, fadeOut);
  }

  /**
   * Influence locale totale en une cellule (distance + cycle de vie +
   * intensité), bornée 0..1. Sert de "force" aux poussées dans applyToCell.
   */
  protected influence(distance: number, life: number): number {
    return this.falloff(distance) * life * this.intensity;
  }

  /**
   * Pousse un champ vers `target` à une vitesse modulée par l'influence locale.
   * Helper central : au centre (influence ≈ 1) la poussée domine la relaxation
   * de la cellule ; au bord (influence ≈ 0) la cellule revient à son fond.
   */
  protected push(current: number, target: number, ratePerSec: number, influence: number, dt: number): number {
    return approach(current, target, ratePerSec * influence, dt);
  }

  /**
   * Projection signée d'une cellule sur l'axe de DÉPLACEMENT (blocs).
   * > 0 = la cellule est DEVANT l'événement (là où il va) ;
   * < 0 = la cellule est DERRIÈRE (là où il vient de passer).
   * Base de l'asymétrie des fronts (orageux devant, éclaircie derrière).
   */
  protected along(cell: WeatherCell): number {
    return (cell.centerX - this.x) * this.dirX + (cell.centerZ - this.z) * this.dirZ;
  }

  /**
   * Projection signée sur l'axe PERPENDICULAIRE au déplacement (blocs).
   * Sert à mesurer la position le long d'une ligne de grains (squall line).
   */
  protected across(cell: WeatherCell): number {
    return (cell.centerX - this.x) * -this.dirZ + (cell.centerZ - this.z) * this.dirX;
  }

  /**
   * Effet de l'événement sur UNE cellule. À implémenter par chaque sous-classe.
   * `life` est précalculé par update() pour éviter de le recalculer par cellule.
   */
  protected abstract applyToCell(cell: WeatherCell, distance: number, dt: number, life: number): void;
}
