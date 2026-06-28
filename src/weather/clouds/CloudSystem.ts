/**
 * Gestionnaire des masses nuageuses.
 *
 * Tient la liste des {@link CloudMass}, les fait évoluer via le
 * {@link CloudGrowthSystem} d'après les conditions échantillonnées dans le
 * {@link WeatherEngine}, et fait apparaître/disparaître les nuages :
 *  - apparition progressive autour du joueur tant que la couverture le justifie
 *    (on voit les nuages NAÎTRE puis grossir) ;
 *  - disparition quand un nuage est mort (growth ≈ 0) ou trop loin.
 *
 * Logique pure (aucun Three.js) : c'est {@link CloudMassRenderer} qui dessine
 * `masses`.
 */

import { CloudMass } from "./CloudMass";
import { CloudGrowthSystem } from "./CloudGrowthSystem";
import { CloudType, cloudBaseAltitude } from "./CloudType";
import { WeatherEngine } from "../WeatherEngine";
import { clamp01 } from "../WeatherMath";

const TAU = Math.PI * 2;
const SPAWN_RADIUS = 520; // anneau d'apparition autour du joueur
const DESPAWN_RADIUS = 780; // au-delà : retiré (hors de vue / brouillard)
const MAX_MASSES = 18;
const SPAWN_INTERVAL = 2.2; // s entre deux apparitions auto (progressif)

export class CloudSystem {
  readonly masses: CloudMass[] = [];
  private readonly growth = new CloudGrowthSystem();
  private spawnTimer = 0;

  constructor(private readonly engine: WeatherEngine) {}

  /** À appeler chaque frame. (ox, oz) = position du joueur. */
  update(dt: number, ox: number, oz: number): void {
    for (const mass of this.masses) {
      this.growth.update(mass, this.engine.sampleAt(mass.x, mass.z), dt);
    }

    // Purge : morts ou trop loin.
    for (let i = this.masses.length - 1; i >= 0; i -= 1) {
      const m = this.masses[i];
      if (this.growth.isDead(m) || Math.hypot(m.x - ox, m.z - oz) > DESPAWN_RADIUS) {
        this.masses.splice(i, 1);
      }
    }

    // Apparition automatique, étalée dans le temps.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.autoSpawn(ox, oz);
    }
  }

  /** Apparition naturelle d'un nuage si la couverture le justifie. */
  private autoSpawn(ox: number, oz: number): void {
    const target = Math.floor(clamp01(this.engine.sampleObserver().cloudCover) * MAX_MASSES);
    if (this.masses.length >= target) return;

    const angle = Math.random() * TAU;
    const dist = 120 + Math.random() * (SPAWN_RADIUS - 120);
    const x = ox + Math.cos(angle) * dist;
    const z = oz + Math.sin(angle) * dist;

    // Humidité insuffisante ici → pas de nuage (règle "humidité faible").
    const sample = this.engine.sampleAt(x, z);
    if (sample.humidity < 0.34) return;

    const mass = new CloudMass(x, cloudBaseAltitude(CloudType.CUMULUS), z, 200 + Math.random() * 220);
    mass.growth = 0.04; // naît minuscule → on le voit grossir
    this.masses.push(mass);
  }

  /** /weather cloud spawn <type> : pose un groupe de nuages d'un type imposé. */
  spawnCluster(type: CloudType, cx: number, cz: number, radius: number): number {
    const count = Math.max(3, Math.min(MAX_MASSES, Math.round(radius / 180)));
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const dist = Math.random() * radius;
      const x = cx + Math.cos(angle) * dist;
      const z = cz + Math.sin(angle) * dist;
      const mass = new CloudMass(x, cloudBaseAltitude(type), z, 260 + Math.random() * 220);
      mass.pinnedType = type; // type imposé (sinon reclassé par les conditions)
      mass.type = type;
      mass.growth = 0.08; // naissance visible
      this.masses.push(mass);
    }
    return count;
  }

  /** /weather cloud clear : met en dissipation les nuages d'une zone. */
  clearArea(cx: number, cz: number, radius: number): number {
    let n = 0;
    for (const m of this.masses) {
      if (Math.hypot(m.x - cx, m.z - cz) <= radius) {
        m.dissipating = true;
        m.pinnedType = null; // laisse la classification reprendre en se dissipant
        n += 1;
      }
    }
    return n;
  }

  /** Résumé pour /weather cloud debug. */
  debugSummary(): string[] {
    const counts = new Map<CloudType, number>();
    let tallest: CloudMass | null = null;
    for (const m of this.masses) {
      counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
      if (!tallest || m.height > tallest.height) tallest = m;
    }
    const lines = [`-- Clouds: ${this.masses.length} masses --`];
    const parts: string[] = [];
    counts.forEach((n, type) => parts.push(`${type}:${n}`));
    lines.push(parts.length ? parts.join("  ") : "(none)");
    if (tallest) {
      lines.push(
        `tallest ${tallest.type} h=${tallest.height.toFixed(0)} growth=${tallest.growth.toFixed(2)} ` +
          `dark=${tallest.darkness.toFixed(2)} anvil=${tallest.anvilStretch.toFixed(2)}`,
      );
    }
    return lines;
  }
}
