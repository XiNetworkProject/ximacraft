import { SnowDepthState } from "./SnowDepthSystem";

export interface SnowBurialState {
  grassBurial: number;
  flowerBurial: number;
  bushCompression: number;
  roofLoad: number;
  roadCompaction: number;
}

export class SnowBurialSystem {
  resolve(snow: SnowDepthState, traffic = 0): SnowBurialState {
    return {
      grassBurial: Math.min(1, snow.burial * 1.35),
      flowerBurial: Math.min(1, snow.burial * 1.7),
      bushCompression: Math.min(1, snow.burial * 0.8 + snow.driftBias * 0.2),
      roofLoad: Math.min(1, snow.snowDepth * 0.85 + snow.driftBias * 0.18),
      roadCompaction: Math.min(1, snow.compacted + traffic * 0.65),
    };
  }
}
