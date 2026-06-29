import { BlockConnectionState, NO_CONNECTIONS } from "./BlockConnections";
import { BlockShape } from "./blockstate/BlockShape";

export type GeometryBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export class BlockGeometryBuilder {
  static boxesFor(shape: BlockShape | undefined, connections: BlockConnectionState = NO_CONNECTIONS, renderHeight = 1): GeometryBox[] {
    switch (shape) {
      case "flat":
        return [box(0, 0, 0, 1, Math.max(0.025, renderHeight), 1)];
      case "path":
        return [box(0, 0, 0, 1, 1, 1)];
      case "slab_bottom":
        return [box(0, 0, 0, 1, 0.5, 1)];
      case "slab_top":
        return [box(0, 0.5, 0, 1, 1, 1)];
      case "stair_north":
        return [box(0, 0, 0, 1, 0.5, 1), box(0, 0.5, 0, 1, 1, 0.5)];
      case "stair_south":
        return [box(0, 0, 0, 1, 0.5, 1), box(0, 0.5, 0.5, 1, 1, 1)];
      case "stair_east":
        return [box(0, 0, 0, 1, 0.5, 1), box(0.5, 0.5, 0, 1, 1, 1)];
      case "stair_west":
        return [box(0, 0, 0, 1, 0.5, 1), box(0, 0.5, 0, 0.5, 1, 1)];
      case "fence":
        return fenceBoxes(connections);
      case "wall":
        return wallBoxes(connections);
      case "pane":
        return paneBoxes(connections);
      case "door_north":
        return [box(0.08, 0, 0.02, 0.92, 1, 0.14)];
      case "door_south":
        return [box(0.08, 0, 0.86, 0.92, 1, 0.98)];
      case "door_east":
        return [box(0.86, 0, 0.08, 0.98, 1, 0.92)];
      case "door_west":
        return [box(0.02, 0, 0.08, 0.14, 1, 0.92)];
      case "roof_north":
        return [box(0, 0, 0.5, 1, 0.5, 1), box(0, 0.5, 0, 1, 1, 0.5)];
      case "roof_south":
        return [box(0, 0, 0, 1, 0.5, 0.5), box(0, 0.5, 0.5, 1, 1, 1)];
      case "roof_east":
        return [box(0, 0, 0, 0.5, 0.5, 1), box(0.5, 0.5, 0, 1, 1, 1)];
      case "roof_west":
        return [box(0.5, 0, 0, 1, 0.5, 1), box(0, 0.5, 0, 0.5, 1, 1)];
      case "post":
        return [box(0.34, 0, 0.34, 0.66, 1, 0.66)];
      case "lantern_post":
        return [box(0.42, 0, 0.42, 0.58, 1, 0.58), box(0.25, 0.76, 0.25, 0.75, 1, 0.75)];
      case "hanging_lantern":
        return [box(0.46, 0.5, 0.46, 0.54, 1, 0.54), box(0.25, 0.18, 0.25, 0.75, 0.68, 0.75)];
      case "cube":
      default:
        return [box(0, 0, 0, 1, renderHeight, 1)];
    }
  }
}

function fenceBoxes(c: BlockConnectionState): GeometryBox[] {
  const boxes = [box(0.36, 0, 0.36, 0.64, 1.24, 0.64)];
  if (c.north) boxes.push(box(0.42, 0.38, 0, 0.58, 0.58, 0.5), box(0.42, 0.82, 0, 0.58, 1.02, 0.5));
  if (c.south) boxes.push(box(0.42, 0.38, 0.5, 0.58, 0.58, 1), box(0.42, 0.82, 0.5, 0.58, 1.02, 1));
  if (c.west) boxes.push(box(0, 0.38, 0.42, 0.5, 0.58, 0.58), box(0, 0.82, 0.42, 0.5, 1.02, 0.58));
  if (c.east) boxes.push(box(0.5, 0.38, 0.42, 1, 0.58, 0.58), box(0.5, 0.82, 0.42, 1, 1.02, 0.58));
  return boxes;
}

function wallBoxes(c: BlockConnectionState): GeometryBox[] {
  const boxes = [box(0.3, 0, 0.3, 0.7, 1.15, 0.7)];
  if (c.north) boxes.push(box(0.32, 0, 0, 0.68, 0.85, 0.5));
  if (c.south) boxes.push(box(0.32, 0, 0.5, 0.68, 0.85, 1));
  if (c.west) boxes.push(box(0, 0, 0.32, 0.5, 0.85, 0.68));
  if (c.east) boxes.push(box(0.5, 0, 0.32, 1, 0.85, 0.68));
  return boxes;
}

function paneBoxes(c: BlockConnectionState): GeometryBox[] {
  const hasAny = c.north || c.south || c.east || c.west;
  const boxes: GeometryBox[] = [];
  if (!hasAny || c.north) boxes.push(box(0.46, 0, 0, 0.54, 1, 0.54));
  if (!hasAny || c.south) boxes.push(box(0.46, 0, 0.46, 0.54, 1, 1));
  if (!hasAny || c.west) boxes.push(box(0, 0, 0.46, 0.54, 1, 0.54));
  if (!hasAny || c.east) boxes.push(box(0.46, 0, 0.46, 1, 1, 0.54));
  return boxes;
}

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): GeometryBox {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}
