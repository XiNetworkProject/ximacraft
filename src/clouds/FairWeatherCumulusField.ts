import { SkyState, WeatherSceneState } from "../weather/scene/WeatherScene";

/*
 * FairWeatherCumulusField — logique MONDE d'un champ de cumulus de beau temps.
 *
 * Le monde est pavé d'une grille GLOBALE de cellules en ESPACE DE MASSE D'AIR
 * (air-mass space). Chaque cellule possède au plus une formation, dont
 * l'existence et les attributs sont dérivés d'un hash déterministe de
 * (seedMonde, cellX, cellZ) + un champ de densité continu piloté par la météo.
 *
 * Advection : airMass = worldPosition - wind * weatherTime. Les cellules sont
 * fixes dans cet espace ; leur position MONDE = airMass + wind * weatherTime, si
 * bien que les nuages dérivent avec le vent, ne se téléportent pas, ne suivent
 * pas la caméra, et redonnent la même formation si on revient au même endroit au
 * même instant de simulation. La grille globale (pas "par tuile") évite doublons
 * et coutures aux frontières. La densité vient d'un champ continu + couverture,
 * jamais d'un nombre fixe par cellule.
 *
 * Cette classe est PURE (aucun Three.js) → testable headless. Le rendu est
 * assuré par CumulusFieldRenderer.
 */

export type CumulusQuality = "low" | "balanced" | "high";

export interface CumulusFieldWeather {
  /** Champ actif seulement dans les états de ciel cumulus de beau temps. */
  active: boolean;
  /** Richesse 0..1 (couverture perçue) → densité du champ. */
  coverage: number;
  humidity: number;
  windX: number;
  windZ: number;
  /** Temps de simulation météo (s) pour l'advection de la masse d'air. */
  time: number;
}

export interface CumulusFormation {
  /** Id global stable dérivé des coordonnées de cellule (mapping renderer). */
  id: number;
  cellX: number;
  cellZ: number;
  /** Position MONDE courante (masse d'air advectée par le vent). */
  worldX: number;
  worldZ: number;
  baseHeight: number;
  thickness: number;
  radius: number;
  density: number;
  maturity: number;
  coverage: number;
  lobes: number;
  seed: number;
  distance: number;
}

export interface CumulusFieldDebug {
  active: boolean;
  seed: number;
  coverage: number;
  humidity: number;
  windX: number;
  windZ: number;
  scannedCells: number;
  activeTiles: number;
  formations: number;
  nearFormations: number;
  midFormations: number;
  horizonFormations: number;
  tileX: number;
  tileZ: number;
  streamRadius: number;
  streamMs: number;
}

interface QualitySettings {
  streamRadius: number;
  budget: number;
  nearDistance: number;
  midDistance: number;
}

const CELL = 760;
const CELL_ID_OFFSET = 1 << 15;

const QUALITY: Record<CumulusQuality, QualitySettings> = {
  low: { streamRadius: 4200, budget: 26, nearDistance: 1600, midDistance: 3200 },
  balanced: { streamRadius: 6800, budget: 44, nearDistance: 2100, midDistance: 4200 },
  high: { streamRadius: 9200, budget: 64, nearDistance: 2600, midDistance: 5200 },
};

const ACTIVE_SKY_RICHNESS: Partial<Record<SkyState, number>> = {
  [SkyState.FAIR_WEATHER_CUMULUS]: 0.34,
  [SkyState.SCATTERED_CUMULUS]: 0.5,
  [SkyState.BROKEN_CUMULUS]: 0.64,
};

function fract(value: number): number {
  return value - Math.floor(value);
}

/** Hash déterministe [0,1) d'une cellule (seed monde + coords + sel). */
function hashCell(seed: number, ci: number, cj: number, salt: number): number {
  let value = Math.imul((ci | 0) + salt * 374761, 2246822519);
  value = (value ^ Math.imul((cj | 0) + salt * 668265, 3266489917)) | 0;
  value = (value ^ Math.imul((seed | 0) + salt * 40503, 2654435761)) | 0;
  value = Math.imul(value ^ (value >>> 15), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Bruit de valeur lissé 2D (pour le champ continu de regroupement/clairières). */
function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const c00 = hashCell(seed, x0, z0, 91);
  const c10 = hashCell(seed, x0 + 1, z0, 91);
  const c01 = hashCell(seed, x0, z0 + 1, 91);
  const c11 = hashCell(seed, x0 + 1, z0 + 1, 91);
  return (c00 * (1 - sx) + c10 * sx) * (1 - sz) + (c01 * (1 - sx) + c11 * sx) * sz;
}

function clusterField(airX: number, airZ: number, seed: number): number {
  const a = valueNoise2(airX * 0.0013, airZ * 0.0013, seed);
  const b = valueNoise2(airX * 0.0031 + 11.7, airZ * 0.0031 - 4.1, seed + 7);
  return a * 0.68 + b * 0.32;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hashSeedString(seed: string | number): number {
  if (typeof seed === "number") return seed | 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Dérive l'activation + la richesse du champ à partir de l'état de ciel réel. */
export function deriveCumulusFieldWeather(
  scene: WeatherSceneState | null,
  sample: { cloudCover: number; humidity: number; windX: number; windZ: number },
  time: number,
): CumulusFieldWeather {
  const skyState = scene?.skyState;
  const base = skyState ? ACTIVE_SKY_RICHNESS[skyState] : undefined;
  const active = base !== undefined;
  const coverage = active ? clamp(base * 0.6 + sample.cloudCover * 0.7, 0.14, 0.8) : 0;
  return {
    active,
    coverage,
    humidity: sample.humidity,
    windX: sample.windX,
    windZ: sample.windZ,
    time,
  };
}

export class FairWeatherCumulusField {
  private seed = 0;
  private readonly active: CumulusFormation[] = [];
  private readonly lastDebug: CumulusFieldDebug = {
    active: false,
    seed: 0,
    coverage: 0,
    humidity: 0,
    windX: 0,
    windZ: 0,
    scannedCells: 0,
    activeTiles: 0,
    formations: 0,
    nearFormations: 0,
    midFormations: 0,
    horizonFormations: 0,
    tileX: 0,
    tileZ: 0,
    streamRadius: 0,
    streamMs: 0,
  };

  setSeed(seed: string | number): void {
    this.seed = hashSeedString(seed);
    this.lastDebug.seed = this.seed;
    this.active.length = 0;
  }

  reset(): void {
    this.active.length = 0;
    this.lastDebug.active = false;
    this.lastDebug.formations = 0;
    this.lastDebug.activeTiles = 0;
  }

  get formations(): readonly CumulusFormation[] {
    return this.active;
  }

  update(
    playerX: number,
    playerZ: number,
    weather: CumulusFieldWeather,
    quality: CumulusQuality,
  ): void {
    const started = now();
    this.active.length = 0;
    const settings = QUALITY[quality];
    this.lastDebug.active = weather.active;
    this.lastDebug.coverage = weather.coverage;
    this.lastDebug.humidity = weather.humidity;
    this.lastDebug.windX = weather.windX;
    this.lastDebug.windZ = weather.windZ;
    this.lastDebug.streamRadius = settings.streamRadius;

    // Position de l'observateur dans l'espace de masse d'air.
    const airPlayerX = playerX - weather.windX * weather.time;
    const airPlayerZ = playerZ - weather.windZ * weather.time;
    const centerCellX = Math.floor(airPlayerX / CELL);
    const centerCellZ = Math.floor(airPlayerZ / CELL);
    this.lastDebug.tileX = centerCellX;
    this.lastDebug.tileZ = centerCellZ;

    if (!weather.active || weather.coverage <= 0.001) {
      this.lastDebug.scannedCells = 0;
      this.lastDebug.activeTiles = 0;
      this.finishDebug(settings, now() - started);
      return;
    }

    const cellRadius = Math.ceil(settings.streamRadius / CELL) + 1;
    const radiusSq = settings.streamRadius * settings.streamRadius;
    let scanned = 0;
    let activeTiles = 0;

    for (let dj = -cellRadius; dj <= cellRadius; dj += 1) {
      for (let di = -cellRadius; di <= cellRadius; di += 1) {
        scanned += 1;
        const ci = centerCellX + di;
        const cj = centerCellZ + dj;
        // Centre jitté de la cellule (évite toute grille régulière).
        const airX = ci * CELL + CELL * (0.12 + 0.76 * hashCell(this.seed, ci, cj, 1));
        const airZ = cj * CELL + CELL * (0.12 + 0.76 * hashCell(this.seed, ci, cj, 2));
        // Champ continu de regroupement → clairières et amas, jamais 1/cellule fixe.
        const cluster = clusterField(airX, airZ, this.seed);
        const presence = clamp(weather.coverage * (0.35 + 1.35 * cluster) - 0.12, 0, 0.95);
        if (hashCell(this.seed, ci, cj, 3) >= presence) continue;
        activeTiles += 1;

        const worldX = airX + weather.windX * weather.time;
        const worldZ = airZ + weather.windZ * weather.time;
        const ddx = worldX - playerX;
        const ddz = worldZ - playerZ;
        const distSq = ddx * ddx + ddz * ddz;
        if (distSq > radiusSq) continue;

        const maturity = clamp(hashCell(this.seed, ci, cj, 6) * (0.4 + 0.8 * weather.coverage), 0, 1);
        this.active.push({
          id: (ci + CELL_ID_OFFSET) * 65536 + (cj + CELL_ID_OFFSET),
          cellX: ci,
          cellZ: cj,
          worldX,
          worldZ,
          baseHeight: lerp(340, 560, hashCell(this.seed, ci, cj, 4)) + (1 - weather.humidity) * 60,
          thickness: lerp(180, 380, hashCell(this.seed, ci, cj, 5)) * (0.7 + 0.7 * maturity),
          radius: lerp(110, 300, hashCell(this.seed, ci, cj, 7)) * (0.75 + 0.5 * weather.coverage),
          density: lerp(0.65, 1.0, hashCell(this.seed, ci, cj, 8)),
          maturity,
          coverage: weather.coverage,
          lobes: 2 + Math.floor(hashCell(this.seed, ci, cj, 9) * 3),
          seed: hashCell(this.seed, ci, cj, 10),
          distance: Math.sqrt(distSq),
        });
      }
    }

    // Budget borné : on garde les plus proches (déplacement lointain = pas de crash).
    this.active.sort((a, b) => a.distance - b.distance);
    if (this.active.length > settings.budget) this.active.length = settings.budget;

    this.lastDebug.scannedCells = scanned;
    this.lastDebug.activeTiles = activeTiles;
    this.finishDebug(settings, now() - started);
  }

  debug(): CumulusFieldDebug {
    return { ...this.lastDebug };
  }

  private finishDebug(settings: QualitySettings, streamMs: number): void {
    let near = 0;
    let mid = 0;
    let horizon = 0;
    for (const formation of this.active) {
      if (formation.distance <= settings.nearDistance) near += 1;
      else if (formation.distance <= settings.midDistance) mid += 1;
      else horizon += 1;
    }
    this.lastDebug.formations = this.active.length;
    this.lastDebug.nearFormations = near;
    this.lastDebug.midFormations = mid;
    this.lastDebug.horizonFormations = horizon;
    this.lastDebug.streamMs = streamMs;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
