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

/** Sous-régimes déterministes de ciel de beau temps (jamais orageux/pluvieux). */
export type CumulusRegimeName =
  | "crystal_clear"
  | "isolated_humilis"
  | "sparse_fair_cumulus"
  | "classic_fair_cumulus"
  | "scattered_mediocris"
  | "broken_fair_weather"
  | "dominant_cumulus_day"
  | "humid_summer_cumulus";

interface CumulusRegimeProfile {
  coverageMul: number;
  /** >1 = plus espacé (moins de nuages) ; <1 = plus dense. */
  spacing: number;
  /** Exposant de contraste du champ de regroupement (amas + grandes clairières). */
  clusterSharpen: number;
  sizeMul: number;
  thicknessMul: number;
  maturityMul: number;
  /** Probabilité, par région, d'une formation dominante nettement plus grosse. */
  dominantChance: number;
}

const CUMULUS_REGIMES: Record<CumulusRegimeName, CumulusRegimeProfile> = {
  crystal_clear: { coverageMul: 0.05, spacing: 2.6, clusterSharpen: 1.6, sizeMul: 0.7, thicknessMul: 0.65, maturityMul: 0.35, dominantChance: 0 },
  isolated_humilis: { coverageMul: 0.16, spacing: 2.1, clusterSharpen: 1.5, sizeMul: 0.72, thicknessMul: 0.62, maturityMul: 0.3, dominantChance: 0 },
  sparse_fair_cumulus: { coverageMul: 0.42, spacing: 1.55, clusterSharpen: 1.25, sizeMul: 0.86, thicknessMul: 0.85, maturityMul: 0.5, dominantChance: 0.08 },
  classic_fair_cumulus: { coverageMul: 0.78, spacing: 1.0, clusterSharpen: 1.0, sizeMul: 1.0, thicknessMul: 1.0, maturityMul: 0.6, dominantChance: 0.18 },
  scattered_mediocris: { coverageMul: 0.98, spacing: 0.85, clusterSharpen: 1.0, sizeMul: 1.22, thicknessMul: 1.3, maturityMul: 0.82, dominantChance: 0.24 },
  broken_fair_weather: { coverageMul: 1.2, spacing: 0.72, clusterSharpen: 2.1, sizeMul: 1.12, thicknessMul: 1.05, maturityMul: 0.7, dominantChance: 0.14 },
  dominant_cumulus_day: { coverageMul: 0.5, spacing: 1.35, clusterSharpen: 1.3, sizeMul: 0.92, thicknessMul: 1.0, maturityMul: 0.62, dominantChance: 0.92 },
  humid_summer_cumulus: { coverageMul: 1.0, spacing: 0.92, clusterSharpen: 1.1, sizeMul: 1.4, thicknessMul: 1.65, maturityMul: 0.96, dominantChance: 0.34 },
};

const REGION_CELLS = 6;
/** Maille grossière des formations dominantes (≈ plusieurs km) → 1 à 2 en vue. */
const DOMINANT_REGION_CELLS = 8;
const DOMINANT_SIZE_MUL = 2.7;
const DOMINANT_THICKNESS_MUL = 2.3;

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
  dominant: boolean;
  distance: number;
}

export interface CumulusFieldDebug {
  active: boolean;
  seed: number;
  regime: CumulusRegimeName;
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
  blueSkyFraction: number;
  spacing: number;
  dominant: boolean;
  largestRadius: number;
  largestMaturity: number;
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
  private forcedRegime: CumulusRegimeName | null = null;
  private readonly active: CumulusFormation[] = [];
  private readonly lastDebug: CumulusFieldDebug = {
    active: false,
    seed: 0,
    regime: "classic_fair_cumulus",
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
    blueSkyFraction: 1,
    spacing: 0,
    dominant: false,
    largestRadius: 0,
    largestMaturity: 0,
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

  /** Force un sous-régime (Visual Lab). `null` = régime dérivé du ciel/zone. */
  setRegime(regime: CumulusRegimeName | null): void {
    this.forcedRegime = regime;
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

    const regime = this.deriveRegime(weather, centerCellX, centerCellZ);
    const profile = CUMULUS_REGIMES[regime];
    this.lastDebug.regime = regime;
    this.lastDebug.spacing = Math.round(CELL * profile.spacing);
    const cov = clamp(weather.coverage * profile.coverageMul, 0, 1);

    if (!weather.active || cov <= 0.001) {
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
        // Formation dominante déterministe par région (une grosse masse + petites autour).
        const isDominant = this.isDominantCell(ci, cj, profile.dominantChance);
        // Champ continu de regroupement → clairières et amas, jamais 1/cellule fixe.
        const cluster = Math.pow(clusterField(airX, airZ, this.seed), profile.clusterSharpen);
        let presence = clamp(cov * (0.35 + 1.5 * cluster) - 0.1, 0, 0.96) / profile.spacing;
        if (isDominant) presence = 1;
        if (hashCell(this.seed, ci, cj, 3) >= presence) continue;
        activeTiles += 1;

        const worldX = airX + weather.windX * weather.time;
        const worldZ = airZ + weather.windZ * weather.time;
        const ddx = worldX - playerX;
        const ddz = worldZ - playerZ;
        const distSq = ddx * ddx + ddz * ddz;
        if (distSq > radiusSq) continue;

        let maturity = clamp((0.35 + 0.7 * hashCell(this.seed, ci, cj, 6)) * profile.maturityMul, 0, 1);
        let radius = lerp(105, 330, hashCell(this.seed, ci, cj, 7)) * (0.7 + 0.55 * cov) * profile.sizeMul;
        let thickness = lerp(170, 410, hashCell(this.seed, ci, cj, 5)) * (0.65 + 0.85 * maturity) * profile.thicknessMul;
        let density = lerp(0.6, 1.0, hashCell(this.seed, ci, cj, 8));
        let lobes = 2 + Math.floor(hashCell(this.seed, ci, cj, 9) * 3);
        if (isDominant) {
          radius *= DOMINANT_SIZE_MUL;
          thickness *= DOMINANT_THICKNESS_MUL;
          maturity = clamp(maturity * 1.3 + 0.32, 0, 1);
          density = Math.max(density, 0.9);
          lobes = 4;
        }

        this.active.push({
          id: (ci + CELL_ID_OFFSET) * 65536 + (cj + CELL_ID_OFFSET),
          cellX: ci,
          cellZ: cj,
          worldX,
          worldZ,
          baseHeight: lerp(340, 620, hashCell(this.seed, ci, cj, 4)) + (1 - weather.humidity) * 70,
          thickness,
          radius,
          density,
          maturity,
          coverage: cov,
          lobes,
          seed: hashCell(this.seed, ci, cj, 10),
          dominant: isDominant,
          distance: Math.sqrt(distSq),
        });
      }
    }

    // Budget borné : dominantes prioritaires, puis les plus proches.
    this.active.sort((a, b) => (Number(b.dominant) - Number(a.dominant)) || (a.distance - b.distance));
    if (this.active.length > settings.budget) this.active.length = settings.budget;

    this.lastDebug.scannedCells = scanned;
    this.lastDebug.activeTiles = activeTiles;
    this.finishDebug(settings, now() - started);
  }

  debug(): CumulusFieldDebug {
    return { ...this.lastDebug };
  }

  private deriveRegime(weather: CumulusFieldWeather, centerCellX: number, centerCellZ: number): CumulusRegimeName {
    if (this.forcedRegime) return this.forcedRegime;
    // Variation par ZONE (le monde n'est pas partout le même ciel).
    const rx = Math.floor(centerCellX / (REGION_CELLS * 3));
    const rz = Math.floor(centerCellZ / (REGION_CELLS * 3));
    const zone = hashCell(this.seed, rx, rz, 71);
    const cover = weather.coverage;
    const humid = weather.humidity;
    if (cover < 0.2) return zone < 0.5 ? "isolated_humilis" : "sparse_fair_cumulus";
    if (humid > 0.72) return zone < 0.6 ? "humid_summer_cumulus" : "scattered_mediocris";
    if (cover > 0.6) return zone < 0.4 ? "broken_fair_weather" : "scattered_mediocris";
    if (zone < 0.14) return "dominant_cumulus_day";
    if (zone < 0.44) return "sparse_fair_cumulus";
    return "classic_fair_cumulus";
  }

  private isDominantCell(ci: number, cj: number, chance: number): boolean {
    if (chance <= 0) return false;
    const rx = Math.floor(ci / DOMINANT_REGION_CELLS);
    const rz = Math.floor(cj / DOMINANT_REGION_CELLS);
    if (hashCell(this.seed, rx, rz, 51) >= chance) return false;
    const anchorI = rx * DOMINANT_REGION_CELLS + Math.floor(hashCell(this.seed, rx, rz, 52) * DOMINANT_REGION_CELLS);
    const anchorJ = rz * DOMINANT_REGION_CELLS + Math.floor(hashCell(this.seed, rx, rz, 53) * DOMINANT_REGION_CELLS);
    return ci === anchorI && cj === anchorJ;
  }

  private finishDebug(settings: QualitySettings, streamMs: number): void {
    let near = 0;
    let mid = 0;
    let horizon = 0;
    let largestRadius = 0;
    let largestMaturity = 0;
    let dominant = false;
    for (const formation of this.active) {
      if (formation.distance <= settings.nearDistance) near += 1;
      else if (formation.distance <= settings.midDistance) mid += 1;
      else horizon += 1;
      if (formation.radius > largestRadius) {
        largestRadius = formation.radius;
        largestMaturity = formation.maturity;
      }
      dominant = dominant || formation.dominant;
    }
    this.lastDebug.formations = this.active.length;
    this.lastDebug.nearFormations = near;
    this.lastDebug.midFormations = mid;
    this.lastDebug.horizonFormations = horizon;
    this.lastDebug.blueSkyFraction = this.lastDebug.scannedCells > 0
      ? clamp(1 - this.lastDebug.activeTiles / this.lastDebug.scannedCells, 0, 1)
      : 1;
    this.lastDebug.dominant = dominant;
    this.lastDebug.largestRadius = largestRadius;
    this.lastDebug.largestMaturity = largestMaturity;
    this.lastDebug.streamMs = streamMs;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
