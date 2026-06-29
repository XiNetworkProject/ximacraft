import { clamp } from "../../utils/MathUtils";
import { Noise } from "../../utils/Noise";

export interface ClimateRegionSample {
  regionX: number;
  regionZ: number;
  regionSize: number;
  temperature: number;
  humidity: number;
  continentality: number;
  erosion: number;
  fertility: number;
  forestAge: number;
  seasonalDryness: number;
  snowPotential: number;
  exposure: number;
}

export class ClimateRegionMap {
  constructor(private readonly noise: Noise) {}

  sample(x: number, z: number): ClimateRegionSample {
    const regionSize = 2048;
    const regionX = Math.floor(x / regionSize);
    const regionZ = Math.floor(z / regionSize);
    const continentality = field(this.noise, x, z, 0.00034, 110, -240, 5);
    const temperatureBase = field(this.noise, x, z, 0.00038, 29.3, -71.4, 5);
    const humidityBase = field(this.noise, x, z, 0.00042, -93.7, 12.5, 5);
    const exposure = field(this.noise, x, z, 0.00072, 620, -380, 3);
    const erosion = field(this.noise, x, z, 0.00064, 90, -120, 4);
    const forestAge = field(this.noise, x, z, 0.00046, 505, -303, 4);
    const seasonalDryness = field(this.noise, x, z, 0.00058, -800, 620, 4);
    const fertility = clamp(humidityBase * 0.58 + (1 - erosion) * 0.18 + forestAge * 0.18 + (1 - seasonalDryness) * 0.16, 0, 1);
    const temperature = clamp(temperatureBase + (exposure - 0.5) * 0.18 - continentality * 0.06, 0, 1);
    const humidity = clamp(humidityBase + (1 - continentality) * 0.12 - seasonalDryness * 0.08, 0, 1);
    const snowPotential = clamp((0.44 - temperature) * 1.8 + continentality * 0.18 + humidity * 0.16, 0, 1);

    return {
      regionX,
      regionZ,
      regionSize,
      temperature,
      humidity,
      continentality,
      erosion,
      fertility,
      forestAge,
      seasonalDryness,
      snowPotential,
      exposure,
    };
  }
}

function field(noise: Noise, x: number, z: number, scale: number, ox: number, oz: number, octaves: number): number {
  return clamp((noise.fbm2D(x * scale + ox, z * scale + oz, octaves) + 1) * 0.5, 0, 1);
}
