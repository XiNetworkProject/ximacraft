import { SEA_LEVEL } from "../utils/Constants";
import { clamp } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";
import { BiomeId, isDryBiome, isMountainBiome } from "./BiomeGenerator";
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

export class RegionPlanner {
  constructor(private readonly noise: Noise) {}

  sampleColumn(x: number, z: number, height: number, biome: BiomeId, getHeight: (x: number, z: number) => number): RegionColumnPlan {
    const settlement = this.settlementAt(x, z, height, biome, getHeight);
    if (settlement) {
      return this.settlementColumn(settlement, x, z, height);
    }
    const road = this.roadStrengthAt(x, z, height, biome, getHeight);
    if (road > 0.72) {
      return { surface: road > 0.9 ? BlockId.COBBLESTONE_PATH : road > 0.8 ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH, blocks: [], blocksDecoration: road > 0.82 };
    }
    return { blocks: [], blocksDecoration: false };
  }

  settlementAt(x: number, z: number, height: number, biome: BiomeId, getHeight: (x: number, z: number) => number): SettlementPlan | null {
    if (height <= SEA_LEVEL + 3 || isMountainBiome(biome) || biome === "beach" || biome === "lake" || biome === "mountain_lake" || biome === "marsh" || biome === "bog") {
      return null;
    }
    const cellSize = 768;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const plan = this.planSettlementCell(cellX + dx, cellZ + dz, cellSize);
        if (!plan) continue;
        const dist = Math.hypot(x - plan.centerX, z - plan.centerZ);
        if (dist > plan.radius) continue;
        if (!this.acceptsSettlement(plan.centerX, plan.centerZ, biome, getHeight)) continue;
        return plan;
      }
    }
    return null;
  }

  roadStrengthAt(x: number, z: number, height: number, biome: BiomeId, getHeight: (x: number, z: number) => number): number {
    if (height <= SEA_LEVEL + 2 || isMountainBiome(biome) || biome === "lake" || biome === "mountain_lake") return 0;
    const cellSize = 768;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    let best = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const a = this.planSettlementCell(cellX + dx, cellZ + dz, cellSize);
        if (!a || !this.acceptsSettlement(a.centerX, a.centerZ, biome, getHeight)) continue;
        const neighbors: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
        for (const [nx, nz] of neighbors) {
          const b = this.planSettlementCell(cellX + dx + nx, cellZ + dz + nz, cellSize);
          if (!b) continue;
          const linkRoll = this.noise.random2D((cellX + dx) * 419 + nx * 17, (cellZ + dz) * 419 + nz * 29);
          if (linkRoll > 0.55) continue;
          const d = this.distanceToSegment(x, z, a.centerX, a.centerZ, b.centerX, b.centerZ);
          const width = a.kind === "village" || b.kind === "village" ? 4.4 : 3.1;
          if (d < width) best = Math.max(best, clamp(1 - d / width, 0, 1));
        }
      }
    }
    return best;
  }

  private planSettlementCell(cellX: number, cellZ: number, cellSize: number): SettlementPlan | null {
    const roll = this.noise.random2D(cellX * 313 + 71, cellZ * 313 - 91);
    if (roll > 0.5) return null;
    const margin = 170;
    const centerX = cellX * cellSize + margin + Math.floor(this.noise.random2D(cellX * 337 - 19, cellZ * 337 + 37) * (cellSize - margin * 2));
    const centerZ = cellZ * cellSize + margin + Math.floor(this.noise.random2D(cellX * 353 + 23, cellZ * 353 - 29) * (cellSize - margin * 2));
    const kind: SettlementKind = roll < 0.1 ? "village" : "hamlet";
    return { id: `${cellX}:${cellZ}`, kind, centerX, centerZ, radius: kind === "village" ? 84 : 54 };
  }

  private acceptsSettlement(x: number, z: number, biome: BiomeId, getHeight: (x: number, z: number) => number): boolean {
    if (isDryBiome(biome) && biome !== "dry_prairie") return false;
    const h = getHeight(x, z);
    const slope = Math.max(
      Math.abs(getHeight(x + 8, z) - h),
      Math.abs(getHeight(x - 8, z) - h),
      Math.abs(getHeight(x, z + 8) - h),
      Math.abs(getHeight(x, z - 8) - h),
    );
    return h > SEA_LEVEL + 4 && slope <= 9;
  }

  private settlementColumn(plan: SettlementPlan, x: number, z: number, _height: number): RegionColumnPlan {
    const dx = x - plan.centerX;
    const dz = z - plan.centerZ;
    const blocks: RegionColumnBlock[] = [];
    const mainRoad = Math.abs(dx) <= 2 || Math.abs(dz) <= 2;
    if (mainRoad) {
      return { surface: plan.kind === "village" ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH, blocks, blocksDecoration: true };
    }

    const well = Math.abs(dx) <= 2 && Math.abs(dz - 6) <= 2;
    if (well) {
      if (Math.abs(dx) === 2 || Math.abs(dz - 6) === 2) blocks.push({ dy: 1, block: BlockId.STONE_BRICK_WALL });
      return { surface: BlockId.COBBLESTONE_PATH, blocks, blocksDecoration: true };
    }

    const house = this.houseFootprint(plan, dx, dz);
    if (!house) {
      const yard = Math.hypot(dx, dz) < plan.radius * 0.72 && this.noise.random2D(x * 0.37, z * 0.37) > 0.94;
      return { surface: yard ? BlockId.DIRT_PATH : undefined, blocks, blocksDecoration: false };
    }

    const localX = dx - house.cx;
    const localZ = dz - house.cz;
    const w = house.w;
    const d = house.d;
    const edge = Math.abs(localX) === Math.floor(w / 2) || Math.abs(localZ) === Math.floor(d / 2);
    const door = localZ === -Math.floor(d / 2) && Math.abs(localX) <= 1;
    const window = edge && !door && Math.abs(localX + localZ) % 4 === 0;
    blocks.push({ dy: 0, block: BlockId.WEATHERED_PLANKS });
    if (edge) {
      blocks.push({ dy: 1, block: door ? BlockId.OAK_DOOR_NORTH : BlockId.WEATHERED_BEAM });
      blocks.push({ dy: 2, block: window ? BlockId.GLASS_PANE : BlockId.WEATHERED_BEAM });
      blocks.push({ dy: 3, block: BlockId.WEATHERED_BEAM });
    } else {
      blocks.push({ dy: 1, block: BlockId.AIR }, { dy: 2, block: BlockId.AIR }, { dy: 3, block: BlockId.AIR });
    }
    const roofNorth = localZ <= 0;
    blocks.push({ dy: 4 + Math.floor(Math.abs(localZ) / 3), block: roofNorth ? BlockId.WEATHERED_ROOF_NORTH : BlockId.WEATHERED_ROOF_SOUTH });
    if (localX === Math.floor(w / 2) - 1 && localZ === 1) blocks.push({ dy: 5, block: BlockId.CHIMNEY });
    return { surface: BlockId.DIRT_PATH, blocks, blocksDecoration: true };
  }

  private houseFootprint(plan: SettlementPlan, dx: number, dz: number): { cx: number; cz: number; w: number; d: number } | null {
    const grid = plan.kind === "village" ? 20 : 18;
    const cellX = Math.round(dx / grid);
    const cellZ = Math.round(dz / grid);
    if (cellX === 0 || cellZ === 0) return null;
    const centerX = cellX * grid;
    const centerZ = cellZ * grid;
    if (Math.hypot(centerX, centerZ) > plan.radius - 8) return null;
    const roll = this.noise.random2D(plan.centerX + cellX * 101, plan.centerZ + cellZ * 101);
    if (roll > (plan.kind === "village" ? 0.58 : 0.38)) return null;
    const w = roll < 0.22 ? 9 : 7;
    const d = roll > 0.44 ? 9 : 7;
    if (Math.abs(dx - centerX) <= Math.floor(w / 2) && Math.abs(dz - centerZ) <= Math.floor(d / 2)) {
      return { cx: centerX, cz: centerZ, w, d };
    }
    return null;
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
