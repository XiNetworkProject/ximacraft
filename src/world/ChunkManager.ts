import * as THREE from "three";
import { TextureManager } from "../assets/TextureManager";
import { DEFAULT_RENDER_DISTANCE, DEFAULT_UNLOAD_DISTANCE } from "../utils/Constants";
import { chunkKey, worldToChunk } from "../utils/MathUtils";
import { BlockRegistry } from "./BlockRegistry";
import { Chunk } from "./Chunk";
import { ChunkMesher } from "./ChunkMesher";
import { World } from "./World";

export class ChunkManager {
  readonly mesher: ChunkMesher;
  renderDistance = DEFAULT_RENDER_DISTANCE;
  unloadDistance = DEFAULT_UNLOAD_DISTANCE;
  maxChunkGenerationsPerFrame = 1;
  maxChunkRebuildsPerFrame = 1;
  private totalTriangles = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    blockRegistry: BlockRegistry,
    private readonly textureManager: TextureManager,
  ) {
    this.mesher = new ChunkMesher(world, blockRegistry, textureManager.atlas);
  }

  update(playerPosition: THREE.Vector3): void {
    const pcx = worldToChunk(playerPosition.x);
    const pcz = worldToChunk(playerPosition.z);
    this.loadAround(pcx, pcz, this.maxChunkGenerationsPerFrame);
    this.rebuildDirty(this.maxChunkRebuildsPerFrame);
    this.unloadFarChunks(pcx, pcz);
  }

  getStats(): { loadedChunks: number; triangles: number } {
    return { loadedChunks: this.world.chunks.size, triangles: this.totalTriangles };
  }

  dispose(): void {
    this.world.chunks.forEach((chunk) => this.removeChunkMeshes(chunk));
  }

  private loadAround(pcx: number, pcz: number, maxNewChunks: number): void {
    const candidates: Array<{ cx: number; cz: number; dist: number }> = [];
    for (let dz = -this.renderDistance; dz <= this.renderDistance; dz += 1) {
      for (let dx = -this.renderDistance; dx <= this.renderDistance; dx += 1) {
        const dist = dx * dx + dz * dz;
        if (dist > this.renderDistance * this.renderDistance) {
          continue;
        }
        candidates.push({ cx: pcx + dx, cz: pcz + dz, dist });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    let generated = 0;
    for (const candidate of candidates) {
      if (this.world.getChunk(candidate.cx, candidate.cz)) {
        continue;
      }
      this.world.ensureChunk(candidate.cx, candidate.cz);
      generated += 1;
      if (generated >= maxNewChunks) {
        break;
      }
    }
  }

  private rebuildDirty(maxRebuilds: number): void {
    let rebuilt = 0;
    for (const chunk of this.world.chunks.values()) {
      if (!chunk.dirty) {
        continue;
      }
      this.rebuildChunk(chunk);
      rebuilt += 1;
      if (rebuilt >= maxRebuilds) {
        break;
      }
    }
  }

  private rebuildChunk(chunk: Chunk): void {
    this.removeChunkMeshes(chunk);
    const result = this.mesher.build(chunk);
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
      this.world.chunks.delete(key);
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
