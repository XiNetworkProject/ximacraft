import { SEA_LEVEL } from "../utils/Constants";
import { clamp } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";
import { BiomeId, isMountainBiome } from "./BiomeGenerator";
import { BlockId } from "./BlockTypes";

export type SettlementKind = "hamlet" | "village";

export type SettlementPlan = {
  id: string;
  kind: SettlementKind;
  centerX: number;
  centerZ: number;
  radius: number;
};

export type RegionColumnBlock = {
  dy: number;
  block: BlockId;
};

export type RegionColumnPlan = {
  surface?: BlockId;
  blocks: RegionColumnBlock[];
  blocksDecoration: boolean;
};

type RoadSample = {
  strength: number;
  dirX: number;
  dirZ: number;
  bridge: boolean;
};

export class RegionPlanner {
  private readonly settlementCellCache = new Map<string, SettlementPlan | null>();
  private readonly settlementAcceptanceCache = new Map<string, boolean>();

  constructor(private readonly noise: Noise) {}

  sampleColumn(x: number, z: number, height: number, biome: BiomeId, getHeight: (x: number, z: number) => number, watercourse = 0): RegionColumnPlan {
    const settlement = this.settlementAt(x, z, height, biome, getHeight);
    if (settlement) {
      return this.settlementColumn(settlement, x, z, height);
    }
    const road = this.roadSampleAt(x, z, height, biome, getHeight);
    if (road.strength > 0.78) {
      if (watercourse > 0.45) {
        return this.bridgeColumn(x, z, road);
      }
      return { surface: road.strength > 0.92 ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH, blocks: [], blocksDecoration: true };
    }
    return { blocks: [], blocksDecoration: false };
  }

  settlementAt(x: number, z: number, height: number, biome: BiomeId, getHeight: (x: number, z: number) => number): SettlementPlan | null {
    if (height <= SEA_LEVEL + 3 || isMountainBiome(biome) || biome === "beach" || biome === "lake" || biome === "mountain_lake" || biome === "marsh" || biome === "bog") {
      return null;
    }
    const cellSize = 1280;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const plan = this.planSettlementCell(cellX + dx, cellZ + dz, cellSize);
        if (!plan) continue;
        const dist = Math.hypot(x - plan.centerX, z - plan.centerZ);
        if (dist > plan.radius) continue;
        if (!this.acceptsSettlement(plan, getHeight)) continue;
        return plan;
      }
    }
    return null;
  }

  roadStrengthAt(x: number, z: number, height: number, biome: BiomeId, getHeight: (x: number, z: number) => number): number {
    return this.roadSampleAt(x, z, height, biome, getHeight).strength;
  }

  roadSampleAt(x: number, z: number, height: number, biome: BiomeId, getHeight: (x: number, z: number) => number): RoadSample {
    if (height <= SEA_LEVEL + 2 || isMountainBiome(biome) || biome === "lake" || biome === "mountain_lake") {
      return { strength: 0, dirX: 1, dirZ: 0, bridge: false };
    }
    const cellSize = 1280;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    let best: RoadSample = { strength: 0, dirX: 1, dirZ: 0, bridge: false };
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const a = this.planSettlementCell(cellX + dx, cellZ + dz, cellSize);
        if (!a || !this.acceptsSettlement(a, getHeight)) continue;
        const neighbors: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
        for (const [nx, nz] of neighbors) {
          const b = this.planSettlementCell(cellX + dx + nx, cellZ + dz + nz, cellSize);
          if (!b) continue;
          const linkRoll = this.noise.random2D((cellX + dx) * 419 + nx * 17, (cellZ + dz) * 419 + nz * 29);
          if (linkRoll > 0.72) continue;
          const d = this.distanceToOrganicPath(x, z, a, b);
          const width = a.kind === "village" || b.kind === "village" ? 4.7 : 3.15;
          if (d.distance < width) {
            const roadHeight = getHeight(Math.floor(x), Math.floor(z));
            const localSlope = Math.max(
              Math.abs(getHeight(Math.floor(x + d.dirZ * 5), Math.floor(z - d.dirX * 5)) - roadHeight),
              Math.abs(getHeight(Math.floor(x - d.dirZ * 5), Math.floor(z + d.dirX * 5)) - roadHeight),
            );
            const slopePenalty = localSlope > 5 ? 0.44 : localSlope > 3 ? 0.74 : 1;
            const strength = clamp(1 - d.distance / width, 0, 1) * slopePenalty;
            if (strength > best.strength) best = { strength, dirX: d.dirX, dirZ: d.dirZ, bridge: false };
          }
        }
      }
    }
    return best;
  }

  private bridgeColumn(x: number, z: number, road: RoadSample): RegionColumnPlan {
    const alongX = Math.abs(road.dirX) >= Math.abs(road.dirZ);
    const beam = alongX ? BlockId.WEATHERED_BEAM_X : BlockId.WEATHERED_BEAM_Z;
    const perp = alongX ? z : x;
    const edge = Math.abs(modCentered(perp, 7)) > 2.35;
    const blocks: RegionColumnBlock[] = [
      { dy: 0, block: beam },
      { dy: 1, block: BlockId.OAK_SLAB },
    ];
    if (edge) blocks.push({ dy: 2, block: BlockId.OAK_FENCE });
    if (Math.abs(modCentered(alongX ? x : z, 17)) < 0.6) blocks.unshift({ dy: -1, block: BlockId.WEATHERED_BEAM });
    return { surface: BlockId.GRAVEL, blocks, blocksDecoration: true };
  }

  private planSettlementCell(cellX: number, cellZ: number, cellSize: number): SettlementPlan | null {
    const cacheKey = `${cellSize}:${cellX}:${cellZ}`;
    if (this.settlementCellCache.has(cacheKey)) return this.settlementCellCache.get(cacheKey) ?? null;
    const roll = this.noise.random2D(cellX * 313 + 71, cellZ * 313 - 91);
    if (roll > 0.78) {
      this.settlementCellCache.set(cacheKey, null);
      return null;
    }
    const margin = 250;
    const centerX = cellX * cellSize + margin + Math.floor(this.noise.random2D(cellX * 337 - 19, cellZ * 337 + 37) * (cellSize - margin * 2));
    const centerZ = cellZ * cellSize + margin + Math.floor(this.noise.random2D(cellX * 353 + 23, cellZ * 353 - 29) * (cellSize - margin * 2));
    const kind: SettlementKind = roll < 0.22 ? "village" : "hamlet";
    const plan = { id: `${cellX}:${cellZ}`, kind, centerX, centerZ, radius: kind === "village" ? 104 : 58 };
    this.settlementCellCache.set(cacheKey, plan);
    return plan;
  }

  private acceptsSettlement(plan: SettlementPlan, getHeight: (x: number, z: number) => number): boolean {
    if (this.settlementAcceptanceCache.has(plan.id)) return this.settlementAcceptanceCache.get(plan.id)!;
    const x = plan.centerX;
    const z = plan.centerZ;
    const h = getHeight(x, z);
    const slope = Math.max(
      Math.abs(getHeight(x + 8, z) - h),
      Math.abs(getHeight(x - 8, z) - h),
      Math.abs(getHeight(x, z + 8) - h),
      Math.abs(getHeight(x, z - 8) - h),
    );
    const accepted = h > SEA_LEVEL + 4 && slope <= 12;
    this.settlementAcceptanceCache.set(plan.id, accepted);
    return accepted;
  }

  private settlementColumn(plan: SettlementPlan, x: number, z: number, _height: number): RegionColumnPlan {
    const dx = x - plan.centerX;
    const dz = z - plan.centerZ;
    const blocks: RegionColumnBlock[] = [];
    const road = this.settlementRoadStrength(plan, dx, dz);
    if (road > 0.73) {
      return { surface: plan.kind === "village" ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH, blocks, blocksDecoration: true };
    }

    const well = Math.abs(dx) <= 2 && Math.abs(dz - 6) <= 2;
    if (well) {
      if (Math.abs(dx) === 2 || Math.abs(dz - 6) === 2) blocks.push({ dy: 1, block: BlockId.STONE_BRICK_WALL });
      return { surface: BlockId.COBBLESTONE_PATH, blocks, blocksDecoration: true };
    }

    const districtLane = road > 0.54;
    if (districtLane) {
      return { surface: plan.kind === "village" ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH, blocks, blocksDecoration: true };
    }

    const house = this.houseFootprint(plan, dx, dz);
    if (!house) {
      const yard = Math.hypot(dx, dz) < plan.radius * 0.66 && this.noise.random2D(x * 0.37, z * 0.37) > 0.972;
      return { surface: yard ? BlockId.GRAVEL_PATH : undefined, blocks, blocksDecoration: false };
    }

    const localX = dx - house.cx;
    const localZ = dz - house.cz;
    const w = house.w;
    const d = house.d;
    const edge = Math.abs(localX) === Math.floor(w / 2) || Math.abs(localZ) === Math.floor(d / 2);
    const corner = Math.abs(localX) === Math.floor(w / 2) && Math.abs(localZ) === Math.floor(d / 2);
    const door = localZ === -Math.floor(d / 2) && Math.abs(localX) <= 1;
    const window = edge && !door && Math.abs(localX + localZ) % 4 === 0;
    blocks.push({ dy: 0, block: BlockId.WEATHERED_PLANKS });
    if (edge) {
      blocks.push({ dy: 1, block: door ? BlockId.OAK_DOOR_NORTH : corner ? BlockId.WEATHERED_BEAM : BlockId.WEATHERED_PLANKS });
      blocks.push({ dy: 2, block: window ? BlockId.GLASS_PANE : corner ? BlockId.WEATHERED_BEAM : BlockId.WEATHERED_PLANKS });
      blocks.push({ dy: 3, block: corner ? BlockId.WEATHERED_BEAM : BlockId.WEATHERED_PLANKS });
    } else {
      blocks.push({ dy: 1, block: BlockId.AIR }, { dy: 2, block: BlockId.AIR }, { dy: 3, block: BlockId.AIR });
    }
    const roofNorth = localZ <= 0;
    blocks.push({ dy: 4 + Math.floor(Math.abs(localZ) / 3), block: roofNorth ? BlockId.WEATHERED_ROOF_NORTH : BlockId.WEATHERED_ROOF_SOUTH });
    if (localX === Math.floor(w / 2) - 1 && localZ === 1) blocks.push({ dy: 5, block: BlockId.CHIMNEY });
    return { surface: BlockId.DIRT_PATH, blocks, blocksDecoration: true };
  }

  private houseFootprint(plan: SettlementPlan, dx: number, dz: number): { cx: number; cz: number; w: number; d: number } | null {
    const grid = plan.kind === "village" ? 24 : 21;
    const cellX = Math.round(dx / grid);
    const cellZ = Math.round(dz / grid);
    if (cellX === 0 || cellZ === 0) return null;
    const centerX = cellX * grid;
    const centerZ = cellZ * grid;
    if (Math.hypot(centerX, centerZ) > plan.radius - 8) return null;
    const roll = this.noise.random2D(plan.centerX + cellX * 101, plan.centerZ + cellZ * 101);
    if (roll > (plan.kind === "village" ? 0.54 : 0.34)) return null;
    const w = roll < 0.18 ? 11 : roll < 0.42 ? 9 : 7;
    const d = roll > 0.5 ? 11 : roll > 0.25 ? 9 : 7;
    if (Math.abs(dx - centerX) <= Math.floor(w / 2) && Math.abs(dz - centerZ) <= Math.floor(d / 2)) {
      return { cx: centerX, cz: centerZ, w, d };
    }
    return null;
  }

  private settlementRoadStrength(plan: SettlementPlan, dx: number, dz: number): number {
    const dist = Math.hypot(dx, dz);
    const radialCount = plan.kind === "village" ? 5 : 3;
    const roadWidth = plan.kind === "village" ? 2.2 : 1.45;
    let best = 0;
    for (let i = 0; i < radialCount; i += 1) {
      const angle = (i / radialCount) * Math.PI * 2 + this.noise.random2D(plan.centerX + i * 31, plan.centerZ - i * 29) * 0.48;
      const px = Math.cos(angle);
      const pz = Math.sin(angle);
      const along = dx * px + dz * pz;
      if (along < -plan.radius * 0.22 || along > plan.radius * 0.95) continue;
      const side = Math.abs(dx * pz - dz * px);
      best = Math.max(best, clamp(1 - side / roadWidth, 0, 1));
    }
    const ringA = Math.abs(dist - plan.radius * 0.34);
    const ringB = Math.abs(dist - plan.radius * 0.58);
    best = Math.max(best, clamp(1 - Math.min(ringA, ringB) / (roadWidth * 0.75), 0, 1) * (plan.kind === "village" ? 0.86 : 0.48));
    return best;
  }

  private distanceToOrganicPath(px: number, pz: number, a: SettlementPlan, b: SettlementPlan): { distance: number; dirX: number; dirZ: number } {
    const vx = b.centerX - a.centerX;
    const vz = b.centerZ - a.centerZ;
    const len = Math.hypot(vx, vz) || 1;
    const nx = -vz / len;
    const nz = vx / len;
    const bendA = (this.noise.random2D(a.centerX * 0.13 + b.centerX, a.centerZ * 0.13 - b.centerZ) - 0.5) * 190;
    const bendB = (this.noise.random2D(a.centerX * 0.17 - b.centerX, a.centerZ * 0.17 + b.centerZ) - 0.5) * 150;
    let prevX = a.centerX;
    let prevZ = a.centerZ;
    let best = { distance: Number.POSITIVE_INFINITY, dirX: vx / len, dirZ: vz / len };
    for (let i = 1; i <= 10; i += 1) {
      const t = i / 10;
      const omt = 1 - t;
      const c1x = a.centerX + vx * 0.34 + nx * bendA;
      const c1z = a.centerZ + vz * 0.34 + nz * bendA;
      const c2x = a.centerX + vx * 0.68 + nx * bendB;
      const c2z = a.centerZ + vz * 0.68 + nz * bendB;
      const x = omt * omt * omt * a.centerX + 3 * omt * omt * t * c1x + 3 * omt * t * t * c2x + t * t * t * b.centerX;
      const z = omt * omt * omt * a.centerZ + 3 * omt * omt * t * c1z + 3 * omt * t * t * c2z + t * t * t * b.centerZ;
      const distance = this.distanceToSegment(px, pz, prevX, prevZ, x, z);
      if (distance < best.distance) {
        const sx = x - prevX;
        const sz = z - prevZ;
        const sl = Math.hypot(sx, sz) || 1;
        best = { distance, dirX: sx / sl, dirZ: sz / sl };
      }
      prevX = x;
      prevZ = z;
    }
    return best;
  }

  private distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const vx = bx - ax;
    const vz = bz - az;
    const wx = px - ax;
    const wz = pz - az;
    const len2 = vx * vx + vz * vz;
    if (len2 <= 0.0001) return Math.hypot(px - ax, pz - az);
    const t = clamp((wx * vx + wz * vz) / len2, 0, 1);
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
  }
}

function modCentered(value: number, period: number): number {
  return ((value + period * 0.5) % period + period) % period - period * 0.5;
}
