import * as THREE from "three";
import { TextureManager } from "../assets/TextureManager";
import { CHUNK_SIZE, DEFAULT_RENDER_DISTANCE, DEFAULT_UNLOAD_DISTANCE } from "../utils/Constants";
import { worldToChunk } from "../utils/MathUtils";
import { BlockRegistry } from "./BlockRegistry";
import { Chunk } from "./Chunk";
import { ChunkMesher } from "./ChunkMesher";
import { World } from "./World";

type RingOffset = { dx: number; dz: number; dist: number };

export type ChunkDebugCounts = {
  loaded: number;
  meshed: number;
  dirty: number;
  pending: number;
};

/**
 * Gestion du chargement/meshing des chunks.
 *
 * Refonte perf :
 *  - anneau d'offsets pré-calculé et trié par distance (aucun tri/allocation par
 *    frame) ;
 *  - génération priorisée « devant le joueur » puis « le plus proche » ;
 *  - dès que tout le rayon est chargé et que le joueur ne change pas de chunk, la
 *    boucle de chargement/déchargement ne coûte plus rien (`allLoaded`) ;
 *  - le rebuild ne trie que le (petit) sous-ensemble de chunks dirty, du plus
 *    proche au plus loin ;
 *  - le nouveau mesh est construit AVANT de retirer l'ancien : aucun trou noir /
 *    pop visuel ;
 *  - les chunks déchargés ne sont jamais reconstruits (tâches inutiles annulées).
 */
export class ChunkManager {
  readonly mesher: ChunkMesher;
  renderDistance = DEFAULT_RENDER_DISTANCE;
  unloadDistance = DEFAULT_UNLOAD_DISTANCE;
  maxChunkGenerationsPerFrame = 1;
  maxChunkRebuildsPerFrame = 1;
  /**
   * Budget temps (ms) alloué au travail chunk par frame. On s'arrête avant de
   * dépasser ce budget : les frames restent bornées même quand un chunk dense
   * coûte cher (au lieu de faire N chunks × coût variable = gros pic). C'est le
   * garde-fou anti-freeze principal en attendant un vrai WorkerPool.
   */
  frameBudgetMs = 6;
  // Chronos remplis chaque frame pour le profiler (ms). Génération / meshing
  // (hors lumière) / lumière. Coût négligeable (n'entoure que le travail réel).
  profGenMs = 0;
  profMeshMs = 0;
  profLightMs = 0;
  private totalTriangles = 0;

  private offsets: RingOffset[] = [];
  private offsetsBuiltFor = -1;
  private lastPcx = Number.NaN;
  private lastPcz = Number.NaN;
  private allLoaded = false;
  // Réutilisé chaque frame pour la liste des chunks dirty (évite l'allocation).
  private readonly dirtyScratch: Chunk[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    blockRegistry: BlockRegistry,
    private readonly textureManager: TextureManager,
  ) {
    this.mesher = new ChunkMesher(world, blockRegistry, textureManager.atlas);
  }

  update(playerPosition: THREE.Vector3, facingX?: number, facingZ?: number): void {
    const pcx = worldToChunk(playerPosition.x);
    const pcz = worldToChunk(playerPosition.z);
    this.ensureOffsets();

    const movedChunk = pcx !== this.lastPcx || pcz !== this.lastPcz;
    if (movedChunk) {
      this.allLoaded = false;
      this.lastPcx = pcx;
      this.lastPcz = pcz;
    }

    this.profGenMs = 0;
    this.profMeshMs = 0;
    this.profLightMs = 0;
    const deadline = performance.now() + this.frameBudgetMs;
    // Meshing d'abord (rend visibles les chunks déjà générés → pas de trou noir /
    // backlog invisible qui gonfle), puis génération avec le budget restant.
    this.rebuildDirty(this.maxChunkRebuildsPerFrame, pcx, pcz, deadline);
    if (!this.allLoaded) {
      this.loadAround(pcx, pcz, this.maxChunkGenerationsPerFrame, facingX, facingZ, deadline);
    }
    if (movedChunk) {
      this.unloadFarChunks(pcx, pcz);
    }
  }

  getStats(): { loadedChunks: number; triangles: number } {
    return { loadedChunks: this.world.chunks.size, triangles: this.totalTriangles };
  }

  /** Compteurs pour le profiler (calculés à la demande). */
  getDebugCounts(): ChunkDebugCounts {
    let meshed = 0;
    let dirty = 0;
    for (const chunk of this.world.chunks.values()) {
      if (chunk.opaqueMesh || chunk.transparentMesh || chunk.waterMesh) meshed += 1;
      if (chunk.dirty) dirty += 1;
    }
    let pending = 0;
    for (const o of this.offsets) {
      if (!this.world.getChunk(this.lastPcx + o.dx, this.lastPcz + o.dz)) pending += 1;
    }
    return { loaded: this.world.chunks.size, meshed, dirty, pending };
  }

  dispose(): void {
    this.world.chunks.forEach((chunk) => this.removeChunkMeshes(chunk));
  }

  /** (Re)construit l'anneau d'offsets trié par distance quand le rayon change. */
  private ensureOffsets(): void {
    if (this.offsetsBuiltFor === this.renderDistance) return;
    const r = this.renderDistance;
    const rSq = r * r;
    const offsets: RingOffset[] = [];
    for (let dz = -r; dz <= r; dz += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const dist = dx * dx + dz * dz;
        if (dist > rSq) continue;
        offsets.push({ dx, dz, dist });
      }
    }
    offsets.sort((a, b) => a.dist - b.dist);
    this.offsets = offsets;
    this.offsetsBuiltFor = r;
    this.allLoaded = false;
  }

  private loadAround(
    pcx: number,
    pcz: number,
    maxNewChunks: number,
    facingX: number | undefined,
    facingZ: number | undefined,
    deadline: number,
  ): void {
    if (performance.now() >= deadline) return;
    let generated = 0;
    let hitBudget = false;
    const hasFacing = facingX !== undefined && facingZ !== undefined && (facingX !== 0 || facingZ !== 0);

    // Passe 1 : chunks devant le joueur (dot ≥ 0) ; passe 2 : le reste. Chaque
    // passe suit l'ordre pré-trié par distance, donc « devant puis proche ».
    for (let pass = 0; pass < 2 && generated < maxNewChunks; pass += 1) {
      const frontOnly = pass === 0 && hasFacing;
      for (const o of this.offsets) {
        if (generated >= maxNewChunks || performance.now() >= deadline) {
          hitBudget = true;
          break;
        }
        if (frontOnly && o.dx * (facingX as number) + o.dz * (facingZ as number) < 0) continue;
        if (this.world.getChunk(pcx + o.dx, pcz + o.dz)) continue;
        const g0 = performance.now();
        this.world.ensureChunk(pcx + o.dx, pcz + o.dz);
        this.profGenMs += performance.now() - g0;
        generated += 1;
      }
      if (!frontOnly) break; // la passe 2 (frontOnly=false) couvre tout
    }

    if (generated < maxNewChunks && !hitBudget) {
      // Budget non atteint et pas coupé par le temps : plus rien à générer.
      this.allLoaded = true;
    }
  }

  private rebuildDirty(maxRebuilds: number, pcx: number, pcz: number, deadline: number): void {
    const dirty = this.dirtyScratch;
    dirty.length = 0;
    for (const chunk of this.world.chunks.values()) {
      if (chunk.dirty) dirty.push(chunk);
    }
    if (dirty.length === 0) return;
    if (dirty.length > maxRebuilds) {
      // Ne trie que le sous-ensemble dirty (rarement grand), plus proche d'abord.
      dirty.sort((a, b) => {
        const da = (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2;
        const db = (b.cx - pcx) ** 2 + (b.cz - pcz) ** 2;
        return da - db;
      });
    }
    const count = Math.min(maxRebuilds, dirty.length);
    for (let i = 0; i < count; i += 1) {
      // Toujours mailler au moins un chunk (le plus proche) même si le budget
      // temps est déjà consommé, sinon un chunk dirty près du joueur pourrait
      // rester invisible indéfiniment. Au-delà, on respecte le budget.
      if (i > 0 && performance.now() >= deadline) break;
      this.rebuildChunk(dirty[i]);
    }
    dirty.length = 0;
  }

  private rebuildChunk(chunk: Chunk): void {
    // Construit d'abord la nouvelle géométrie, PUIS remplace l'ancienne : jamais
    // de frame sans mesh (pas de trou noir).
    const m0 = performance.now();
    const result = this.mesher.build(chunk);
    this.profMeshMs += performance.now() - m0 - this.mesher.lastLightingMs;
    this.profLightMs += this.mesher.lastLightingMs;
    this.removeChunkMeshes(chunk);
    chunk.triangleCount = result.triangles;

    if (result.opaque) {
      chunk.opaqueMesh = new THREE.Mesh(result.opaque, this.textureManager.opaqueMaterial);
      chunk.opaqueMesh.frustumCulled = true;
      chunk.opaqueMesh.castShadow = true;
      chunk.opaqueMesh.receiveShadow = true;
      this.scene.add(chunk.opaqueMesh);
    }
    if (result.transparent) {
      chunk.transparentMesh = new THREE.Mesh(result.transparent, this.textureManager.transparentMaterial);
      chunk.transparentMesh.frustumCulled = true;
      chunk.transparentMesh.renderOrder = 2;
      chunk.transparentMesh.castShadow = false;
      // Le feuillage PROJETTE des ombres (joli dappling au sol) mais n'en REÇOIT
      // pas : sinon une canopée dense s'auto-ombrage et vire au noir à contre-jour.
      chunk.transparentMesh.receiveShadow = false;
      this.scene.add(chunk.transparentMesh);
    }
    if (result.water) {
      const waterMesh = new THREE.Mesh(result.water, this.textureManager.waterMaterial);
      waterMesh.frustumCulled = true;
      waterMesh.renderOrder = 3;
      waterMesh.receiveShadow = true;
      chunk.waterMesh = waterMesh;
      this.scene.add(waterMesh);
    }
    this.totalTriangles += result.triangles;
    chunk.dirty = false;
  }

  private unloadFarChunks(pcx: number, pcz: number): void {
    for (const [key, chunk] of this.world.chunks.entries()) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) <= this.unloadDistance) {
        continue;
      }
      this.removeChunkMeshes(chunk);
      this.world.deleteChunk(key);
    }
  }

  private removeChunkMeshes(chunk: Chunk): void {
    if (chunk.triangleCount > 0) {
      this.totalTriangles = Math.max(0, this.totalTriangles - chunk.triangleCount);
      chunk.triangleCount = 0;
    }
    if (chunk.opaqueMesh) {
      this.scene.remove(chunk.opaqueMesh);
      chunk.opaqueMesh.geometry.dispose();
      chunk.opaqueMesh = null;
    }
    if (chunk.transparentMesh) {
      this.scene.remove(chunk.transparentMesh);
      chunk.transparentMesh.geometry.dispose();
      chunk.transparentMesh = null;
    }
    if (chunk.waterMesh) {
      this.scene.remove(chunk.waterMesh);
      chunk.waterMesh.geometry.dispose();
      chunk.waterMesh = null;
    }
  }
}
