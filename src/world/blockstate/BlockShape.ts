export type BlockShape =
  | "cube"
  | "cross"
  | "flat"
  | "slab_bottom"
  | "slab_top"
  | "stair_north"
  | "stair_south"
  | "stair_east"
  | "stair_west"
  | "fence"
  | "wall"
  | "pane"
  | "door_north"
  | "door_south"
  | "door_east"
  | "door_west"
  | "roof_north"
  | "roof_south"
  | "roof_east"
  | "roof_west"
  | "post"
  | "lantern_post"
  | "hanging_lantern"
  | "path";

export function isConnectedShape(shape: BlockShape | undefined): boolean {
  return shape === "fence" || shape === "wall" || shape === "pane";
}
