import { CHUNK_SIZE, WORLD_HEIGHT } from "../utils/Constants";
import { BlockRegistry } from "./BlockRegistry";
import { BlockId } from "./BlockTypes";
import { Chunk } from "./Chunk";

export type LocalLightSample = {
  intensity: number;
  r: number;
  g: number;
  b: number;
  sources: number;
};

type LightReadableWorld = {
  getChunk(cx: number, cz: number): Chunk | undefined;
};

const NO_LOCAL_LIGHT: LocalLightSample = { intensity: 0, r: 1, g: 1, b: 1, sources: 0 };
const MAX_BLOCK_ID = 256;
const FIELD_RADIUS = 7; // rayon utilisé pour les blocs non émissifs (inchangé).
const EMISSIVE_RADIUS = 5; // rayon utilisé par une source pour sa propre face (inchangé).
const FIELD_CELLS = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE;

/**
 * Moteur de lumière locale voxel.
 *
 * Ancienne implémentation : pour CHAQUE face du meshing on scannait une sphère
 * de blocs (rayon 7 ≈ 1400 blocs) autour du point — même quand aucune source
 * n'existait. C'était le principal responsable des freeze au chargement des
 * chunks (~50 ms/chunk).
 *
 * Nouvelle implémentation :
 *  1) chaque chunk garde la liste (mise en cache) de ses sources lumineuses,
 *     recalculée seulement quand un bloc du chunk change (`chunk.lightDirty`) ;
 *  2) avant de mailler un chunk on agrège les sources du voisinage 3×3 (le halo,
 *     le rayon 7 < 16 ne dépasse jamais un chunk d'écart) et on « scatter » leur
 *     contribution dans un champ dense par bloc (réutilisé) ;
 *  3) pendant le meshing, la lecture lumière d'un bloc non émissif est un simple
 *     accès tableau O(1). Les sources elles-mêmes (rares) gardent le calcul exact
 *     rayon 5.
 *
 * Le calcul (falloff, teintes lanterne/four/glowstone/sea lantern) est identique
 * à l'ancien ; seule l'organisation change (gather par face → scatter par chunk),
 * ce qui préserve exactement les couleurs et le rendu, en plus lisse (par bloc
 * au lieu de blocs 2×2×2).
 */
export class LightingEngine {
  private readonly emissionTable = new Float32Array(MAX_BLOCK_ID);
  private readonly tintR = new Float32Array(MAX_BLOCK_ID);
  private readonly tintG = new Float32Array(MAX_BLOCK_ID);
  private readonly tintB = new Float32Array(MAX_BLOCK_ID);

  // Champ de lumière dense du chunk courant (accumulateurs bruts puis normalisés).
  private readonly fieldIntensity = new Float32Array(FIELD_CELLS);
  private readonly fieldR = new Float32Array(FIELD_CELLS);
  private readonly fieldG = new Float32Array(FIELD_CELLS);
  private readonly fieldB = new Float32Array(FIELD_CELLS);
  private hasField = false;
  private originX = 0;
  private originZ = 0;

  // Sources actives (chunk + halo) pour le calcul exact des faces émissives.
  private srcX: number[] = [];
  private srcY: number[] = [];
  private srcZ: number[] = [];
  private srcE: number[] = [];
  private srcR: number[] = [];
  private srcG: number[] = [];
  private srcB: number[] = [];
  private readonly reusableSample: LocalLightSample = { intensity: 0, r: 1, g: 1, b: 1, sources: 0 };

  constructor(private readonly blocks: BlockRegistry) {
    for (const block of blocks.all()) {
      const id = block.id as number;
      if (id < 0 || id >= MAX_BLOCK_ID) continue;
      const emission = block.lightLevel ?? 0;
      this.emissionTable[id] = emission;
      const tint = this.emissionTintFor(block.key);
      this.tintR[id] = tint.r;
      this.tintG[id] = tint.g;
      this.tintB[id] = tint.b;
    }
  }

  getEmission(blockId: BlockId | number): number {
    const id = blockId as number;
    return id >= 0 && id < MAX_BLOCK_ID ? this.emissionTable[id] : 0;
  }

  isLightSource(blockId: BlockId | number): boolean {
    return this.getEmission(blockId) > 0;
  }

  /** Compat : plus de cache par échantillon (le champ dense le remplace). */
  clearCache(): void {}

  /**
   * Prépare le champ de lumière du chunk avant meshing. Agrège les sources du
   * voisinage 3×3 puis les projette dans le champ dense (seulement s'il y en a).
   */
  beginChunk(world: LightReadableWorld, chunk: Chunk): void {
    this.originX = chunk.cx * CHUNK_SIZE;
    this.originZ = chunk.cz * CHUNK_SIZE;
    this.srcX.length = 0;
    this.srcY.length = 0;
    this.srcZ.length = 0;
    this.srcE.length = 0;
    this.srcR.length = 0;
    this.srcG.length = 0;
    this.srcB.length = 0;

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const neighbor = world.getChunk(chunk.cx + dx, chunk.cz + dz);
        if (neighbor) this.collectSources(neighbor);
      }
    }

    if (this.srcX.length === 0) {
      this.hasField = false;
      return;
    }
    this.buildField();
  }

  /** Lecture O(1) de la lumière d'un bloc non émissif du chunk courant. */
  sampleFieldAt(worldX: number, y: number, worldZ: number): LocalLightSample {
    if (!this.hasField) return NO_LOCAL_LIGHT;
    const lx = worldX - this.originX;
    const lz = worldZ - this.originZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
      return NO_LOCAL_LIGHT;
    }
    const index = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    const intensity = this.fieldIntensity[index];
    if (intensity <= 0) return NO_LOCAL_LIGHT;
    const sample = this.reusableSample;
    sample.intensity = intensity;
    sample.r = this.fieldR[index];
    sample.g = this.fieldG[index];
    sample.b = this.fieldB[index];
    sample.sources = 1;
    return sample;
  }

  /**
   * Calcul exact (rayon 5) pour la face d'une source lumineuse elle-même. Rare
   * (peu de blocs émissifs), donc le gather direct reste O(sources) et bit-exact.
   */
  sampleEmissiveSelf(worldX: number, y: number, worldZ: number): LocalLightSample {
    if (this.srcX.length === 0) return NO_LOCAL_LIGHT;
    return this.gather(worldX, y, worldZ, EMISSIVE_RADIUS);
  }

  private collectSources(chunk: Chunk): void {
    this.ensureChunkSources(chunk);
    const packed = chunk.lightSources;
    if (!packed || packed.length === 0) return;
    for (let i = 0; i < packed.length; i += 7) {
      this.srcX.push(packed[i]);
      this.srcY.push(packed[i + 1]);
      this.srcZ.push(packed[i + 2]);
      this.srcE.push(packed[i + 3]);
      this.srcR.push(packed[i + 4]);
      this.srcG.push(packed[i + 5]);
      this.srcB.push(packed[i + 6]);
    }
  }

  /** (Re)construit et met en cache la liste de sources d'un chunk si nécessaire. */
  private ensureChunkSources(chunk: Chunk): void {
    if (!chunk.lightDirty && chunk.lightSources !== null) return;
    const originX = chunk.cx * CHUNK_SIZE;
    const originZ = chunk.cz * CHUNK_SIZE;
    const blocks = chunk.blocks;
    const out: number[] = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const id = blocks[i];
      if (id === BlockId.AIR) continue;
      const emission = id < MAX_BLOCK_ID ? this.emissionTable[id] : 0;
      if (emission <= 0) continue;
      // index = y*256 + z*16 + x
      const x = i & 15;
      const z = (i >> 4) & 15;
      const yv = i >> 8;
      out.push(originX + x, yv, originZ + z, emission, this.tintR[id], this.tintG[id], this.tintB[id]);
    }
    chunk.lightSources = out.length > 0 ? Float32Array.from(out) : EMPTY_SOURCES;
    chunk.lightDirty = false;
  }

  private buildField(): void {
    this.fieldIntensity.fill(0);
    this.fieldR.fill(0);
    this.fieldG.fill(0);
    this.fieldB.fill(0);
    const denom = FIELD_RADIUS + 1;
    const radiusSq = FIELD_RADIUS * FIELD_RADIUS;

    for (let s = 0; s < this.srcX.length; s += 1) {
      const sx = this.srcX[s];
      const sy = this.srcY[s];
      const sz = this.srcZ[s];
      const eScale = this.srcE[s] / 15;
      const tr = this.srcR[s];
      const tg = this.srcG[s];
      const tb = this.srcB[s];
      const lxBase = sx - this.originX;
      const lzBase = sz - this.originZ;

      const minDx = Math.max(-FIELD_RADIUS, -lxBase);
      const maxDx = Math.min(FIELD_RADIUS, CHUNK_SIZE - 1 - lxBase);
      const minDz = Math.max(-FIELD_RADIUS, -lzBase);
      const maxDz = Math.min(FIELD_RADIUS, CHUNK_SIZE - 1 - lzBase);
      const minDy = Math.max(-FIELD_RADIUS, -sy);
      const maxDy = Math.min(FIELD_RADIUS, WORLD_HEIGHT - 1 - sy);

      for (let dy = minDy; dy <= maxDy; dy += 1) {
        const yy = sy + dy;
        const dySq = dy * dy;
        for (let dz = minDz; dz <= maxDz; dz += 1) {
          const lz = lzBase + dz;
          const dySzq = dySq + dz * dz;
          if (dySzq > radiusSq) continue;
          const rowBase = (yy * CHUNK_SIZE + lz) * CHUNK_SIZE;
          for (let dx = minDx; dx <= maxDx; dx += 1) {
            const distSq = dySzq + dx * dx;
            if (distSq > radiusSq) continue;
            const dist = Math.sqrt(distSq);
            const t = 1 - dist / denom;
            if (t <= 0) continue;
            const strength = eScale * Math.pow(t, 1.65);
            if (strength <= 0.001) continue;
            const index = rowBase + (lxBase + dx);
            this.fieldIntensity[index] += strength;
            this.fieldR[index] += tr * strength;
            this.fieldG[index] += tg * strength;
            this.fieldB[index] += tb * strength;
          }
        }
      }
    }

    // Normalisation identique au gather : couleur = moyenne pondérée, intensité
    // plafonnée à 1.6.
    for (let i = 0; i < FIELD_CELLS; i += 1) {
      const raw = this.fieldIntensity[i];
      if (raw <= 0) continue;
      this.fieldR[i] /= raw;
      this.fieldG[i] /= raw;
      this.fieldB[i] /= raw;
      this.fieldIntensity[i] = raw > 1.6 ? 1.6 : raw;
    }
    this.hasField = true;
  }

  /** Gather exact (identique à l'ancien sampleLocalLight) pour un rayon donné. */
  private gather(ix: number, iy: number, iz: number, r: number): LocalLightSample {
    let intensity = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let sources = 0;
    const denom = r + 1;
    const radiusSq = r * r;
    for (let s = 0; s < this.srcX.length; s += 1) {
      const dx = this.srcX[s] - ix;
      const dy = this.srcY[s] - iy;
      const dz = this.srcZ[s] - iz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > radiusSq) continue;
      const dist = Math.sqrt(distSq);
      const t = 1 - dist / denom;
      if (t <= 0) continue;
      const strength = (this.srcE[s] / 15) * Math.pow(t, 1.65);
      if (strength <= 0.001) continue;
      intensity += strength;
      red += this.srcR[s] * strength;
      green += this.srcG[s] * strength;
      blue += this.srcB[s] * strength;
      sources += 1;
    }
    if (intensity <= 0) return NO_LOCAL_LIGHT;
    const sample = this.reusableSample;
    sample.intensity = intensity > 1.6 ? 1.6 : intensity;
    sample.r = red / intensity;
    sample.g = green / intensity;
    sample.b = blue / intensity;
    sample.sources = sources;
    return sample;
  }

  private emissionTintFor(key: string): { r: number; g: number; b: number } {
    if (key.includes("sea_lantern")) return { r: 0.62, g: 0.95, b: 1.05 };
    if (key.includes("furnace") || key.includes("campfire")) return { r: 1.18, g: 0.58, b: 0.28 };
    if (key.includes("lantern")) return { r: 1.12, g: 0.78, b: 0.42 };
    if (key.includes("crying_obsidian")) return { r: 0.58, g: 0.32, b: 1.08 };
    if (key.includes("glowstone")) return { r: 1.12, g: 0.92, b: 0.5 };
    return { r: 1, g: 0.86, b: 0.62 };
  }
}

const EMPTY_SOURCES = new Float32Array(0);
