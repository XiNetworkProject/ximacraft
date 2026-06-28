import { SEA_LEVEL } from "../utils/Constants";
import { Noise } from "../utils/Noise";

export type BiomeId = "plains" | "forest" | "desert" | "hills" | "mountains" | "beach" | "snow";

export type BiomeSample = {
  id: BiomeId;
  temperature: number;
  humidity: number;
};

export class BiomeGenerator {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number, roughHeight: number): BiomeSample {
    const temperature = (this.noise.fbm2D(x * 0.0018 + 29.3, z * 0.0018 - 71.4, 4) + 1) * 0.5;
    const humidity = (this.noise.fbm2D(x * 0.0022 - 93.7, z * 0.0022 + 12.5, 4) + 1) * 0.5;

    if (roughHeight <= SEA_LEVEL + 2 && roughHeight >= SEA_LEVEL - 3) {
      return { id: "beach", temperature, humidity };
    }
    if (roughHeight > 84 || (roughHeight > 72 && temperature < 0.42)) {
      return { id: temperature < 0.35 ? "snow" : "mountains", temperature, humidity };
    }
    if (roughHeight > 62) {
      return { id: "hills", temperature, humidity };
    }
    if (temperature > 0.64 && humidity < 0.35) {
      return { id: "desert", temperature, humidity };
    }
    if (humidity > 0.56) {
      return { id: "forest", temperature, humidity };
    }
    return { id: "plains", temperature, humidity };
  }
}
