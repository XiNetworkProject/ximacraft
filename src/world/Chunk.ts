import * as THREE from "three";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../utils/Constants";
import { BlockId } from "./BlockTypes";

export class Chunk {
  readonly blocks = new Uint16Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
  opaqueMesh: THREE.Mesh | null = null;
  transparentMesh: THREE.Mesh | null = null;
  waterMesh: THREE.Mesh | null = null;
  dirty = true;
  generated = false;
  triangleCount = 0;
  /**
   * Cache des sources lumineuses du chunk (packed: x,y,z,emission,r,g,b × n),
   * utilisé par LightingEngine. `null` = jamais calculé ; recalculé quand
   * `lightDirty` est vrai (un bloc a changé).
   */
  lightSources: Float32Array | null = null;
  lightDirty = true;
  /**
   * Vrai quand la surface (bloc plein le plus haut, hors couches de neige) a pu
   * changer depuis le dernier scan du système de neige. Les couches de neige
   * ne l'invalident pas (elles ne modifient pas la surface).
   */
  snowSurfaceDirty = true;

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {}

  getLocal(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return BlockId.AIR;
    }
    return this.blocks[this.index(x, y, z)] as BlockId;
  }

  setLocal(x: number, y: number, z: number, blockId: BlockId, affectsSurface = true): void {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return;
    }
    this.blocks[this.index(x, y, z)] = blockId;
    this.dirty = true;
    this.lightDirty = true;
    if (affectsSurface) this.snowSurfaceDirty = true;
  }

  dispose(): void {
    this.opaqueMesh?.geometry.dispose();
    this.transparentMesh?.geometry.dispose();
    this.waterMesh?.geometry.dispose();
    this.opaqueMesh = null;
    this.transparentMesh = null;
    this.waterMesh = null;
  }

  private index(x: number, y: number, z: number): number {
    return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
  }
}
