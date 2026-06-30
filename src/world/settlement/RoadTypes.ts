export type RoadKind =
  | "trail"
  | "rural"
  | "forest"
  | "mountain"
  | "village"
  | "ancient"
  | "riverbank";

export interface RoadWaterContext {
  strength: number;
  width: number;
  flowX: number;
  flowZ: number;
  current: number;
  category?: string;
}

export interface RoadSample {
  strength: number;
  dirX: number;
  dirZ: number;
  kind: RoadKind;
  width: number;
  importance: number;
  bridge: boolean;
}

export interface RoadPathPoint {
  x: number;
  z: number;
}

export interface RoadPath {
  id: string;
  kind: RoadKind;
  importance: number;
  width: number;
  points: RoadPathPoint[];
}
