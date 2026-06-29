import { SnowBurialState } from "./SnowBurialSystem";
import { SnowDepthState } from "./SnowDepthSystem";

export interface SnowCoverVisual {
  groundWhitening: number;
  vegetationWhitening: number;
  roofWhitening: number;
  edgeSoftness: number;
}

export class SnowCoverRenderer {
  resolve(snow: SnowDepthState, burial: SnowBurialState, frost: number): SnowCoverVisual {
    return {
      groundWhitening: Math.min(1, snow.snowDepth * 1.25 + frost * 0.18),
      vegetationWhitening: Math.min(1, burial.grassBurial * 0.82 + frost * 0.34),
      roofWhitening: Math.min(1, burial.roofLoad * 0.95 + frost * 0.1),
      edgeSoftness: Math.min(1, 0.2 + snow.driftBias * 0.45 + snow.snowDepth * 0.22),
    };
  }
}
