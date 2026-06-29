export type BlockOrientation = "north" | "south" | "east" | "west" | "up" | "down" | "none";

export function orientationFromShape(shape?: string): BlockOrientation {
  if (!shape) return "none";
  if (shape.endsWith("_north")) return "north";
  if (shape.endsWith("_south")) return "south";
  if (shape.endsWith("_east")) return "east";
  if (shape.endsWith("_west")) return "west";
  return "none";
}
