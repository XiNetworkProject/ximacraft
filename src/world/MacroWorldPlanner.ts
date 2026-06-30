import { SEA_LEVEL, WORLD_HEIGHT } from "../utils/Constants";
import { clamp } from "../utils/MathUtils";
import { Noise } from "../utils/Noise";
import { HydrologyPlanner, HydrologySample } from "./HydrologyPlanner";

export type MacroWorldSample = {
  altitude: number;
  continentality: number;
  humidity: number;
  temperature: number;
  erosion: number;
  terrainAge: number;
  mountainMask: number;
  hydrology: HydrologySample;
};

export class MacroWorldPlanner {
  readonly hydrology: HydrologyPlanner;
  private readonly sampleCache = new Map<string, MacroWorldSample>();

  constructor(private readonly noise: Noise) {
    this.hydrology = new HydrologyPlanner(noise);
  }

  sample(x: number, z: number): MacroWorldSample {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const key = `${ix},${iz}`;
    const cached = this.sampleCache.get(key);
    if (cached) return cached;
    if (this.sampleCache.size > 420_000) this.sampleCache.clear();
    x = ix;
    z = iz;
    const continentality = this.norm(this.noise.fbm2D(x * 0.00145, z * 0.00145, 5));
    const humidity = this.norm(this.noise.fbm2D(x * 0.0019 - 93.7, z * 0.0019 + 12.5, 4));
    const temperature = this.norm(this.noise.fbm2D(x * 0.0016 + 29.3, z * 0.0016 - 71.4, 4));
    const erosion = this.norm(this.noise.fbm2D(x * 0.0048 + 90, z * 0.0048 - 120, 4));
    const terrainAge = this.norm(this.noise.fbm2D(x * 0.0008 - 500, z * 0.0008 + 700, 3));
    const hills = this.noise.fbm2D(x * 0.014, z * 0.014, 4);
    const ridgeNoise = this.noise.fbm2D(x * 0.0032 - 100, z * 0.0032 + 120, 5);
    const valley = this.noise.fbm2D(x * 0.0026 + 310, z * 0.0026 - 410, 4);
    const mountainMask = clamp((continentality - 0.28) / 0.62, 0, 1) * clamp((valley + 0.8) / 1.6, 0.25, 1);
    const ridges = Math.pow(Math.max(0, 1 - Math.abs(ridgeNoise)), 3);
    const roughHeight = SEA_LEVEL + 4
      + (continentality - 0.5) * 42
      + hills * (5.5 + mountainMask * 4)
      + ridges * ridges * 54 * mountainMask
      - Math.max(0, erosion - 0.5) * 18;
    const preliminary = Math.floor(clamp(roughHeight, 18, WORLD_HEIGHT - 14));
    const hydrology = this.hydrology.sample(x, z, preliminary);
    const channelWidth = Math.max(1, hydrology.width);
    const riverCut = hydrology.river * (8 + channelWidth * 1.15 + Math.max(0, continentality - 0.45) * 16) + hydrology.stream * (2.5 + channelWidth * 0.18);
    const floodLift = hydrology.floodplain * hydrology.floodplain * (1.5 + hydrology.width * 0.18);
    const lakeCut = hydrology.lake * clamp(preliminary - SEA_LEVEL + 5, 0, 12) * 0.62;
    const bankTerrace = hydrology.bank * (1 - Math.max(hydrology.river, hydrology.lake)) * 1.8;
    const altitude = Math.floor(clamp(roughHeight - riverCut - lakeCut + floodLift - bankTerrace, 18, WORLD_HEIGHT - 14));
    const sample = { altitude, continentality, humidity, temperature, erosion, terrainAge, mountainMask, hydrology: this.hydrology.sample(x, z, altitude) };
    this.sampleCache.set(key, sample);
    return sample;
  }

  private norm(value: number): number {
    return clamp((value + 1) * 0.5, 0, 1);
  }
}
