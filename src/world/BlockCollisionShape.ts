import { BlockShape } from "./blockstate/BlockShape";

export type BlockCollisionShape = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export function collisionHeightForShape(shape: BlockShape | undefined, fallback = 1): number {
  switch (shape) {
    case "flat":
      return 0.04;
    case "path":
      return 0.12;
    case "slab_bottom":
      return 0.5;
    case "fence":
    case "wall":
    case "post":
    case "lantern_post":
      return 1.5;
    default:
      return fallback;
  }
}
