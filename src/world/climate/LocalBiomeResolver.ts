import { BiomeId } from "../BiomeGenerator";
import { HydrologySample } from "../HydrologyPlanner";
import { ClimateRegionSample } from "./ClimateRegionMap";

export class LocalBiomeResolver {
  refine(base: BiomeId, climate: ClimateRegionSample, hydrology: HydrologySample): BiomeId {
    if (hydrology.river > 0.62 || hydrology.stream > 0.82) return "riverbank";
    if (hydrology.lake > 0.56) return "lake";
    if ((base === "plains" || base === "dry_prairie") && climate.fertility > 0.72 && climate.humidity > 0.5) return "flower_meadow";
    return base;
  }
}
