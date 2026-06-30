/**
 * Hydrologie d'écoulement régionale et DÉTERMINISTE, calée sur le relief réel.
 *
 * Au lieu de définir les rivières avec des axes de bruit déformés (décorrélés du
 * terrain), on construit un vrai réseau hydrographique :
 *
 *   RegionalHeightField  : altitude de base échantillonnée sur un treillis grossier
 *   FlowDirectionMap     : D8, chaque nœud s'écoule vers son voisin le plus bas
 *   FlowAccumulationMap  : nombre de nœuds amont drainés (BFS inverse borné)
 *   RiverGraph           : segments nœud → nœud-aval, classés par accumulation
 *
 * Propriétés garanties par construction :
 *   - l'eau descend toujours la pente du terrain réel ;
 *   - l'accumulation (donc la largeur) croît vers l'aval ;
 *   - les chenaux sont continus (le voisin aval d'un chenal est aussi un chenal) ;
 *   - les sources sont en altitude, les embouchures en contrebas.
 *
 * Tout est mis en cache par nœud → coût borné et amorti. Aucune dépendance Three.js.
 */

import { clamp } from "../../utils/MathUtils";

/** Décalages D8 (8 voisins), dans l'ordre N, NE, E, SE, S, SW, W, NW. */
const D8: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

export type RiverCategory = "dry" | "source" | "stream" | "river" | "great_river";

export interface FlowChannelRecord {
  active: boolean;
  /** Extrémités monde du segment nœud → nœud-aval. */
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  /** Largeurs (blocs) à l'amont et à l'aval du segment. */
  width0: number;
  width1: number;
  flowX: number;
  flowZ: number;
  accumulation: number;
  flow: number;
  source: number;
  drop: number;
  meander: number;
}

export interface RegionalFlowOptions {
  cellSize?: number;
  /** Seuils d'accumulation (nb de nœuds amont) pour la classification. */
  streamThreshold?: number;
  riverThreshold?: number;
  greatRiverThreshold?: number;
  sourceThreshold?: number;
  /** Hauteur max d'un seuil franchissable par débordement. */
  breachLimit?: number;
  /** Plafond du BFS inverse d'accumulation (perf). */
  maxAccumulation?: number;
}

export class RegionalFlowMap {
  readonly cellSize: number;
  readonly streamThreshold: number;
  readonly riverThreshold: number;
  readonly greatRiverThreshold: number;
  readonly sourceThreshold: number;
  /** Hauteur max d'un seuil franchissable par débordement (sinon = cuvette/lac). */
  readonly breachLimit: number;
  private readonly maxAccumulation: number;

  private readonly heightCache = new Map<number, number>();
  private readonly flowDirCache = new Map<number, number>();
  private readonly accumCache = new Map<number, number>();
  private readonly channelCache = new Map<number, FlowChannelRecord>();

  constructor(
    private readonly heightProvider: (x: number, z: number) => number,
    options: RegionalFlowOptions = {},
  ) {
    this.cellSize = options.cellSize ?? 72;
    this.streamThreshold = options.streamThreshold ?? 14;
    this.riverThreshold = options.riverThreshold ?? 70;
    this.greatRiverThreshold = options.greatRiverThreshold ?? 180;
    this.sourceThreshold = options.sourceThreshold ?? 4;
    this.breachLimit = options.breachLimit ?? 4;
    this.maxAccumulation = options.maxAccumulation ?? 12000;
  }

  // --- Treillis grossier ----------------------------------------------------

  private nodeKey(i: number, j: number): number {
    // Clé entière compacte (offset pour gérer les coordonnées négatives).
    return (i + 32768) * 65536 + (j + 32768);
  }

  nodeHeight(i: number, j: number): number {
    const key = this.nodeKey(i, j);
    const cached = this.heightCache.get(key);
    if (cached !== undefined) return cached;
    if (this.heightCache.size > 600_000) this.heightCache.clear();
    const h = this.heightProvider(i * this.cellSize, j * this.cellSize);
    this.heightCache.set(key, h);
    return h;
  }

  /** Direction D8 de plus forte pente (index 0..7) ou -1 si cuvette (pit). */
  flowDir(i: number, j: number): number {
    const key = this.nodeKey(i, j);
    const cached = this.flowDirCache.get(key);
    if (cached !== undefined) return cached;
    if (this.flowDirCache.size > 600_000) this.flowDirCache.clear();
    const h = this.nodeHeight(i, j);
    let best = -1;
    let bestDrop = 0;
    let lowest = -1;
    let lowestH = Number.POSITIVE_INFINITY;
    for (let d = 0; d < 8; d += 1) {
      const [di, dj] = D8[d];
      const nh = this.nodeHeight(i + di, j + dj);
      // Pente normalisée (diagonale plus longue) pour un D8 correct.
      const dist = di !== 0 && dj !== 0 ? 1.4142 : 1;
      const drop = (h - nh) / dist;
      if (drop > bestDrop) {
        bestDrop = drop;
        best = d;
      }
      if (nh < lowestH) {
        lowestH = nh;
        lowest = d;
      }
    }
    // Pas de voisin franchement plus bas (cuvette) : on déborde par le seuil le
    // plus bas s'il est peu élevé (dépression peu profonde) ; sinon vrai bassin
    // (lac/mer) → puits terminal géré par LakePlanner.
    if (best < 0 && lowest >= 0 && lowestH - h <= this.breachLimit) {
      best = lowest;
    }
    this.flowDirCache.set(key, best);
    return best;
  }

  downstream(i: number, j: number): { i: number; j: number } | null {
    const d = this.flowDir(i, j);
    if (d < 0) return null;
    const [di, dj] = D8[d];
    return { i: i + di, j: j + dj };
  }

  /** Nombre de nœuds amont (self inclus) drainés par (i,j). BFS inverse borné. */
  accumulation(i: number, j: number): number {
    const key = this.nodeKey(i, j);
    const cached = this.accumCache.get(key);
    if (cached !== undefined) return cached;
    if (this.accumCache.size > 400_000) this.accumCache.clear();

    const visited = new Set<number>();
    const stack: Array<[number, number]> = [[i, j]];
    let count = 0;
    while (stack.length > 0 && count < this.maxAccumulation) {
      const [ci, cj] = stack.pop()!;
      const ck = this.nodeKey(ci, cj);
      if (visited.has(ck)) continue;
      visited.add(ck);
      count += 1;
      // Voisins qui s'écoulent VERS (ci,cj) = amont direct.
      for (let d = 0; d < 8; d += 1) {
        const [di, dj] = D8[d];
        const ni = ci + di;
        const nj = cj + dj;
        if (visited.has(this.nodeKey(ni, nj))) continue;
        const down = this.downstream(ni, nj);
        if (down && down.i === ci && down.j === cj) stack.push([ni, nj]);
      }
    }
    this.accumCache.set(key, count);
    return count;
  }

  classify(accumulation: number): RiverCategory {
    if (accumulation >= this.greatRiverThreshold) return "great_river";
    if (accumulation >= this.riverThreshold) return "river";
    if (accumulation >= this.streamThreshold) return "stream";
    if (accumulation >= this.sourceThreshold) return "source";
    return "dry";
  }

  /** Largeur (blocs) du chenal pour une accumulation donnée (loi en √, type Hack). */
  widthFor(accumulation: number): number {
    if (accumulation < this.sourceThreshold) return 0;
    return clamp(1.4 + Math.sqrt(accumulation) * 0.82, 0, 26);
  }

  /** Enregistrement de chenal (segment nœud → nœud-aval) pour le rendu/sampling. */
  channelRecord(i: number, j: number): FlowChannelRecord {
    const key = this.nodeKey(i, j);
    const cached = this.channelCache.get(key);
    if (cached) return cached;
    if (this.channelCache.size > 300_000) this.channelCache.clear();

    const accumulation = this.accumulation(i, j);
    const down = this.downstream(i, j);
    let record: FlowChannelRecord;
    if (accumulation < this.streamThreshold || !down) {
      record = inactiveChannel();
    } else {
      const downAccum = this.accumulation(down.i, down.j);
      const sx = i * this.cellSize;
      const sz = j * this.cellSize;
      const ex = down.i * this.cellSize;
      const ez = down.j * this.cellSize;
      const vx = ex - sx;
      const vz = ez - sz;
      const len = Math.hypot(vx, vz) || 1;
      const drop = this.nodeHeight(i, j) - this.nodeHeight(down.i, down.j);
      record = {
        active: true,
        startX: sx,
        startZ: sz,
        endX: ex,
        endZ: ez,
        width0: this.widthFor(accumulation),
        width1: this.widthFor(Math.max(accumulation, downAccum)),
        flowX: vx / len,
        flowZ: vz / len,
        accumulation,
        flow: clamp(0.35 + Math.sqrt(accumulation) * 0.05, 0, 1),
        source: accumulation < this.riverThreshold ? clamp((this.riverThreshold - accumulation) / this.riverThreshold, 0, 1) : 0,
        drop,
        meander: 4 + this.widthFor(accumulation) * 1.4,
      };
    }
    this.channelCache.set(key, record);
    return record;
  }

  worldToNode(x: number, z: number): { i: number; j: number } {
    return { i: Math.round(x / this.cellSize), j: Math.round(z / this.cellSize) };
  }

  reset(): void {
    this.heightCache.clear();
    this.flowDirCache.clear();
    this.accumCache.clear();
    this.channelCache.clear();
  }
}

function inactiveChannel(): FlowChannelRecord {
  return {
    active: false,
    startX: 0,
    startZ: 0,
    endX: 0,
    endZ: 0,
    width0: 0,
    width1: 0,
    flowX: 0,
    flowZ: 0,
    accumulation: 0,
    flow: 0,
    source: 0,
    drop: 0,
    meander: 0,
  };
}
