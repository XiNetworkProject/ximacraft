import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";
import { BiomeId, isDryBiome, isForestBiome, isMountainBiome } from "../BiomeGenerator";
import { BlockId } from "../BlockTypes";
import type { RegionColumnBlock, RegionColumnPlan, SettlementPlan } from "../RegionPlanner";
import type { RoadWaterContext } from "./RoadTypes";

type Orientation = "north" | "south" | "east" | "west";
type BuildingKind = "cottage" | "barn" | "forge" | "tavern" | "storehouse" | "fisher" | "watch";

type BuildingPlot = {
  cx: number;
  cz: number;
  localX: number;
  localZ: number;
  w: number;
  d: number;
  kind: BuildingKind;
  orientation: Orientation;
  stone: boolean;
};

export class VillageLayoutPlanner {
  constructor(private readonly noise: Noise) {}

  columnAt(plan: SettlementPlan, x: number, z: number, _height: number, biome: BiomeId, water: RoadWaterContext): RegionColumnPlan {
    if (water.strength > 0.58) return { blocks: [], blocksDecoration: false };

    const dx = x - plan.centerX;
    const dz = z - plan.centerZ;
    const dist = Math.hypot(dx, dz);
    const angle = this.villageAngle(plan);
    const road = this.settlementRoadStrength(plan, dx, dz, angle);
    const blocks: RegionColumnBlock[] = [];

    if (dist < (plan.kind === "village" ? 15 : 9)) {
      return this.plazaColumn(plan, dx, dz, x, z);
    }

    if (road > 0.65) {
      const surface = plan.kind === "village" && road > 0.86 ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH;
      if (plan.kind === "village" && Math.abs(modCentered(dist, 19)) < 0.65 && road > 0.86) blocks.push({ dy: 1, block: BlockId.LANTERN_POST });
      return { surface, blocks, blocksDecoration: true };
    }

    const quay = water.strength > 0.2 && water.strength < 0.5 && dist > plan.radius * 0.55;
    if (quay) {
      if (Math.abs(modCentered(x + z, 13)) < 0.65) blocks.push({ dy: 1, block: BlockId.OAK_FENCE });
      return { surface: BlockId.GRAVEL_PATH, blocks, blocksDecoration: true };
    }

    const plot = this.buildingPlot(plan, dx, dz, angle, biome, water);
    if (plot) {
      return this.buildingColumn(plot, biome, x, z);
    }

    const yard = dist < plan.radius * 0.76 && this.noise.random2D(Math.floor(x / 5) * 37, Math.floor(z / 5) * 37) > (plan.kind === "village" ? 0.946 : 0.972);
    if (yard) {
      const block = this.noise.random2D(x * 0.29, z * 0.29) > 0.82 ? BlockId.LOW_BORDER : BlockId.WILD_BUSH;
      return { surface: undefined, blocks: [{ dy: 1, block }], blocksDecoration: true };
    }

    const field = this.farmSurface(plan, dx, dz, angle, biome);
    if (field) return field;

    return { blocks: [], blocksDecoration: false };
  }

  private plazaColumn(plan: SettlementPlan, dx: number, dz: number, x: number, z: number): RegionColumnPlan {
    const blocks: RegionColumnBlock[] = [];
    const well = Math.abs(dx) <= 2 && Math.abs(dz - 5) <= 2;
    if (well) {
      if (Math.abs(dx) === 2 || Math.abs(dz - 5) === 2) blocks.push({ dy: 1, block: BlockId.STONE_BRICK_WALL });
      if (Math.abs(dx) <= 1 && Math.abs(dz - 5) <= 1) blocks.push({ dy: 1, block: BlockId.WATER });
      if (dx === 0 && dz === 3) blocks.push({ dy: 2, block: BlockId.HANGING_LANTERN });
    }
    if (plan.kind === "village" && Math.abs(modCentered(x, 17)) < 0.5 && Math.abs(modCentered(z, 17)) < 0.5) {
      blocks.push({ dy: 1, block: BlockId.LANTERN_POST });
    }
    return { surface: BlockId.COBBLESTONE_PATH, blocks, blocksDecoration: true };
  }

  private settlementRoadStrength(plan: SettlementPlan, dx: number, dz: number, angle: number): number {
    const [rx, rz] = rotate(dx, dz, -angle);
    const dist = Math.hypot(dx, dz);
    const roadWidth = plan.kind === "village" ? 2.5 : 1.7;
    let best = Math.max(clamp(1 - Math.abs(rx) / roadWidth, 0, 1), clamp(1 - Math.abs(rz) / roadWidth, 0, 1)) * (plan.kind === "village" ? 0.9 : 0.58);

    const radialCount = plan.kind === "village" ? 6 : 3;
    for (let i = 0; i < radialCount; i += 1) {
      const spokeAngle = angle + (i / radialCount) * Math.PI * 2 + (this.noise.random2D(plan.centerX + i * 41, plan.centerZ - i * 37) - 0.5) * 0.36;
      const px = Math.cos(spokeAngle);
      const pz = Math.sin(spokeAngle);
      const along = dx * px + dz * pz;
      if (along < -plan.radius * 0.15 || along > plan.radius) continue;
      const side = Math.abs(dx * pz - dz * px);
      best = Math.max(best, clamp(1 - side / roadWidth, 0, 1));
    }

    const ringA = Math.abs(dist - plan.radius * 0.34);
    const ringB = Math.abs(dist - plan.radius * 0.58);
    best = Math.max(best, clamp(1 - Math.min(ringA, ringB) / (roadWidth * 0.85), 0, 1) * (plan.kind === "village" ? 0.84 : 0.42));
    return best;
  }

  private buildingPlot(plan: SettlementPlan, dx: number, dz: number, angle: number, biome: BiomeId, water: RoadWaterContext): BuildingPlot | null {
    const [rx, rz] = rotate(dx, dz, -angle);
    const grid = plan.kind === "village" ? 27 : 25;
    const cellX = Math.round(rx / grid);
    const cellZ = Math.round(rz / grid);
    if (cellX === 0 && cellZ === 0) return null;
    if (Math.abs(cellX) + Math.abs(cellZ) < (plan.kind === "village" ? 2 : 1)) return null;

    const jitterX = Math.floor((this.noise.random2D(plan.centerX + cellX * 103, plan.centerZ + cellZ * 107) - 0.5) * 5);
    const jitterZ = Math.floor((this.noise.random2D(plan.centerX - cellX * 109, plan.centerZ - cellZ * 113) - 0.5) * 5);
    const cx = cellX * grid + jitterX;
    const cz = cellZ * grid + jitterZ;
    const dist = Math.hypot(cx, cz);
    if (dist > plan.radius - 8 || dist < plan.radius * 0.18) return null;

    const roll = this.noise.random2D(plan.centerX + cellX * 211, plan.centerZ + cellZ * 223);
    const chance = plan.kind === "village" ? 0.68 : 0.42;
    if (roll > chance) return null;

    const kind = this.buildingKind(plan, roll, biome, water);
    const sizeRoll = this.noise.random2D(plan.centerX + cellX * 241, plan.centerZ - cellZ * 251);
    const large = kind === "barn" || kind === "tavern" || kind === "storehouse";
    const w = large ? (sizeRoll > 0.54 ? 15 : 13) : kind === "watch" ? 7 : sizeRoll > 0.65 ? 11 : 9;
    const d = large ? (sizeRoll < 0.35 ? 15 : 13) : kind === "watch" ? 7 : sizeRoll < 0.35 ? 11 : 9;
    const localX = Math.round(rx - cx);
    const localZ = Math.round(rz - cz);
    if (Math.abs(localX) > Math.floor(w / 2) || Math.abs(localZ) > Math.floor(d / 2)) return null;

    const orientation: Orientation = Math.abs(cx) > Math.abs(cz)
      ? (cx > 0 ? "west" : "east")
      : (cz > 0 ? "north" : "south");
    const stone = isMountainBiome(biome) || biome === "hills" || biome === "plateau" || kind === "forge" || (isDryBiome(biome) && roll < 0.32);
    return { cx, cz, localX, localZ, w, d, kind, orientation, stone };
  }

  private buildingKind(plan: SettlementPlan, roll: number, biome: BiomeId, water: RoadWaterContext): BuildingKind {
    if (water.strength > 0.18 && water.width > 5 && roll < 0.22) return "fisher";
    if (plan.kind === "village" && roll < 0.1) return "forge";
    if (plan.kind === "village" && roll > 0.58 && roll < 0.66) return "tavern";
    if (roll > 0.5 && roll < 0.62) return "barn";
    if (isForestBiome(biome) && roll > 0.64) return "storehouse";
    if (plan.kind === "village" && roll > 0.66) return "watch";
    return "cottage";
  }

  private buildingColumn(plot: BuildingPlot, biome: BiomeId, x: number, z: number): RegionColumnPlan {
    const blocks: RegionColumnBlock[] = [];
    const hx = Math.floor(plot.w / 2);
    const hz = Math.floor(plot.d / 2);
    const edgeX = Math.abs(plot.localX) === hx;
    const edgeZ = Math.abs(plot.localZ) === hz;
    const edge = edgeX || edgeZ;
    const corner = edgeX && edgeZ;
    const door = this.isDoor(plot);
    const material = this.wallBlock(plot, biome);
    const beam = this.beamBlock(plot.orientation);
    const foundation = plot.stone ? BlockId.COBBLESTONE : BlockId.WEATHERED_PLANKS;
    const wallHeight = plot.kind === "watch" ? 6 : plot.kind === "barn" ? 4 : 3;
    const window = edge && !door && !corner && ((Math.abs(plot.localX * 3 + plot.localZ * 5) + Math.floor(x + z)) % 5 === 0);

    blocks.push({ dy: 0, block: foundation });
    for (let y = 1; y <= wallHeight; y += 1) {
      if (!edge) {
        blocks.push({ dy: y, block: BlockId.AIR });
        continue;
      }
      if (door && y <= 2) {
        blocks.push({ dy: y, block: y === 1 ? this.doorBlock(plot.orientation) : BlockId.AIR });
      } else if (window && y === 2) {
        blocks.push({ dy: y, block: BlockId.GLASS_PANE });
      } else {
        blocks.push({ dy: y, block: corner ? beam : material });
      }
    }

    const roofAxisX = plot.w >= plot.d;
    const roofRise = roofAxisX ? Math.floor((hz - Math.abs(plot.localZ)) / 2) : Math.floor((hx - Math.abs(plot.localX)) / 2);
    const roofDy = wallHeight + 1 + Math.max(0, roofRise);
    blocks.push({ dy: roofDy, block: this.roofBlock(plot, roofAxisX) });
    if (plot.kind === "forge" && plot.localX === hx - 1 && plot.localZ === 1) {
      blocks.push({ dy: roofDy + 1, block: BlockId.CHIMNEY });
    }
    if (plot.kind === "tavern" && !edge && plot.localX === 0 && plot.localZ === 0) {
      blocks.push({ dy: 3, block: BlockId.HANGING_LANTERN });
    }
    if (plot.kind === "watch" && corner && Math.abs(plot.localX + plot.localZ) % 2 === 0) {
      blocks.push({ dy: wallHeight + 2, block: BlockId.OAK_FENCE });
    }
    return { surface: plot.stone ? BlockId.COBBLESTONE_PATH : BlockId.DIRT_PATH, blocks, blocksDecoration: true };
  }

  private farmSurface(plan: SettlementPlan, dx: number, dz: number, angle: number, biome: BiomeId): RegionColumnPlan | null {
    if (isMountainBiome(biome) || biome === "beach" || biome === "dunes") return null;
    const dist = Math.hypot(dx, dz);
    if (dist < plan.radius * 0.62 || dist > plan.radius * 0.95) return null;
    const [rx, rz] = rotate(dx, dz, -angle);
    const patch = this.noise.fbm2D((plan.centerX + Math.floor(rx / 8) * 8) * 0.018, (plan.centerZ + Math.floor(rz / 8) * 8) * 0.018, 2);
    if (patch < 0.24) return null;
    const row = Math.abs(modCentered(rx, 7)) < 0.6 || Math.abs(modCentered(rz, 9)) < 0.6;
    const edge = Math.abs(modCentered(rx, 31)) < 0.6 || Math.abs(modCentered(rz, 29)) < 0.6;
    const blocks: RegionColumnBlock[] = [];
    if (edge && plan.kind === "village") blocks.push({ dy: 1, block: BlockId.OAK_FENCE });
    else if (row) blocks.push({ dy: 1, block: BlockId.SHORT_GRASS });
    return { surface: row ? BlockId.DIRT_PATH : undefined, blocks, blocksDecoration: true };
  }

  private isDoor(plot: BuildingPlot): boolean {
    if (plot.orientation === "north") return plot.localZ === -Math.floor(plot.d / 2) && Math.abs(plot.localX) <= 1;
    if (plot.orientation === "south") return plot.localZ === Math.floor(plot.d / 2) && Math.abs(plot.localX) <= 1;
    if (plot.orientation === "east") return plot.localX === Math.floor(plot.w / 2) && Math.abs(plot.localZ) <= 1;
    return plot.localX === -Math.floor(plot.w / 2) && Math.abs(plot.localZ) <= 1;
  }

  private wallBlock(plot: BuildingPlot, biome: BiomeId): BlockId {
    if (plot.stone) return plot.kind === "forge" ? BlockId.STONE : BlockId.COBBLESTONE;
    if (biome === "birch_forest") return BlockId.BIRCH_PLANKS;
    if (biome === "pine_forest" || biome === "taiga" || biome === "snow_forest") return BlockId.SPRUCE_PLANKS;
    if (biome === "dark_forest" || plot.kind === "storehouse") return BlockId.DARK_OAK_PLANKS;
    return plot.kind === "barn" ? BlockId.OAK_PLANKS : BlockId.WEATHERED_PLANKS;
  }

  private beamBlock(orientation: Orientation): BlockId {
    return orientation === "east" || orientation === "west" ? BlockId.WEATHERED_BEAM_X : BlockId.WEATHERED_BEAM_Z;
  }

  private doorBlock(orientation: Orientation): BlockId {
    if (orientation === "south") return BlockId.OAK_DOOR_SOUTH;
    if (orientation === "east") return BlockId.OAK_DOOR_EAST;
    if (orientation === "west") return BlockId.OAK_DOOR_WEST;
    return BlockId.OAK_DOOR_NORTH;
  }

  private roofBlock(plot: BuildingPlot, roofAxisX: boolean): BlockId {
    if (plot.stone) {
      if (roofAxisX) return plot.localZ <= 0 ? BlockId.COBBLESTONE_STAIRS_NORTH : BlockId.COBBLESTONE_STAIRS_SOUTH;
      return plot.localX <= 0 ? BlockId.COBBLESTONE_STAIRS_WEST : BlockId.COBBLESTONE_STAIRS_EAST;
    }
    if (roofAxisX) return plot.localZ <= 0 ? BlockId.WEATHERED_ROOF_NORTH : BlockId.WEATHERED_ROOF_SOUTH;
    return plot.localX <= 0 ? BlockId.WEATHERED_ROOF_WEST : BlockId.WEATHERED_ROOF_EAST;
  }

  private villageAngle(plan: SettlementPlan): number {
    return this.noise.random2D(plan.centerX * 0.021, plan.centerZ * 0.021) * Math.PI * 2;
  }
}

function rotate(x: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - z * s, x * s + z * c];
}

function modCentered(value: number, period: number): number {
  return ((value + period * 0.5) % period + period) % period - period * 0.5;
}
