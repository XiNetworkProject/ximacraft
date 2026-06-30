import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";
import { isDryBiome, isForestBiome, isMountainBiome } from "../BiomeGenerator";
import type { BiomeId } from "../BiomeGenerator";
import type { SettlementPlan } from "../RegionPlanner";
import { RoadCostField } from "./RoadCostField";
import type { RoadKind, RoadPath, RoadPathPoint, RoadWaterContext } from "./RoadTypes";

export type RoadPathSample = {
  distance: number;
  dirX: number;
  dirZ: number;
};

export class RoadPathPlanner {
  private readonly cache = new Map<string, RoadPath>();
  private readonly cost = new RoadCostField();

  constructor(private readonly noise: Noise) {}

  pathBetween(
    a: SettlementPlan,
    b: SettlementPlan,
    biome: BiomeId,
    getHeight: (x: number, z: number) => number,
    getWater: (x: number, z: number) => RoadWaterContext,
    importance: number,
  ): RoadPath {
    const kind = this.kindFor(a, b, biome, getWater((a.centerX + b.centerX) * 0.5, (a.centerZ + b.centerZ) * 0.5), importance);
    const id = `${a.id}->${b.id}:${kind}:${Math.round(importance * 100)}`;
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (this.cache.size > 1600) this.cache.clear();

    const routed = this.routeAStar(a, b, biome, getHeight, getWater) ?? this.fallbackPath(a, b);
    const path = {
      id,
      kind,
      importance,
      width: this.widthFor(kind, importance),
      points: routed,
    };
    this.cache.set(id, path);
    return path;
  }

  samplePath(x: number, z: number, path: RoadPath): RoadPathSample {
    let best = { distance: Number.POSITIVE_INFINITY, dirX: 1, dirZ: 0 };
    for (let i = 1; i < path.points.length; i += 1) {
      const a = path.points[i - 1];
      const b = path.points[i];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const lenSq = vx * vx + vz * vz || 1;
      const t = clamp(((x - a.x) * vx + (z - a.z) * vz) / lenSq, 0, 1);
      const px = a.x + vx * t;
      const pz = a.z + vz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (distance < best.distance) {
        const len = Math.sqrt(lenSq) || 1;
        best = { distance, dirX: vx / len, dirZ: vz / len };
      }
    }
    return best;
  }

  private kindFor(a: SettlementPlan, b: SettlementPlan, biome: BiomeId, water: RoadWaterContext, importance: number): RoadKind {
    const roll = this.noise.random2D(a.centerX * 0.019 + b.centerX * 0.013, a.centerZ * 0.019 - b.centerZ * 0.013);
    if (importance > 0.82 && roll > 0.9) return "ancient";
    if (water.strength > 0.35 && water.width > 8) return "riverbank";
    if (a.kind === "village" || b.kind === "village") return "village";
    if (isMountainBiome(biome) || biome === "hills" || biome === "plateau") return "mountain";
    if (isForestBiome(biome)) return "forest";
    if (isDryBiome(biome) || biome === "tundra") return "trail";
    return importance > 0.56 ? "rural" : "trail";
  }

  private widthFor(kind: RoadKind, importance: number): number {
    switch (kind) {
      case "village": return 4.8 + importance * 1.3;
      case "ancient": return 4.2 + importance;
      case "rural": return 3.4 + importance * 0.9;
      case "riverbank": return 3.8 + importance * 0.9;
      case "forest": return 2.8 + importance * 0.7;
      case "mountain": return 2.4 + importance * 0.55;
      case "trail":
      default: return 1.9 + importance * 0.65;
    }
  }

  private routeAStar(
    a: SettlementPlan,
    b: SettlementPlan,
    biome: BiomeId,
    getHeight: (x: number, z: number) => number,
    getWater: (x: number, z: number) => RoadWaterContext,
  ): RoadPathPoint[] | null {
    const step = 32;
    const margin = 192;
    const minX = Math.floor((Math.min(a.centerX, b.centerX) - margin) / step) * step;
    const maxX = Math.ceil((Math.max(a.centerX, b.centerX) + margin) / step) * step;
    const minZ = Math.floor((Math.min(a.centerZ, b.centerZ) - margin) / step) * step;
    const maxZ = Math.ceil((Math.max(a.centerZ, b.centerZ) + margin) / step) * step;
    const width = Math.floor((maxX - minX) / step) + 1;
    const depth = Math.floor((maxZ - minZ) / step) + 1;
    if (width * depth > 5200) return null;

    const sx = clamp(Math.round((a.centerX - minX) / step), 0, width - 1);
    const sz = clamp(Math.round((a.centerZ - minZ) / step), 0, depth - 1);
    const ex = clamp(Math.round((b.centerX - minX) / step), 0, width - 1);
    const ez = clamp(Math.round((b.centerZ - minZ) / step), 0, depth - 1);
    const start = keyOf(sx, sz, width);
    const end = keyOf(ex, ez, width);
    const open: number[] = [start];
    const g = new Map<number, number>([[start, 0]]);
    const f = new Map<number, number>([[start, Math.hypot(ex - sx, ez - sz)]]);
    const came = new Map<number, number>();
    const closed = new Set<number>();
    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.42], [1, -1, 1.42], [-1, 1, 1.42], [-1, -1, 1.42],
    ] as const;
    let expansions = 0;

    while (open.length > 0 && expansions < 2600) {
      let bestIndex = 0;
      let bestF = f.get(open[0]) ?? Number.POSITIVE_INFINITY;
      for (let i = 1; i < open.length; i += 1) {
        const score = f.get(open[i]) ?? Number.POSITIVE_INFINITY;
        if (score < bestF) {
          bestF = score;
          bestIndex = i;
        }
      }
      const current = open.splice(bestIndex, 1)[0];
      if (current === end) return this.reconstruct(came, current, width, minX, minZ, step, a, b);
      if (closed.has(current)) continue;
      closed.add(current);
      expansions += 1;

      const cx = current % width;
      const cz = Math.floor(current / width);
      for (const [ox, oz, moveCost] of dirs) {
        const nx = cx + ox;
        const nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= depth) continue;
        const next = keyOf(nx, nz, width);
        if (closed.has(next)) continue;
        const wx = minX + nx * step;
        const wz = minZ + nz * step;
        const terrainCost = this.cost.costAt(wx, wz, biome, getHeight, getWater);
        const wobble = this.noise.fbm2D(wx * 0.012 + 700, wz * 0.012 - 700, 2) * 0.55;
        const tentativeG = (g.get(current) ?? 0) + moveCost * Math.max(1, terrainCost + wobble);
        if (tentativeG >= (g.get(next) ?? Number.POSITIVE_INFINITY)) continue;
        came.set(next, current);
        g.set(next, tentativeG);
        f.set(next, tentativeG + Math.hypot(ex - nx, ez - nz) * 1.35);
        if (!open.includes(next)) open.push(next);
      }
    }

    return null;
  }

  private reconstruct(
    came: Map<number, number>,
    current: number,
    width: number,
    minX: number,
    minZ: number,
    step: number,
    a: SettlementPlan,
    b: SettlementPlan,
  ): RoadPathPoint[] {
    const reversed: RoadPathPoint[] = [];
    let cursor = current;
    while (true) {
      const gx = cursor % width;
      const gz = Math.floor(cursor / width);
      reversed.push({ x: minX + gx * step, z: minZ + gz * step });
      const prev = came.get(cursor);
      if (prev === undefined) break;
      cursor = prev;
    }
    reversed.reverse();
    reversed[0] = { x: a.centerX, z: a.centerZ };
    reversed[reversed.length - 1] = { x: b.centerX, z: b.centerZ };
    return this.simplify(reversed);
  }

  private fallbackPath(a: SettlementPlan, b: SettlementPlan): RoadPathPoint[] {
    const vx = b.centerX - a.centerX;
    const vz = b.centerZ - a.centerZ;
    const len = Math.hypot(vx, vz) || 1;
    const nx = -vz / len;
    const nz = vx / len;
    const bendA = (this.noise.random2D(a.centerX * 0.13 + b.centerX, a.centerZ * 0.13 - b.centerZ) - 0.5) * 210;
    const bendB = (this.noise.random2D(a.centerX * 0.17 - b.centerX, a.centerZ * 0.17 + b.centerZ) - 0.5) * 160;
    const points: RoadPathPoint[] = [];
    for (let i = 0; i <= 9; i += 1) {
      const t = i / 9;
      const bend = Math.sin(Math.PI * t) * (bendA * (1 - t) + bendB * t);
      points.push({ x: a.centerX + vx * t + nx * bend, z: a.centerZ + vz * t + nz * bend });
    }
    return points;
  }

  private simplify(points: RoadPathPoint[]): RoadPathPoint[] {
    if (points.length <= 4) return points;
    const simplified: RoadPathPoint[] = [points[0]];
    for (let i = 1; i < points.length - 1; i += 1) {
      const prev = simplified[simplified.length - 1];
      const next = points[i + 1];
      const vx = next.x - prev.x;
      const vz = next.z - prev.z;
      const len = Math.hypot(vx, vz) || 1;
      const side = Math.abs((points[i].x - prev.x) * (vz / len) - (points[i].z - prev.z) * (vx / len));
      if (side > 12 || Math.hypot(points[i].x - prev.x, points[i].z - prev.z) > 96) simplified.push(points[i]);
    }
    simplified.push(points[points.length - 1]);
    return simplified;
  }
}

function keyOf(x: number, z: number, width: number): number {
  return z * width + x;
}
