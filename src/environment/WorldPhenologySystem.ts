import { clamp } from "../utils/MathUtils";
import { EnvironmentSurfaceState, EnvironmentVisualState } from "./EnvironmentState";
import { SeasonState } from "../living/SeasonSystem";

export class WorldPhenologySystem {
  resolve(season: SeasonState, surface: EnvironmentSurfaceState, temperature: number, humidity: number, dayFactor: number): EnvironmentVisualState {
    const heatDryness = clamp((temperature - 25) / 16, 0, 1) * clamp(0.72 - humidity, 0, 1);
    const winter = season.season === "winter" ? 1 : 0;
    const autumn = season.season === "autumn" ? season.progress : 0;
    const springBloom = season.season === "spring" ? 1 - Math.abs(season.progress - 0.48) * 1.5 : 0;
    const frost = Math.max(surface.frost, surface.ice * 0.7, temperature < -2 ? clamp((-temperature - 2) / 10, 0, 1) * 0.3 : 0);
    const snow = clamp(Math.max(surface.groundSnowWhitening, surface.snowDepth * 1.3) + season.snowBias * 0.15, 0, 1);
    const winterLeafDrop = winter * clamp(0.55 + season.progress * 0.34 + frost * 0.12, 0, 0.92);
    const wetness = clamp(surface.wetness + surface.dew * 0.25, 0, 1);
    return {
      season: season.season,
      vegetation: clamp(season.vegetation - heatDryness * 0.28 - frost * 0.12, 0.12, 1),
      leafWarmth: clamp(season.leafWarmth + autumn * 0.22, 0, 1),
      leafDrop: clamp(winterLeafDrop + autumn * 0.38 + heatDryness * 0.12, 0, 0.96),
      flowering: clamp(springBloom * 0.95 + (season.season === "summer" ? 0.35 : 0), 0, 1),
      dryness: clamp(heatDryness + (dayFactor > 0.6 ? Math.max(0, 0.18 - humidity * 0.18) : 0), 0, 1),
      frost,
      snow,
      snowGround: surface.groundSnowWhitening,
      snowVegetation: surface.vegetationSnowWhitening,
      snowRoof: surface.roofSnow,
      snowEdgeSoftness: surface.snowEdgeSoftness,
      snowRoadCompaction: surface.roadCompaction,
      wetDarkening: surface.wetDarkening,
      wetGloss: surface.wetGloss,
      puddleAlpha: surface.puddleAlpha,
      mudTint: surface.mudTint,
      wetness,
      haze: clamp(heatDryness * 0.34 + humidity * 0.18 + surface.dew * 0.08 + surface.wetGloss * 0.08, 0, 1),
      heatShimmer: clamp((temperature - 27) / 14, 0, 1) * clamp(1 - humidity * 0.55, 0, 1),
    };
  }
}
