import * as THREE from "three";
import { CELL_SIZE } from "../weather/WeatherTypes";
import { WeatherEngine } from "../weather/WeatherEngine";
import { deriveCloudLayerState } from "../weather/sky/CloudLayerState";
import { CloudCluster, CloudPopulationBand } from "../weather/scene/WeatherScene";
import { CloudMass } from "./CloudMass";
import { ConvectiveCloudSystem } from "./ConvectiveCloudSystem";
import { CloudPopulation, clusterOpacity } from "./CloudPopulation";

/**
 * Aligne des volumes nuageux vivants sur une POPULATION PERSISTANTE de clusters
 * (cf. {@link CloudPopulation}). Le plafond de volumes raymarchés ({@link MAX_VOLUMES})
 * ne limite QUE le rendu HERO/MID : la population complète du ciel (horizon,
 * background) vit dans le modèle et alimente la couverture du dôme.
 *
 * On ne fait JAMAIS de sélection « top-N » qui détruit un nuage parce qu'il est
 * temporairement moins bien noté : un cluster ne perd que son MESH (LOD), pas son
 * existence ; il le retrouve quand un emplacement se libère.
 */
const MAX_VOLUMES = 12;
const MESH_RANGE = CELL_SIZE * 10;
const SCAN_INTERVAL = 1.0;

export class RegionalCloudController {
  private readonly population = new CloudPopulation();
  /** clusterId -> volume raymarché qui le matérialise. */
  private readonly volumes = new Map<string, CloudMass>();
  private scanTimer = 0;
  private growthPulse = 0;

  constructor(
    private readonly engine: WeatherEngine,
    private readonly clouds: ConvectiveCloudSystem,
  ) {}

  reset(): void {
    this.population.reset();
    this.volumes.clear();
    this.scanTimer = 0;
    this.growthPulse = 0;
  }

  /** Full persistent population for the cheap horizon/mid-field renderer. */
  get clusters(): readonly CloudCluster[] {
    return this.population.clusters;
  }

  get backgroundCover(): number {
    return this.population.backgroundCover;
  }

  /** Diagnostic pour /weather debug cloud_population. */
  debugPopulation(): string[] {
    const p = this.population;
    return [
      `-- Cloud population: ${p.clusters.length} clusters, ${this.volumes.size}/${MAX_VOLUMES} volumes --`,
      `background=${p.backgroundCover.toFixed(2)} horizon=${p.count(CloudPopulationBand.HORIZON_FIELD)} mid=${p.count(CloudPopulationBand.MID_FIELD)} hero=${p.count(CloudPopulationBand.HERO_VOLUMES)}`,
      `dissipating=${p.clusters.filter((c) => c.type === "DISSIPATING").length} towering=${p.clusters.filter((c) => c.type === "TOWERING").length}`,
    ];
  }

  /** Donne à un orage en formation les cumulus vivants proches (sans les recréer). */
  claimStormSeeds(x: number, z: number, maxDistance: number, maxCount = 3): CloudMass[] {
    const nearby = [...this.volumes.entries()]
      .map(([id, mass]) => ({ id, mass, distance: Math.hypot(mass.position.x - x, mass.position.z - z) }))
      .filter((c) => !c.mass.dead && c.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxCount);
    for (const c of nearby) this.volumes.delete(c.id);
    return nearby.map((c) => c.mass);
  }

  update(dt: number, observerX: number, observerZ: number): void {
    this.scanTimer -= dt;
    this.growthPulse += dt;

    const wind = this.engine.getWind();
    const targets = this.bandTargets(observerX, observerZ);
    this.population.update(dt, observerX, observerZ, wind.x, wind.z, targets, (x, z) => {
      const s = this.engine.sampleAt(x, z);
      const layers = deriveCloudLayerState(s);
      return { cumulusPotential: layers.fairCumulusPotential, cloudCover: s.cloudCover };
    });

    this.syncVolumes(dt, observerX, observerZ);

    if (this.growthPulse >= 4.5) this.growthPulse = 0;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_INTERVAL;
      this.assignVolumes(observerX, observerZ);
    }
  }

  /** Cibles de remplissage par bande, dérivées du potentiel local peint. */
  private bandTargets(observerX: number, observerZ: number): { background: number; horizon: number; mid: number; hero: number } {
    const sample = this.engine.sampleAt(observerX, observerZ);
    const layers = deriveCloudLayerState(sample);
    const fc = layers.fairCumulusPotential;
    const convective = layers.deepConvection;
    const deckPenalty = layers.stratiformCover * 0.48;
    const toweringSignal = Math.max(
      convective,
      THREE.MathUtils.smoothstep(fc, 0.72, 0.96) * (0.35 + sample.instability * 0.65),
    );
    return {
      background: clamp01(layers.stratiformCover + sample.humidity * 0.12),
      horizon: clamp01(fc * 1.35 + sample.cloudCover * 0.08 + convective * 0.12),
      mid: clamp01(fc * 1.15 + convective * 0.16 - deckPenalty * 0.25),
      hero: clamp01(smoothstep(toweringSignal, 0.38, 0.86) * (1 - deckPenalty)),
    };
  }

  /** Met à jour les volumes existants en suivant leur cluster. */
  private syncVolumes(dt: number, observerX: number, observerZ: number): void {
    const response = 1 - Math.exp(-dt * 0.18);
    for (const [id, mass] of this.volumes) {
      const cluster = this.population.clusters.find((c) => c.id === id);
      if (!cluster || mass.dead || !this.clouds.masses.includes(mass)) {
        this.volumes.delete(id);
        continue;
      }
      const distance = Math.hypot(cluster.x - observerX, cluster.z - observerZ);
      if (cluster.type === "DISSIPATING" || distance > MESH_RANGE * 1.25) {
        if (mass.lifecycle !== "DISSIPATING" && mass.lifecycle !== "DISSIPATED") mass.dissipate();
        // On garde la masse jusqu'à sa mort naturelle, puis on libère le slot.
        if (mass.dead) this.volumes.delete(id);
        continue;
      }

      const sample = this.engine.sampleAt(cluster.x, cluster.z);
      // Le volume DÉRIVE avec son cluster (qui dérive avec le vent).
      mass.position.x = cluster.x;
      mass.position.z = cluster.z;
      mass.humidity = THREE.MathUtils.lerp(
        mass.humidity,
        THREE.MathUtils.clamp(cluster.weatherInfluence * 0.5 + sample.humidity * 0.5 + 0.18, 0.32, 0.94),
        response,
      );
      // Nuage AMBIANT = cumulus/congestus ; les cumulonimbus viennent des
      // événements météo, pas du peuplement (un seul gros orage net, entouré
      // de cumulus, plutôt que des CB partout).
      mass.setInstability(THREE.MathUtils.clamp(sample.instability, 0.12, cluster.canBecomeConvective ? 0.52 : 0.34));
      mass.upperWind.set(sample.windX, 0, sample.windZ);

      if (this.growthPulse >= 4.5 && cluster.weatherInfluence > 0.46 && mass.puffs.length < mass.puffBudget) {
        mass.grow();
        if (cluster.type === "TOWERING" && mass.puffs.length < mass.puffBudget) mass.grow();
      }
    }
  }

  /** Attribue (sans popping) des volumes aux clusters MID/HERO les plus saillants. */
  private assignVolumes(observerX: number, observerZ: number): void {
    if (this.volumes.size >= MAX_VOLUMES) return;
    const eligible = this.population.clusters
      .filter((c) =>
        c.type !== "DISSIPATING" &&
        (c.band === CloudPopulationBand.HERO_VOLUMES || c.band === CloudPopulationBand.MID_FIELD) &&
        (c.band === CloudPopulationBand.HERO_VOLUMES
          ? (c.type === "TOWERING" || c.weatherInfluence > 0.74)
          : (c.type === "TOWERING" || c.weatherInfluence > 0.66)) &&
        !this.volumes.has(c.id) &&
        Math.hypot(c.x - observerX, c.z - observerZ) <= MESH_RANGE)
      // HERO d'abord, puis les plus proches.
      .sort((a, b) => {
        const heroDiff = (b.band === CloudPopulationBand.HERO_VOLUMES ? 1 : 0) - (a.band === CloudPopulationBand.HERO_VOLUMES ? 1 : 0);
        if (heroDiff !== 0) return heroDiff;
        return Math.hypot(a.x - observerX, a.z - observerZ) - Math.hypot(b.x - observerX, b.z - observerZ);
      });

    for (const cluster of eligible) {
      if (this.volumes.size >= MAX_VOLUMES) break;
      const sample = this.engine.sampleAt(cluster.x, cluster.z);
      const mass = this.clouds.spawnAt(cluster.x, cluster.z, {
        humidity: THREE.MathUtils.clamp(sample.humidity + 0.18, 0.42, 0.95),
        instability: THREE.MathUtils.clamp(sample.instability, 0.14, cluster.canBecomeConvective ? 0.52 : 0.34),
      });
      // Taille du volume = taille cible du cluster (petit cumulus dense vs gros).
      mass.puffBudget = Math.round(THREE.MathUtils.clamp(cluster.targetSize * (0.82 + clusterOpacity(cluster) * 0.62), 54, 260));
      mass.upperWind.set(sample.windX, 0, sample.windZ);
      this.volumes.set(cluster.id, mass);
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(value: number, min: number, max: number): number {
  const t = clamp01((value - min) / Math.max(0.0001, max - min));
  return t * t * (3 - 2 * t);
}
