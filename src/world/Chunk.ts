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

  setLocal(x: number, y: number, z: number, blockId: BlockId): void {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return;
    }
    this.blocks[this.index(x, y, z)] = blockId;
    this.dirty = true;
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
