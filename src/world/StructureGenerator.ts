import { CHUNK_SIZE, WORLD_HEIGHT } from "../utils/Constants";
import { Noise } from "../utils/Noise";
import { BlockId, isLeaves, isPlant } from "./BlockTypes";
import { Chunk } from "./Chunk";
import { BiomeId } from "./BiomeGenerator";

type TreeSpecies = "oak" | "birch" | "spruce" | "dark_oak";
type TreeShape = "young" | "standard" | "tall" | "large" | "giant" | "dead";

interface WoodSet {
  log: BlockId;
  logX: BlockId;
  logZ: BlockId;
  leaves: BlockId;
}

export class StructureGenerator {
  constructor(private readonly noise: Noise) {}

  shouldPlaceTree(x: number, z: number, biome: BiomeId): boolean {
    const spacing = biome === "plains" ? 13 : biome === "hills" ? 9 : biome === "snow" ? 7 : 6;
    const cellX = Math.floor(x / spacing);
    const cellZ = Math.floor(z / spacing);
    const jitterX = 1 + Math.floor(this.noise.random2D(cellX * 17 + 9, cellZ * 17 - 3) * Math.max(1, spacing - 2));
    const jitterZ = 1 + Math.floor(this.noise.random2D(cellX * 23 - 5, cellZ * 23 + 11) * Math.max(1, spacing - 2));
    if (x !== cellX * spacing + jitterX || z !== cellZ * spacing + jitterZ) return false;

    const grove = normalized(this.noise.fbm2D(x * 0.016 + 120, z * 0.016 - 80, 3));
    const clearing = normalized(this.noise.fbm2D(x * 0.007 - 240, z * 0.007 + 160, 3));
    let chance = 0;
    if (biome === "forest") chance = 0.34 + grove * grove * 0.52;
    else if (biome === "plains") chance = grove > 0.76 ? 0.24 : 0.055;
    else if (biome === "hills") chance = 0.22 + grove * 0.34;
    else if (biome === "snow") chance = 0.38 + grove * 0.26;
    chance *= clearing > 0.76 ? 0.22 : 1;
    return chance > 0 && this.noise.random2D(cellX * 91 + 41, cellZ * 91 - 17) < chance;
  }

  shouldPlaceFallenLog(x: number, z: number, biome: BiomeId): boolean {
    if (biome !== "forest" && biome !== "hills" && biome !== "plains") return false;
    const spacing = biome === "forest" ? 10 : 16;
    const cellX = Math.floor(x / spacing);
    const cellZ = Math.floor(z / spacing);
    const anchorX = cellX * spacing + 2 + Math.floor(this.noise.random2D(cellX * 53, cellZ * 53 + 9) * Math.max(1, spacing - 4));
    const anchorZ = cellZ * spacing + 2 + Math.floor(this.noise.random2D(cellX * 59 - 7, cellZ * 59) * Math.max(1, spacing - 4));
    if (x !== anchorX || z !== anchorZ) return false;
    const oldWood = normalized(this.noise.fbm2D(x * 0.012 + 510, z * 0.012 - 330, 2));
    const chance = biome === "forest" ? 0.22 + oldWood * 0.28 : oldWood > 0.76 ? 0.18 : 0.035;
    return this.noise.random2D(cellX * 47 - 11, cellZ * 47 + 23) < chance;
  }

  placeTree(chunk: Chunk, lx: number, baseY: number, lz: number, biome: BiomeId): void {
    if (!this.canStartStructure(chunk, lx, baseY, lz, 2, 9)) return;

    const species = this.pickSpecies(chunk, lx, baseY, lz, biome);
    let shape = this.pickShape(chunk, lx, baseY, lz, biome, species);
    const wood = this.blocksForSpecies(species);

    if (shape === "giant" && !this.safeCanopy(lx, baseY, lz, 6, 23)) shape = "large";
    if (shape === "large" && !this.safeCanopy(lx, baseY, lz, 5, 17)) shape = "tall";

    if (shape === "dead") {
      this.placeDeadTree(chunk, lx, baseY, lz, wood);
      return;
    }
    if (species === "spruce") {
      this.placeSpruce(chunk, lx, baseY, lz, wood, shape);
      return;
    }
    if (shape === "giant" || (shape === "large" && species === "dark_oak")) {
      this.placeGiantBroadleaf(chunk, lx, baseY, lz, wood, species);
      return;
    }
    if (shape === "large") {
      this.placeLargeBroadleaf(chunk, lx, baseY, lz, wood, species);
      return;
    }
    this.placeRoundTree(chunk, lx, baseY, lz, wood, shape, species);
  }

  placeFallenLog(chunk: Chunk, lx: number, baseY: number, lz: number, biome: BiomeId): void {
    if (!this.safeCanopy(lx, baseY, lz, 4, 4)) return;
    const species = this.pickSpecies(chunk, lx + 9, baseY, lz - 7, biome);
    const { logX, logZ } = this.blocksForSpecies(species);
    const eastWest = this.noise.random3D(chunk.cx * 13 + lx, baseY, chunk.cz * 13 + lz) > 0.5;
    const length = 4 + this.randInt(chunk, lx, baseY + 4, lz, 5);
    const start = -Math.floor(length * 0.5);
    for (let i = 0; i < length; i += 1) {
      const dx = eastWest ? start + i : 0;
      const dz = eastWest ? 0 : start + i;
      const x = lx + dx;
      const z = lz + dz;
      if (x < 1 || x >= CHUNK_SIZE - 1 || z < 1 || z >= CHUNK_SIZE - 1 || baseY + 1 >= WORLD_HEIGHT) continue;
      if (this.isReplaceable(chunk.getLocal(x, baseY + 1, z))) {
        chunk.setLocal(x, baseY + 1, z, eastWest ? logX : logZ);
      }
      if (this.noise.random3D(chunk.cx * 17 + x, baseY + 1, chunk.cz * 17 + z) > 0.62 && this.isReplaceable(chunk.getLocal(x, baseY + 2, z))) {
        chunk.setLocal(x, baseY + 2, z, BlockId.WILD_BUSH);
      }
    }
  }

  placeOakTree(chunk: Chunk, lx: number, baseY: number, lz: number): void {
    this.placeRoundTree(chunk, lx, baseY, lz, this.blocksForSpecies("oak"), "standard", "oak");
  }

  private pickSpecies(chunk: Chunk, lx: number, baseY: number, lz: number, biome: BiomeId): TreeSpecies {
    const roll = this.noise.random3D(chunk.cx * 17 + lx, baseY, chunk.cz * 17 + lz);
    if (biome === "snow") return roll < 0.86 ? "spruce" : "birch";
    if (biome === "hills") return roll < 0.42 ? "spruce" : roll < 0.64 ? "birch" : roll > 0.92 ? "dark_oak" : "oak";
    if (biome === "forest") return roll < 0.12 ? "birch" : roll < 0.38 ? "spruce" : roll > 0.82 ? "dark_oak" : "oak";
    if (biome === "plains") return roll < 0.58 ? "birch" : "oak";
    return "oak";
  }

  private pickShape(chunk: Chunk, lx: number, baseY: number, lz: number, biome: BiomeId, species: TreeSpecies): TreeShape {
    const roll = this.noise.random3D(chunk.cx * 29 + lx, baseY + 11, chunk.cz * 29 + lz);
    if ((biome === "forest" || biome === "hills") && roll < 0.035) return "dead";
    if (biome === "forest" && roll > 0.945) return "giant";
    if (biome === "forest" && roll > 0.76) return "large";
    if (biome === "hills" && roll > 0.86) return "large";
    if (roll < 0.13) return "young";
    if (roll > 0.64 || species === "spruce") return "tall";
    return "standard";
  }

  private blocksForSpecies(species: TreeSpecies): WoodSet {
    switch (species) {
      case "birch":
        return { log: BlockId.BIRCH_LOG, logX: BlockId.BIRCH_LOG_X, logZ: BlockId.BIRCH_LOG_Z, leaves: BlockId.BIRCH_LEAVES };
      case "spruce":
        return { log: BlockId.SPRUCE_LOG, logX: BlockId.SPRUCE_LOG_X, logZ: BlockId.SPRUCE_LOG_Z, leaves: BlockId.SPRUCE_LEAVES };
      case "dark_oak":
        return { log: BlockId.DARK_OAK_LOG, logX: BlockId.DARK_OAK_LOG_X, logZ: BlockId.DARK_OAK_LOG_Z, leaves: BlockId.DARK_OAK_LEAVES };
      case "oak":
      default:
        return { log: BlockId.OAK_LOG, logX: BlockId.OAK_LOG_X, logZ: BlockId.OAK_LOG_Z, leaves: BlockId.OAK_LEAVES };
    }
  }

  private placeRoundTree(chunk: Chunk, lx: number, baseY: number, lz: number, wood: WoodSet, shape: TreeShape, species: TreeSpecies): void {
    const height = shape === "young" ? 4 + this.randInt(chunk, lx, baseY, lz, 2) : shape === "tall" ? 8 + this.randInt(chunk, lx, baseY, lz, 4) : 6 + this.randInt(chunk, lx, baseY, lz, 3);
    const radius = shape === "young" ? 2 : shape === "tall" ? 4 : 3;
    if (!this.safeCanopy(lx, baseY, lz, radius + 1, height + 4)) return;

    this.placeTrunk(chunk, lx, baseY, lz, height, wood.log, 1);
    if (shape !== "young") {
      const dirs = this.shuffledDirs(chunk, lx, baseY, lz);
      const branches = species === "birch" ? 1 : shape === "tall" ? 3 : 2;
      for (let i = 0; i < branches; i += 1) {
        const dir = dirs[i];
        const y = baseY + height - 2 + (i % 2);
        const length = 2 + this.randInt(chunk, lx + i, y, lz - i, shape === "tall" ? 3 : 2);
        const end = this.placeBranch(chunk, lx, y, lz, dir[0], dir[1], length, wood);
        this.leafEllipsoid(chunk, end.x, end.y, end.z, radius - 1, 2, radius, wood.leaves, 0.9, 0.34);
      }
    }

    const top = baseY + height;
    const tallBias = shape === "tall" ? 1 : 0;
    this.leafEllipsoid(chunk, lx, top, lz, radius, 2 + tallBias, radius, wood.leaves, species === "birch" ? 0.8 : 0.9, 0.38);
    this.leafEllipsoid(chunk, lx, top - 1, lz, radius + 1, 2, radius, wood.leaves, species === "birch" ? 0.74 : 0.86, 0.46);
    this.leafEllipsoid(chunk, lx, top + 1, lz, Math.max(2, radius - 1), 2, Math.max(2, radius - 1), wood.leaves, 0.84, 0.42);
  }

  private placeLargeBroadleaf(chunk: Chunk, lx: number, baseY: number, lz: number, wood: WoodSet, species: TreeSpecies): void {
    const height = 10 + this.randInt(chunk, lx, baseY, lz, 5);
    if (!this.safeCanopy(lx, baseY, lz, 5, height + 6)) return;
    const thick = species === "birch" ? 1 : 2;
    this.placeTrunk(chunk, lx, baseY, lz, height, wood.log, thick);
    this.placeRoots(chunk, lx, baseY, lz, wood);

    const dirs = this.shuffledDirs(chunk, lx, baseY, lz);
    for (let i = 0; i < 4; i += 1) {
      const y = baseY + height - 4 + (i % 3);
      const length = 3 + this.randInt(chunk, lx + i, y, lz - i, 3);
      const end = this.placeBranch(chunk, lx, y, lz, dirs[i][0], dirs[i][1], length, wood);
      this.leafEllipsoid(chunk, end.x, end.y, end.z, 3 + (i % 2), 2, 3, wood.leaves, 0.9, 0.34);
    }
    this.leafEllipsoid(chunk, lx, baseY + height + 1, lz, 5, 3, 5, wood.leaves, 0.88, 0.42);
    this.leafEllipsoid(chunk, lx + 1, baseY + height - 1, lz - 1, 4, 2, 4, wood.leaves, 0.82, 0.48);
  }

  private placeGiantBroadleaf(chunk: Chunk, lx: number, baseY: number, lz: number, wood: WoodSet, species: TreeSpecies): void {
    const height = 15 + this.randInt(chunk, lx, baseY, lz, 7);
    if (!this.safeCanopy(lx, baseY, lz, 6, height + 8)) return;
    const thickness = species === "dark_oak" ? 3 : 2;
    this.placeTrunk(chunk, lx, baseY, lz, height, wood.log, thickness);
    this.placeRoots(chunk, lx, baseY, lz, wood);

    const dirs = this.shuffledDirs(chunk, lx, baseY, lz);
    for (let i = 0; i < 6; i += 1) {
      const dir = dirs[i % dirs.length];
      const y = baseY + height - 7 + i;
      const length = 4 + this.randInt(chunk, lx + i * 2, y, lz - i, 3);
      const end = this.placeBranch(chunk, lx, y, lz, dir[0], dir[1], length, wood);
      this.leafEllipsoid(chunk, end.x, end.y + 1, end.z, 4, 3, 4, wood.leaves, 0.9, 0.36);
      if (i % 2 === 0) this.leafEllipsoid(chunk, end.x - dir[0], end.y, end.z - dir[1], 3, 2, 3, wood.leaves, 0.82, 0.46);
    }
    this.leafEllipsoid(chunk, lx, baseY + height + 1, lz, 6, 4, 6, wood.leaves, 0.92, 0.38);
    this.leafEllipsoid(chunk, lx + 2, baseY + height - 2, lz + 1, 5, 3, 4, wood.leaves, 0.86, 0.46);
    this.leafEllipsoid(chunk, lx - 2, baseY + height - 1, lz - 1, 4, 3, 5, wood.leaves, 0.86, 0.46);
  }

  private placeSpruce(chunk: Chunk, lx: number, baseY: number, lz: number, wood: WoodSet, shape: TreeShape): void {
    const height = shape === "young" ? 6 + this.randInt(chunk, lx, baseY, lz, 3) : shape === "giant" ? 18 + this.randInt(chunk, lx, baseY, lz, 7) : shape === "large" ? 14 + this.randInt(chunk, lx, baseY, lz, 5) : 10 + this.randInt(chunk, lx, baseY, lz, 6);
    const maxRadius = shape === "young" ? 2 : shape === "giant" ? 5 : shape === "large" ? 4 : 3;
    if (!this.safeCanopy(lx, baseY, lz, maxRadius + 1, height + 4)) return;

    this.placeTrunk(chunk, lx, baseY, lz, height, wood.log, 1);
    for (let y = baseY + 2; y <= baseY + height + 1; y += 1) {
      const fromTop = baseY + height + 1 - y;
      const taper = fromTop / Math.max(1, height - 1);
      let radius = Math.max(1, Math.round(1 + taper * maxRadius));
      if ((y + lx + lz) % 3 === 0) radius = Math.max(1, radius - 1);
      if (fromTop < 2) radius = 1;
      this.leafDisc(chunk, lx, y, lz, radius, Math.max(1, radius - 1), wood.leaves, 0.82, 0.42);
      if (radius >= 3 && y % 3 === 0) {
        const dirs = this.shuffledDirs(chunk, lx, y, lz);
        for (let i = 0; i < 2; i += 1) this.placeBranch(chunk, lx, y, lz, dirs[i][0], dirs[i][1], radius - 1, wood);
      }
    }
    this.leafEllipsoid(chunk, lx, baseY + height + 1, lz, 1, 2, 1, wood.leaves, 0.9, 0.22);
  }

  private placeDeadTree(chunk: Chunk, lx: number, baseY: number, lz: number, wood: WoodSet): void {
    const height = 5 + this.randInt(chunk, lx, baseY, lz, 7);
    if (!this.safeCanopy(lx, baseY, lz, 3, height + 3)) return;
    this.placeTrunk(chunk, lx, baseY, lz, height, wood.log, 1);
    const dirs = this.shuffledDirs(chunk, lx, baseY, lz);
    for (let i = 0; i < 3; i += 1) {
      const y = baseY + 3 + this.randInt(chunk, lx + i, baseY, lz - i, Math.max(1, height - 3));
      this.placeBranch(chunk, lx, y, lz, dirs[i][0], dirs[i][1], 2 + this.randInt(chunk, lx - i, y, lz + i, 3), wood);
    }
  }

  private placeTrunk(chunk: Chunk, lx: number, baseY: number, lz: number, height: number, log: BlockId, thickness: number): void {
    for (let y = 1; y <= height; y += 1) {
      for (let ox = 0; ox < thickness; ox += 1) {
        for (let oz = 0; oz < thickness; oz += 1) {
          this.setWood(chunk, lx + ox, baseY + y, lz + oz, log);
        }
      }
    }
  }

  private placeRoots(chunk: Chunk, lx: number, baseY: number, lz: number, wood: WoodSet): void {
    const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      const length = 1 + (this.noise.random3D(chunk.cx * 61 + lx + dx, baseY, chunk.cz * 61 + lz + dz) > 0.52 ? 1 : 0);
      for (let i = 1; i <= length; i += 1) {
        this.setWood(chunk, lx + dx * i, baseY + 1, lz + dz * i, dx !== 0 ? wood.logX : wood.logZ);
      }
    }
  }

  private placeBranch(chunk: Chunk, lx: number, y: number, lz: number, dx: number, dz: number, length: number, wood: WoodSet): { x: number; y: number; z: number } {
    let endX = lx;
    let endY = y;
    let endZ = lz;
    for (let i = 1; i <= length; i += 1) {
      endX = lx + dx * i;
      endZ = lz + dz * i;
      endY = y + Math.floor(i / 3);
      this.setWood(chunk, endX, endY, endZ, dx !== 0 ? wood.logX : wood.logZ);
    }
    return { x: endX, y: endY, z: endZ };
  }

  private leafEllipsoid(chunk: Chunk, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, leaves: BlockId, density: number, raggedness: number): void {
    for (let y = cy - ry; y <= cy + ry; y += 1) {
      for (let z = cz - rz; z <= cz + rz; z += 1) {
        for (let x = cx - rx; x <= cx + rx; x += 1) {
          if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) continue;
          const nx = (x - cx) / Math.max(1, rx + 0.15);
          const ny = (y - cy) / Math.max(1, ry + 0.15);
          const nz = (z - cz) / Math.max(1, rz + 0.15);
          const dist = nx * nx + ny * ny + nz * nz;
          if (dist > 1.16) continue;
          const edge = Math.max(0, dist - 0.54);
          const noise = this.noise.random3D(chunk.cx * 31 + x, y * 3 + 5, chunk.cz * 31 + z);
          if (dist > 0.45 && noise < edge * raggedness + (1 - density)) continue;
          this.setLeaf(chunk, x, y, z, leaves);
        }
      }
    }
  }

  private leafDisc(chunk: Chunk, cx: number, y: number, cz: number, rx: number, rz: number, leaves: BlockId, density: number, raggedness: number): void {
    for (let z = cz - rz; z <= cz + rz; z += 1) {
      for (let x = cx - rx; x <= cx + rx; x += 1) {
        if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) continue;
        const nx = (x - cx) / Math.max(1, rx + 0.2);
        const nz = (z - cz) / Math.max(1, rz + 0.2);
        const dist = nx * nx + nz * nz;
        if (dist > 1.08) continue;
        const noise = this.noise.random3D(chunk.cx * 43 + x, y * 5 - 7, chunk.cz * 43 + z);
        if (dist > 0.48 && noise < (dist - 0.48) * raggedness + (1 - density)) continue;
        this.setLeaf(chunk, x, y, z, leaves);
      }
    }
  }

  private shuffledDirs(chunk: Chunk, lx: number, y: number, lz: number): Array<[number, number]> {
    const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const shift = this.randInt(chunk, lx, y, lz, dirs.length);
    return dirs.slice(shift).concat(dirs.slice(0, shift));
  }

  private canStartStructure(chunk: Chunk, lx: number, baseY: number, lz: number, radius: number, height: number): boolean {
    if (!this.safeCanopy(lx, baseY, lz, radius, height)) return false;
    if (!this.isReplaceable(chunk.getLocal(lx, baseY + 1, lz))) return false;
    for (let y = baseY + 1; y <= Math.min(WORLD_HEIGHT - 1, baseY + Math.min(height, 9)); y += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = lx + dx;
          const z = lz + dz;
          if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
          const id = chunk.getLocal(x, y, z);
          if (isLeaves(id) || this.isLog(id)) return false;
        }
      }
    }
    return true;
  }

  private safeCanopy(lx: number, baseY: number, lz: number, radius: number, height: number): boolean {
    return lx >= radius + 1 && lx < CHUNK_SIZE - radius - 1 && lz >= radius + 1 && lz < CHUNK_SIZE - radius - 1 && baseY + height < WORLD_HEIGHT;
  }

  private setWood(chunk: Chunk, lx: number, y: number, lz: number, block: BlockId): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    const target = chunk.getLocal(lx, y, lz);
    if (target === BlockId.AIR || isPlant(target) || isLeaves(target)) chunk.setLocal(lx, y, lz, block);
  }

  private setLeaf(chunk: Chunk, lx: number, y: number, lz: number, block: BlockId): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    const target = chunk.getLocal(lx, y, lz);
    if (target === BlockId.AIR || isPlant(target)) chunk.setLocal(lx, y, lz, block);
  }

  private isReplaceable(block: BlockId): boolean {
    return block === BlockId.AIR || isPlant(block);
  }

  private isLog(block: BlockId): boolean {
    return block === BlockId.OAK_LOG
      || block === BlockId.OAK_LOG_X
      || block === BlockId.OAK_LOG_Z
      || block === BlockId.BIRCH_LOG
      || block === BlockId.BIRCH_LOG_X
      || block === BlockId.BIRCH_LOG_Z
      || block === BlockId.SPRUCE_LOG
      || block === BlockId.SPRUCE_LOG_X
      || block === BlockId.SPRUCE_LOG_Z
      || block === BlockId.DARK_OAK_LOG
      || block === BlockId.DARK_OAK_LOG_X
      || block === BlockId.DARK_OAK_LOG_Z;
  }

  private randInt(chunk: Chunk, lx: number, y: number, lz: number, maxExclusive: number): number {
    return Math.floor(this.noise.random3D(chunk.cx * 101 + lx, y, chunk.cz * 101 + lz) * maxExclusive);
  }
}

function normalized(value: number): number {
  return Math.max(0, Math.min(1, (value + 1) * 0.5));
}
