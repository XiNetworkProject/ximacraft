/**
 * Population PERSISTANTE de nuages (PUR, sans Three.js).
 *
 * Remplace l'ancienne sélection « top-N » qui créait puis détruisait des nuages
 * uniquement parce qu'ils n'étaient pas classés parmi les meilleurs du moment
 * (d'où l'effet « 2-4 nuages qui popent »).
 *
 * Ici, chaque nuage est un {@link CloudCluster} qui NAÎT, GRANDIT, DÉRIVE avec
 * le vent, DURE puis se DISSIPE lentement. Un cluster n'est jamais supprimé
 * parce qu'il est temporairement moins bien noté : seul l'âge (ou un éloignement
 * extrême) le retire. Les volumes raymarchés HERO/MID restent plafonnés au rendu
 * (LOD), mais ce plafond ne limite JAMAIS la population du ciel.
 *
 * Quatre bandes simultanées :
 *   BACKGROUND_LAYER — voile/cirrus/stratus lointain (géré par le dôme, suivi
 *                      ici comme une simple couverture, sans cluster).
 *   HORIZON_FIELD    — beaucoup de petits nuages lointains (données ; alimentent
 *                      la couverture, pas un mesh chacun).
 *   MID_FIELD        — groupes lisibles en zone médiane (volumes possibles).
 *   HERO_VOLUMES     — 0..3 grands volumes proches (raymarchés).
 */

import { CloudCluster, CloudPopulationBand } from "../weather/scene/WeatherScene";

export interface BandSample {
  /** Potentiel de cumulus de beau temps 0..1 au point. */
  cumulusPotential: number;
  /** Couverture nuageuse 0..1 au point. */
  cloudCover: number;
}

export type CloudSampler = (x: number, z: number) => BandSample;

interface BandConfig {
  band: CloudPopulationBand;
  maxCount: number;
  minRadius: number;
  maxRadius: number;
  baseHeight: number;
  lifetime: [number, number];
  size: [number, number];
}

const BANDS: BandConfig[] = [
  { band: CloudPopulationBand.HERO_VOLUMES, maxCount: 4, minRadius: 160, maxRadius: 1700, baseHeight: 540, lifetime: [260, 560], size: [170, 360] },
  { band: CloudPopulationBand.MID_FIELD, maxCount: 28, minRadius: 520, maxRadius: 3800, baseHeight: 620, lifetime: [240, 520], size: [110, 260] },
  { band: CloudPopulationBand.HORIZON_FIELD, maxCount: 48, minRadius: 2100, maxRadius: 8400, baseHeight: 760, lifetime: [300, 680], size: [65, 190] },
];

const SPAWN_INTERVAL = 0.9;
const DRIFT_SCALE = 0.75;

export class CloudPopulation {
  readonly clusters: CloudCluster[] = [];
  /** Couverture de la bande BACKGROUND (voile/cirrus), 0..1. */
  backgroundCover = 0;

  private spawnTimer = 0;
  private nextId = 1;
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  reset(): void {
    this.clusters.length = 0;
    this.spawnTimer = 0;
    this.backgroundCover = 0;
  }

  count(band: CloudPopulationBand): number {
    let n = 0;
    for (const c of this.clusters) if (c.band === band && c.type !== "DISSIPATING") n += 1;
    return n;
  }

  /**
   * Avance la population. `targets` = remplissage souhaité 0..1 par bande
   * (issu de l'état de ciel courant). `sampler` lit le potentiel local.
   */
  update(
    dt: number,
    observerX: number,
    observerZ: number,
    windX: number,
    windZ: number,
    targets: { background: number; horizon: number; mid: number; hero: number },
    sampler: CloudSampler,
  ): void {
    this.backgroundCover = clamp01(targets.background);

    // 1) Évolution de chaque cluster : âge, dérive, conditions, dissipation.
    for (let i = this.clusters.length - 1; i >= 0; i -= 1) {
      const c = this.clusters[i];
      c.age += dt;
      c.x += windX * dt * DRIFT_SCALE;
      c.z += windZ * dt * DRIFT_SCALE;

      const local = sampler(c.x, c.z);
      c.weatherInfluence = local.cumulusPotential;
      const cfg = bandConfig(c.band);

      // Objectifs (taille/couverture) suivent lentement le potentiel local.
      const potential = local.cumulusPotential;
      c.targetCoverage = clamp01(potential * 0.9 + 0.1);
      const lifeGrowth = smooth(clamp01(c.age / Math.max(1, c.fadeIn * 2.6)));
      const cellularVariance = 0.82 + c.seed * 0.28;
      c.targetSize = lerp(cfg.size[0], cfg.size[1], potential) * cellularVariance * lerp(0.38, 1, lifeGrowth);

      const distance = Math.hypot(c.x - observerX, c.z - observerZ);
      const tooDry = potential < 0.04;
      const tooFar = distance > cfg.maxRadius * 1.7;
      const expired = c.age >= c.lifetime;

      if ((tooDry || tooFar || expired) && c.type !== "DISSIPATING") {
        c.type = "DISSIPATING";
        // Fin de vie douce : on borne la durée restante à la rampe de sortie.
        c.lifetime = Math.min(c.lifetime, c.age + c.fadeOut);
      }

      // Type vivant selon le potentiel (cumulus -> scattered -> towering). Le
      // passage en TOWERING (qui peut donner une averse) est RARE : il faut un
      // potentiel très élevé, sinon le beau temps reste du cumulus.
      if (c.type !== "DISSIPATING") {
        c.type = potential > 0.82 && c.canBecomeConvective ? "TOWERING" : potential > 0.42 ? "SCATTERED" : "FAIR";
      }

      // Retrait UNIQUEMENT en fin de vie (jamais pour cause de classement).
      if (c.age >= c.lifetime && c.type === "DISSIPATING") {
        this.clusters.splice(i, 1);
      }
    }

    // 2) Naissance progressive pour approcher les cibles par bande.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.topUp(observerX, observerZ, targets, sampler);
    }
  }

  private topUp(
    observerX: number,
    observerZ: number,
    targets: { horizon: number; mid: number; hero: number },
    sampler: CloudSampler,
  ): void {
    for (const cfg of BANDS) {
      const target = cfg.band === CloudPopulationBand.HERO_VOLUMES ? targets.hero
        : cfg.band === CloudPopulationBand.MID_FIELD ? targets.mid : targets.horizon;
      const desired = Math.round(clamp01(target) * cfg.maxCount);
      const living = this.count(cfg.band);
      // Naissance limitée par tick : le ciel se peuple progressivement.
      let toSpawn = Math.min(desired - living, cfg.band === CloudPopulationBand.HORIZON_FIELD ? 6 : cfg.band === CloudPopulationBand.MID_FIELD ? 4 : 1);
      let attempts = Math.max(0, toSpawn) * 5;
      while (toSpawn > 0 && attempts > 0) {
        attempts -= 1;
        // Golden-angle placement prevents an unlucky random sector from leaving
        // the player's current horizon empty while preserving seed variation.
        const angle = this.nextId * 2.399963229728653 + (this.rng() - 0.5) * 0.42;
        const radius = lerp(cfg.minRadius, cfg.maxRadius, this.rng());
        const x = observerX + Math.cos(angle) * radius;
        const z = observerZ + Math.sin(angle) * radius;
        const local = sampler(x, z);
        // On ne sème un nuage que là où l'atmosphère le permet.
        if (local.cumulusPotential >= 0.045) {
          this.clusters.push(this.makeCluster(cfg, x, z, local.cumulusPotential));
          toSpawn -= 1;
        }
      }
    }
  }

  private makeCluster(cfg: BandConfig, x: number, z: number, potential: number): CloudCluster {
    const seed = this.rng();
    const lifetime = lerp(cfg.lifetime[0], cfg.lifetime[1], this.rng());
    const fade = Math.min(45, lifetime * 0.22);
    const convectiveLift = potential * (cfg.band === CloudPopulationBand.HERO_VOLUMES ? 110 : 70);
    const heightJitter = (seed - 0.5) * (cfg.band === CloudPopulationBand.HORIZON_FIELD ? 260 : 140);
    return {
      id: `cl-${this.nextId++}`,
      seed,
      band: cfg.band,
      x,
      z,
      baseHeight: cfg.baseHeight + heightJitter + convectiveLift,
      targetCoverage: clamp01(potential),
      targetSize: lerp(cfg.size[0], cfg.size[1], potential),
      type: "FAIR",
      age: 0,
      lifetime,
      fadeIn: fade,
      fadeOut: fade,
      weatherInfluence: potential,
      canBecomeConvective: cfg.band !== CloudPopulationBand.HORIZON_FIELD && potential > 0.72,
    };
  }
}

/** Opacité 0..1 d'un cluster selon sa rampe d'apparition/disparition. */
export function clusterOpacity(c: CloudCluster): number {
  const fadeIn = smooth(clamp01(c.age / Math.max(0.001, c.fadeIn)));
  const fadeOut = smooth(clamp01((c.lifetime - c.age) / Math.max(0.001, c.fadeOut)));
  return Math.min(fadeIn, fadeOut);
}

function bandConfig(band: CloudPopulationBand): BandConfig {
  return BANDS.find((b) => b.band === band) ?? BANDS[0];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
