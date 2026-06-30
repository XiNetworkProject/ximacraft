/**
 * Historique radar météo : enregistre de VRAIS instantanés légers de la
 * simulation au fil du temps, pour permettre une relecture (boucle des ~30
 * dernières minutes simulées) — pas seulement des prévisions vers l'avant.
 *
 * Conception :
 *  - on capture à intervalle fixe de TEMPS SIMULÉ (pas de temps réel), donc la
 *    relecture est cohérente quelle que soit la fréquence d'images ;
 *  - chaque instantané est une grille grossière (downsamplée) en coordonnées
 *    MONDE des champs radar variables (précip, type, nuages, orage, vent,
 *    pression, température, brouillard) + les événements + les éclairs récents ;
 *  - tampon circulaire borné par la rétention → mémoire constante (~2 Mo) ;
 *  - échantillonnage spatial bilinéaire + interpolation temporelle entre deux
 *    instantanés → relecture fluide.
 *
 * Aucune dépendance Three.js : logique pure (testable en headless).
 */

import { WeatherEngine } from "../WeatherEngine";
import { CELL_SIZE, PrecipKind } from "../WeatherTypes";

export interface RadarHistoryEvent {
  id: number;
  type: string;
  x: number;
  z: number;
  radius: number;
  intensity: number;
  dirX: number;
  dirZ: number;
  speed: number;
  phase: string;
}

export interface RadarHistoryStrike {
  x: number;
  z: number;
  time: number;
  intensity: number;
}

/** Champ radar interpolé renvoyé pour un point/temps donné. */
export interface RadarFieldSample {
  precipitation: number;
  precipitationKind: PrecipKind;
  cloudCover: number;
  thunderRisk: number;
  temperature: number;
  pressure: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  fogDensity: number;
}

const PRECIP_KIND_BY_CODE: PrecipKind[] = ["none", "rain", "snow", "hail"];

function precipKindCode(temperature: number, precipitation: number, thunderRisk: number): number {
  if (precipitation < 0.04) return 0;
  if (temperature <= 1) return 2;
  if (thunderRisk > 0.55 && temperature < 18 && precipitation > 0.45) return 3;
  return 1;
}

/** Un instantané downsamplé du champ météo en coordonnées monde. */
export interface RadarSnapshot {
  time: number;
  centerX: number;
  centerZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  precipitation: Float32Array;
  cloudCover: Float32Array;
  thunderRisk: Float32Array;
  temperature: Float32Array;
  pressure: Float32Array;
  windX: Float32Array;
  windZ: Float32Array;
  fogDensity: Float32Array;
  precipKind: Uint8Array;
  events: RadarHistoryEvent[];
  strikes: RadarHistoryStrike[];
}

export interface WeatherRadarHistoryOptions {
  /** Intervalle de capture en temps simulé (s). */
  recordIntervalSeconds?: number;
  /** Profondeur d'historique conservée (s). */
  retentionSeconds?: number;
  /** Demi-étendue de la grille capturée autour de l'observateur (blocs). */
  radius?: number;
  /** Résolution de la grille (blocs par cellule). */
  cellSize?: number;
}

export class WeatherRadarHistory {
  private readonly recordInterval: number;
  private readonly retention: number;
  private readonly radius: number;
  private readonly cellSize: number;
  private readonly snapshots: RadarSnapshot[] = [];
  private pendingStrikes: RadarHistoryStrike[] = [];
  private lastCaptureTime = Number.NEGATIVE_INFINITY;

  constructor(options: WeatherRadarHistoryOptions = {}) {
    this.recordInterval = options.recordIntervalSeconds ?? 20;
    this.retention = options.retentionSeconds ?? 30 * 60;
    this.radius = options.radius ?? 4096;
    // La grille reste grossière (cellSize >= CELL_SIZE) pour rester légère.
    this.cellSize = Math.max(CELL_SIZE, options.cellSize ?? CELL_SIZE);
  }

  reset(): void {
    this.snapshots.length = 0;
    this.pendingStrikes = [];
    this.lastCaptureTime = Number.NEGATIVE_INFINITY;
  }

  /** À appeler chaque frame : capture un instantané si l'intervalle est atteint. */
  update(engine: WeatherEngine, observerX: number, observerZ: number): void {
    const now = engine.state.time;
    if (now - this.lastCaptureTime < this.recordInterval) return;
    this.lastCaptureTime = now;
    this.capture(engine, observerX, observerZ, now);
    this.evict(now);
  }

  /** Enregistre un éclair (drainé dans le prochain instantané). */
  recordStrike(x: number, z: number, intensity: number, time: number): void {
    this.pendingStrikes.push({ x, z, intensity, time });
    // Garde-fou anti-débordement entre deux captures.
    if (this.pendingStrikes.length > 256) this.pendingStrikes.shift();
  }

  private capture(engine: WeatherEngine, observerX: number, observerZ: number, now: number): void {
    const cols = Math.floor((this.radius * 2) / this.cellSize) + 1;
    const rows = cols;
    const total = cols * rows;
    const precipitation = new Float32Array(total);
    const cloudCover = new Float32Array(total);
    const thunderRisk = new Float32Array(total);
    const temperature = new Float32Array(total);
    const pressure = new Float32Array(total);
    const windX = new Float32Array(total);
    const windZ = new Float32Array(total);
    const fogDensity = new Float32Array(total);
    const precipKind = new Uint8Array(total);

    const originX = observerX - this.radius;
    const originZ = observerZ - this.radius;
    for (let row = 0; row < rows; row += 1) {
      const z = originZ + row * this.cellSize;
      for (let col = 0; col < cols; col += 1) {
        const x = originX + col * this.cellSize;
        const sample = engine.sampleAt(x, z);
        const index = row * cols + col;
        precipitation[index] = sample.precipitation;
        cloudCover[index] = sample.cloudCover;
        thunderRisk[index] = sample.thunderRisk;
        temperature[index] = sample.temperature;
        pressure[index] = sample.pressure;
        windX[index] = sample.windX;
        windZ[index] = sample.windZ;
        // Brouillard radar : air saturé + calme (cohérent avec la carte live).
        fogDensity[index] =
          sample.humidity > 0.82 && sample.windSpeed < 7 ? (sample.humidity - 0.82) * 2.2 : 0;
        precipKind[index] = precipKindCode(sample.temperature, sample.precipitation, sample.thunderRisk);
      }
    }

    const events: RadarHistoryEvent[] = engine.getActiveEvents().map((event) => ({
      id: event.id,
      type: event.type,
      x: event.x,
      z: event.z,
      radius: event.radius,
      intensity: event.intensity,
      dirX: event.dirX,
      dirZ: event.dirZ,
      speed: event.speed,
      phase: event.phase,
    }));

    const strikes = this.pendingStrikes;
    this.pendingStrikes = [];

    this.snapshots.push({
      time: now,
      centerX: observerX,
      centerZ: observerZ,
      cellSize: this.cellSize,
      cols,
      rows,
      precipitation,
      cloudCover,
      thunderRisk,
      temperature,
      pressure,
      windX,
      windZ,
      fogDensity,
      precipKind,
      events,
      strikes,
    });
  }

  private evict(now: number): void {
    const cutoff = now - this.retention;
    while (this.snapshots.length > 1 && this.snapshots[0].time < cutoff) {
      this.snapshots.shift();
    }
  }

  /** Décalage (négatif, s) du plus ancien instantané disponible vs maintenant. */
  oldestOffset(engine: WeatherEngine): number {
    if (this.snapshots.length === 0) return 0;
    return this.snapshots[0].time - engine.state.time;
  }

  get count(): number {
    return this.snapshots.length;
  }

  get spanSeconds(): number {
    if (this.snapshots.length < 2) return 0;
    return this.snapshots[this.snapshots.length - 1].time - this.snapshots[0].time;
  }

  hasData(): boolean {
    return this.snapshots.length > 0;
  }

  /** Événements de l'instantané le plus proche dans le temps. */
  eventsAt(simTime: number): RadarHistoryEvent[] {
    const snap = this.nearestSnapshot(simTime);
    return snap ? snap.events : [];
  }

  /** Éclairs survenus dans une fenêtre autour de simTime. */
  strikesAt(simTime: number, window = this.recordInterval): RadarHistoryStrike[] {
    const out: RadarHistoryStrike[] = [];
    for (const snap of this.snapshots) {
      if (Math.abs(snap.time - simTime) > window + this.recordInterval) continue;
      for (const strike of snap.strikes) {
        if (Math.abs(strike.time - simTime) <= window) out.push(strike);
      }
    }
    return out;
  }

  /**
   * Échantillonne le champ radar à un instant passé `simTime` et un point monde,
   * avec interpolation spatiale (bilinéaire) et temporelle (entre 2 instantanés).
   * Renvoie null si l'historique est vide.
   */
  sampleField(simTime: number, x: number, z: number): RadarFieldSample | null {
    if (this.snapshots.length === 0) return null;
    const { lo, hi, t } = this.bracket(simTime);
    if (!lo) return null;
    if (!hi || lo === hi) return this.sampleSnapshot(lo, x, z);
    const a = this.sampleSnapshot(lo, x, z);
    const b = this.sampleSnapshot(hi, x, z);
    const lerp = (u: number, v: number) => u + (v - u) * t;
    const precipitation = lerp(a.precipitation, b.precipitation);
    const cloudCover = lerp(a.cloudCover, b.cloudCover);
    const thunderRisk = lerp(a.thunderRisk, b.thunderRisk);
    const temperature = lerp(a.temperature, b.temperature);
    const windX = lerp(a.windX, b.windX);
    const windZ = lerp(a.windZ, b.windZ);
    return {
      precipitation,
      precipitationKind: PRECIP_KIND_BY_CODE[precipKindCode(temperature, precipitation, thunderRisk)],
      cloudCover,
      thunderRisk,
      temperature,
      pressure: lerp(a.pressure, b.pressure),
      windX,
      windZ,
      windSpeed: Math.hypot(windX, windZ),
      fogDensity: lerp(a.fogDensity, b.fogDensity),
    };
  }

  private sampleSnapshot(snap: RadarSnapshot, x: number, z: number): RadarFieldSample {
    const originX = snap.centerX - ((snap.cols - 1) * snap.cellSize) / 2;
    const originZ = snap.centerZ - ((snap.rows - 1) * snap.cellSize) / 2;
    const fx = (x - originX) / snap.cellSize;
    const fz = (z - originZ) / snap.cellSize;
    const col0 = clampInt(Math.floor(fx), 0, snap.cols - 1);
    const row0 = clampInt(Math.floor(fz), 0, snap.rows - 1);
    const col1 = clampInt(col0 + 1, 0, snap.cols - 1);
    const row1 = clampInt(row0 + 1, 0, snap.rows - 1);
    const tx = clamp01(fx - col0);
    const tz = clamp01(fz - row0);
    const i00 = row0 * snap.cols + col0;
    const i10 = row0 * snap.cols + col1;
    const i01 = row1 * snap.cols + col0;
    const i11 = row1 * snap.cols + col1;
    const bil = (arr: Float32Array): number => {
      const top = arr[i00] + (arr[i10] - arr[i00]) * tx;
      const bottom = arr[i01] + (arr[i11] - arr[i01]) * tx;
      return top + (bottom - top) * tz;
    };
    const precipitation = bil(snap.precipitation);
    const thunderRisk = bil(snap.thunderRisk);
    const temperature = bil(snap.temperature);
    const windX = bil(snap.windX);
    const windZ = bil(snap.windZ);
    // Le type de précip est catégoriel : on prend la cellule la plus proche.
    const nearCol = tx < 0.5 ? col0 : col1;
    const nearRow = tz < 0.5 ? row0 : row1;
    const kindCode = snap.precipKind[nearRow * snap.cols + nearCol];
    return {
      precipitation,
      precipitationKind: PRECIP_KIND_BY_CODE[kindCode] ?? "none",
      cloudCover: bil(snap.cloudCover),
      thunderRisk,
      temperature,
      pressure: bil(snap.pressure),
      windX,
      windZ,
      windSpeed: Math.hypot(windX, windZ),
      fogDensity: bil(snap.fogDensity),
    };
  }

  private bracket(simTime: number): { lo: RadarSnapshot | null; hi: RadarSnapshot | null; t: number } {
    const list = this.snapshots;
    if (list.length === 0) return { lo: null, hi: null, t: 0 };
    if (simTime <= list[0].time) return { lo: list[0], hi: list[0], t: 0 };
    const last = list[list.length - 1];
    if (simTime >= last.time) return { lo: last, hi: last, t: 0 };
    for (let i = 0; i < list.length - 1; i += 1) {
      const lo = list[i];
      const hi = list[i + 1];
      if (simTime >= lo.time && simTime <= hi.time) {
        const span = hi.time - lo.time;
        const t = span > 1e-6 ? (simTime - lo.time) / span : 0;
        return { lo, hi, t };
      }
    }
    return { lo: last, hi: last, t: 0 };
  }

  private nearestSnapshot(simTime: number): RadarSnapshot | null {
    let best: RadarSnapshot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const snap of this.snapshots) {
      const distance = Math.abs(snap.time - simTime);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = snap;
      }
    }
    return best;
  }

  debugText(engine: WeatherEngine): string {
    if (this.snapshots.length === 0) {
      return "Radar history: empty (no snapshots recorded yet).";
    }
    const oldest = this.snapshots[0];
    const newest = this.snapshots[this.snapshots.length - 1];
    const grid = `${newest.cols}x${newest.rows}@${newest.cellSize}`;
    const strikes = this.snapshots.reduce((sum, s) => sum + s.strikes.length, 0);
    return (
      `Radar history: ${this.snapshots.length} snapshots, span=${(this.spanSeconds / 60).toFixed(1)}min ` +
      `(oldest ${(this.oldestOffset(engine) / 60).toFixed(1)}min ago), grid=${grid}, ` +
      `recordedStrikes=${strikes}, interval=${this.recordInterval}s, retention=${(this.retention / 60).toFixed(0)}min.`
    );
  }
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
