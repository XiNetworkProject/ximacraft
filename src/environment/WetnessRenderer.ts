import { EnvironmentSurfaceState } from "./EnvironmentState";

export interface WetnessVisual {
  darkening: number;
  gloss: number;
  puddleAlpha: number;
  mudTint: number;
}

export class WetnessRenderer {
  resolve(surface: EnvironmentSurfaceState): WetnessVisual {
    return {
      darkening: Math.min(0.28, surface.wetness * 0.24 + surface.dew * 0.06),
      gloss: Math.min(0.72, surface.wetness * 0.58 + surface.ice * 0.18),
      puddleAlpha: Math.min(0.7, surface.puddles * 0.64),
      mudTint: Math.min(0.6, surface.mud * 0.52),
    };
  }
}
