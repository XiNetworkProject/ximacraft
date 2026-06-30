import type { QualityPreset } from "../../../game/Settings";

export interface FogLodSettings {
  maxBanks: number;
  slices: number;
  distanceFade: number;
  geometryDetail: number;
}

export class FogLodSystem {
  settingsFor(distance: number, density: number, quality: QualityPreset): FogLodSettings {
    const qualityScale = quality === "high" ? 1 : quality === "balanced" ? 0.74 : 0.48;
    const distance01 = Math.min(1, distance / (quality === "high" ? 2600 : quality === "balanced" ? 1900 : 1300));
    const densityBoost = density > 0.52 ? 1 : 0.72;
    return {
      maxBanks: quality === "high" ? 16 : quality === "balanced" ? 10 : 6,
      slices: Math.max(2, Math.round((quality === "high" ? 7 : quality === "balanced" ? 5 : 3) * densityBoost * (1 - distance01 * 0.42))),
      distanceFade: Math.max(0, 1 - distance01),
      geometryDetail: Math.max(1, Math.round(3 * qualityScale * (1 - distance01 * 0.55))),
    };
  }

  maxDistance(quality: QualityPreset): number {
    return quality === "high" ? 2800 : quality === "balanced" ? 2100 : 1450;
  }
}
