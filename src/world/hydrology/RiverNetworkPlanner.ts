import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";
import { WatershedSample } from "./WatershedMap";

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
}

type RegionalRiverSegment = {
  active: boolean;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  width: number;
  flow: number;
  meander: number;
  source: number;
};

export class RiverNetworkPlanner {
  private readonly cellSize = 384;
  private readonly segmentCache = new Map<string, RegionalRiverSegment>();

  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, height: number, watershed: WatershedSample): RiverNetworkSample {
    const cellX = Math.floor(x / this.cellSize);
    const cellZ = Math.floor(z / this.cellSize);
    let bestChannel = 0;
    let bestBank = 0;
    let bestWidth = 0;
    let bestFlow = 0;
    let bestFlowX = 0;
    let bestFlowZ = 0;
    let bestSource = 0;

    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const segment = this.segmentForCell(cellX + dx, cellZ + dz);
        if (!segment.active) continue;
        const distance = distanceToSegment(x, z, segment.startX, segment.startZ, segment.endX, segment.endZ);
        const lengthFade = smoothRange(0.02, 0.14, distance.t) * (1 - smoothRange(0.86, 0.98, distance.t));
        const meander = this.noise.fbm2D((x + segment.startX) * 0.0046, (z - segment.endZ) * 0.0046, 3) * segment.meander * lengthFade;
        const warpedDistance = Math.abs(distance.signed + meander);
        const width = segment.width * (0.74 + watershed.catchment * 0.34 + watershed.lowland * 0.24);
        const channel = (1 - smoothRange(width * 0.22, width, warpedDistance)) * lengthFade * segment.flow;
        const bank = (1 - smoothRange(width, width + 7 + width * 0.85, warpedDistance)) * lengthFade * (0.55 + segment.flow * 0.45);
        if (channel > bestChannel) {
          const vx = segment.endX - segment.startX;
          const vz = segment.endZ - segment.startZ;
          const len = Math.hypot(vx, vz) || 1;
          bestChannel = channel;
          bestWidth = width;
          bestFlow = segment.flow;
          bestFlowX = vx / len;
          bestFlowZ = vz / len;
          bestSource = segment.source * (1 - distance.t);
        }
        bestBank = Math.max(bestBank, bank);
      }
    }

    const sourceBoost = clamp((height - 74) / 44, 0, 1) * clamp(watershed.catchment + 0.18, 0, 1);
    const feederMeander = this.noise.fbm2D(x * 0.0031 - 120, z * 0.0031 + 920, 3) * (11 + sourceBoost * 13);
    const feederAxis = Math.abs(this.noise.noise2D((x + feederMeander) * 0.0042, (z - feederMeander) * 0.0042));
    const feeder = (1 - smoothRange(0.012, 0.033 + sourceBoost * 0.022, feederAxis)) * (0.24 + sourceBoost * 0.66) * (0.62 + watershed.valley * 0.38);

    const river = bestWidth >= 5.4 ? bestChannel : bestChannel * 0.42;
    const stream = Math.max(bestWidth < 7.2 ? bestChannel * 0.9 : bestChannel * 0.28, feeder);
    const localSlope = Math.abs(this.noise.fbm2D(x * 0.009 + 33, z * 0.009 - 71, 2));
    const waterfallRisk = bestChannel > 0.58 && height > 82 ? clamp((localSlope - 0.5) / 0.32, 0, 1) : 0;
    return {
      river: clamp(river * (0.7 + watershed.flowBias * 0.42), 0, 1),
      stream: clamp(stream, 0, 1),
      bank: clamp(Math.max(bestBank, river, stream * 0.58), 0, 1),
      waterfallRisk,
      width: clamp(bestWidth, 0, 24),
      flowX: bestFlowX,
      flowZ: bestFlowZ,
      current: clamp(bestFlow * Math.max(bestChannel, stream * 0.62), 0, 1),
      source: clamp(Math.max(bestSource, sourceBoost * feeder), 0, 1),
    };
  }

  private segmentForCell(cellX: number, cellZ: number): RegionalRiverSegment {
    const key = `${cellX},${cellZ}`;
    const cached = this.segmentCache.get(key);
    if (cached) return cached;
    if (this.segmentCache.size > 16_000) this.segmentCache.clear();

    const elevation = this.cellElevation(cellX, cellZ);
    const moisture = this.cellMoisture(cellX, cellZ);
    const valley = this.cellValley(cellX, cellZ);
    const activeChance = clamp(0.18 + moisture * 0.22 + valley * 0.18 + Math.max(0, elevation - 0.48) * 0.2, 0.12, 0.74);
    const roll = this.noise.random2D(cellX * 911 + 17, cellZ * 911 - 43);
    if (roll > activeChance) {
      const inactive = { active: false, startX: 0, startZ: 0, endX: 0, endZ: 0, width: 0, flow: 0, meander: 0, source: 0 };
      this.segmentCache.set(key, inactive);
      return inactive;
    }

    const start = this.cellCenter(cellX, cellZ);
    let bestX = cellX;
    let bestZ = cellZ + 1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const nx = cellX + dx;
        const nz = cellZ + dz;
        const score =
          this.cellElevation(nx, nz) -
          this.cellMoisture(nx, nz) * 0.18 -
          this.cellValley(nx, nz) * 0.2 +
          this.noise.random2D(nx * 127 + cellX, nz * 127 + cellZ) * 0.045;
        if (score < bestScore) {
          bestScore = score;
          bestX = nx;
          bestZ = nz;
        }
      }
    }

    const end = this.cellCenter(bestX, bestZ);
    const downstream = clamp(elevation - bestScore + 0.16, 0, 1);
    const basinFlow = clamp((1 - bestScore) * 0.52 + moisture * 0.28 + valley * 0.34, 0, 1);
    const width = 2.2 + basinFlow * 8.5 + downstream * 5.2 + roll * 1.6;
    const segment = {
      active: true,
      startX: start.x,
      startZ: start.z,
      endX: end.x,
      endZ: end.z,
      width,
      flow: clamp(0.42 + basinFlow * 0.52 + downstream * 0.28, 0, 1),
      meander: 5 + width * 1.7 + valley * 13,
      source: clamp((elevation - 0.54) / 0.34, 0, 1),
    };
    this.segmentCache.set(key, segment);
    return segment;
  }

  private cellCenter(cellX: number, cellZ: number): { x: number; z: number } {
    const jitter = this.cellSize * 0.34;
    return {
      x: (cellX + 0.5) * this.cellSize + (this.noise.random2D(cellX * 353 + 5, cellZ * 353 - 17) - 0.5) * jitter,
      z: (cellZ + 0.5) * this.cellSize + (this.noise.random2D(cellX * 389 - 23, cellZ * 389 + 11) - 0.5) * jitter,
    };
  }

  private cellElevation(cellX: number, cellZ: number): number {
    return clamp(
      (this.noise.fbm2D(cellX * 0.31 + 40, cellZ * 0.31 - 20, 4) + 1) * 0.34 +
      (this.noise.fbm2D(cellX * 0.09 - 230, cellZ * 0.09 + 170, 3) + 1) * 0.16,
      0,
      1,
    );
  }

  private cellMoisture(cellX: number, cellZ: number): number {
    return clamp((this.noise.fbm2D(cellX * 0.22 - 90, cellZ * 0.22 + 110, 3) + 1) * 0.5, 0, 1);
  }

  private cellValley(cellX: number, cellZ: number): number {
    return clamp((this.noise.fbm2D(cellX * 0.44 + 160, cellZ * 0.44 - 210, 3) + 1) * 0.5, 0, 1);
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
