import { Noise } from "../../utils/Noise";
import { BiomeId } from "../BiomeGenerator";

export type MicroBiomeDebug = {
  patch: "open" | "edge" | "clearing" | "understory" | "wet" | "rock";
  value: number;
};

export class MicroBiomePlanner {
  constructor(private readonly noise: Noise) {}

  debug(x: number, z: number, biome: BiomeId): MicroBiomeDebug {
    const value = (this.noise.fbm2D(x * 0.008, z * 0.008, 3) + 1) * 0.5;
    if (biome === "marsh" || biome === "bog" || biome === "riverbank") return { patch: "wet", value };
    if (biome.includes("forest")) return { patch: value > 0.72 ? "clearing" : value < 0.32 ? "understory" : "edge", value };
    if (biome === "mountains" || biome === "cliffs") return { patch: "rock", value };
    return { patch: "open", value };
  }
}
