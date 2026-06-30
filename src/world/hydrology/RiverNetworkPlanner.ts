import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";
import { WatershedSample } from "./WatershedMap";
import { RegionalFlowMap, RiverCategory } from "./RegionalFlowMap";

export interface RiverNetworkSample {
  river: number;
  stream: number;
  bank: number;
  waterfallRisk: number;
  width: number;
  flowX: number;
  flowZ: number;
  current: number;
  source: number;
  category: RiverCategory;
}

/**
 * Réseau hydrographique : transforme le graphe d'écoulement réel
 * ({@link RegionalFlowMap}) en un champ continu (intensité de chenal, berge,
 * largeur, courant, source) échantillonnable par colonne.
 *
 * Les rivières suivent désormais la pente réelle du terrain (D8), leur largeur
 * croît avec l'accumulation amont, et les chenaux sont continus — fini les axes
 * de bruit déformés décorrélés du relief.
 */
export class RiverNetworkPlanner {
  readonly flow: RegionalFlowMap;

  constructor(
    private readonly noise: Noise,
    heightProvider: (x: number, z: number) => number,
  ) {
    this.flow = new RegionalFlowMap(heightProvider);
  }

  sample(x: number, z: number, height: number, watershed: WatershedSample): RiverNetworkSample {
    const node = this.flow.worldToNode(x, z);
    let bestChannel = 0;
    let bestBank = 0;
    let bestWidth = 0;
    let bestFlow = 0;
    let bestFlowX = 0;
    let bestFlowZ = 0;
    let bestAccum = 0;
    let bestSource = 0;
    let bestDrop = 0;

    for (let dj = -2; dj <= 2; dj += 1) {
      for (let di = -2; di <= 2; di += 1) {
        const segment = this.flow.channelRecord(node.i + di, node.j + dj);
        if (!segment.active) continue;
        const d = distanceToSegment(x, z, segment.startX, segment.startZ, segment.endX, segment.endZ);
        // Méandre appliqué APRÈS le tracé logique (léger, fondu aux extrémités).
        const lengthFade = smoothRange(0.0, 0.08, d.t) * (1 - smoothRange(0.92, 1.0, d.t));
        const meander = this.noise.fbm2D((x + segment.startX) * 0.0052, (z - segment.endZ) * 0.0052, 3) * segment.meander * lengthFade;
        const width = segment.width0 + (segment.width1 - segment.width0) * d.t;
        const warped = Math.abs(d.signed + meander);
        const channel = (1 - smoothRange(width * 0.32, width, warped));
        const bank = (1 - smoothRange(width, width + 7 + width * 0.85, warped)) * (0.55 + segment.flow * 0.45);
        if (channel > bestChannel) {
          bestChannel = channel;
          bestWidth = width;
          bestFlow = segment.flow;
          bestFlowX = segment.flowX;
          bestFlowZ = segment.flowZ;
          bestAccum = segment.accumulation;
          bestSource = segment.source * (1 - d.t);
          bestDrop = segment.drop;
        }
        bestBank = Math.max(bestBank, bank);
      }
    }

    // Lissage léger par les basses terres (zones de plaine inondable).
    const lowlandBoost = 1 + watershed.lowland * 0.12;
    const river = (bestWidth >= 5.4 ? bestChannel : bestChannel * 0.42) * lowlandBoost;
    const stream = bestWidth < 7.2 ? bestChannel * 0.92 : bestChannel * 0.3;
    const localSlopeRisk = bestDrop / this.flow.cellSize;
    const waterfallRisk = bestChannel > 0.55 && height > 82 ? clamp((localSlopeRisk - 0.16) / 0.2, 0, 1) : 0;

    return {
      river: clamp(river, 0, 1),
      stream: clamp(stream, 0, 1),
      bank: clamp(Math.max(bestBank, river, stream * 0.58), 0, 1),
      waterfallRisk,
      width: clamp(bestWidth, 0, 26),
      flowX: bestFlowX,
      flowZ: bestFlowZ,
      current: clamp(bestFlow * Math.max(bestChannel, stream * 0.62), 0, 1),
      source: clamp(Math.max(bestSource * bestChannel, 0), 0, 1),
      category: this.flow.classify(bestAccum),
    };
  }

  /** Diagnostic ponctuel (pour /world debug flow). */
  debugAt(x: number, z: number): string {
    const node = this.flow.worldToNode(x, z);
    const dir = this.flow.flowDir(node.i, node.j);
    const accum = this.flow.accumulation(node.i, node.j);
    const down = this.flow.downstream(node.i, node.j);
    const here = this.flow.nodeHeight(node.i, node.j);
    const downH = down ? this.flow.nodeHeight(down.i, down.j) : here;
    const compass = dir < 0 ? "pit" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][dir];
    return (
      `Flow node(${node.i},${node.j}) h=${here} → ${compass} h=${downH} ` +
      `accum=${accum} category=${this.flow.classify(accum)} width=${this.flow.widthFor(accum).toFixed(1)}blk`
    );
  }
}

function smoothRange(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { distance: number; signed: number; t: number } {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const len2 = vx * vx + vz * vz;
  if (len2 <= 0.0001) {
    const distance = Math.hypot(px - ax, pz - az);
    return { distance, signed: distance, t: 0 };
  }
  const t = clamp((wx * vx + wz * vz) / len2, 0, 1);
  const nearestX = ax + vx * t;
  const nearestZ = az + vz * t;
  const distance = Math.hypot(px - nearestX, pz - nearestZ);
  const len = Math.sqrt(len2);
  const signed = ((px - nearestX) * vz - (pz - nearestZ) * vx) / len;
  return { distance, signed, t };
}
