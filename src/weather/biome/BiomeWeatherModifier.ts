import { World } from "../../world/World";
import { CellBaseline, CELL_SIZE, DEFAULT_BASELINE } from "../WeatherTypes";
import { BIOME_WEATHER_PROFILES } from "./BiomeWeatherProfile";
import { AltitudeWeatherModifier } from "./AltitudeWeatherModifier";
import { TerrainWeatherInfluence } from "./TerrainWeatherInfluence";

export class BiomeWeatherModifier {
  private readonly altitude = new AltitudeWeatherModifier();
  private readonly terrain = new TerrainWeatherInfluence();

  baselineForCell(cellX: number, cellZ: number, world: World | null): CellBaseline {
    if (!world) return { ...DEFAULT_BASELINE };
    const x = cellX * CELL_SIZE + CELL_SIZE / 2;
    const z = cellZ * CELL_SIZE + CELL_SIZE / 2;
    const height = world.getSurfaceHeight(x, z);
    const biome = world.getBiomeAt(x, z);
    const profile = BIOME_WEATHER_PROFILES[biome.id];
    const windX = DEFAULT_BASELINE.windX + profile.windInfluence * 2;
    const windZ = DEFAULT_BASELINE.windZ + (biome.humidity - 0.5) * 2;
    const terrain = this.terrain.sample(x, z, windX, windZ, (hx, hz) => world.getSurfaceHeight(hx, hz));
    const temperature = this.altitude.temperatureAtAltitude(profile.temperatureC + (biome.temperature - 0.5) * 10, height);
    const humidity = Math.max(0.04, Math.min(0.98, profile.humidity + terrain.orographicLift * 0.18 - terrain.rainShadow * 0.22));
    return {
      temperature,
      humidity,
      pressure: DEFAULT_BASELINE.pressure - terrain.orographicLift * 5 + terrain.rainShadow * 3,
      instability: Math.max(0.03, Math.min(0.9, profile.thunderFrequency + profile.stormRisk * 0.25 + Math.max(0, temperature - 18) * 0.012)),
      cloudCover: Math.max(0.04, Math.min(0.96, DEFAULT_BASELINE.cloudCover + profile.rainFrequency * 0.28 + terrain.orographicLift * 0.28 + terrain.valleyFogBias * 0.2)),
      windX: windX * this.altitude.windMultiplierAtAltitude(height) * (1 + terrain.ridgeWindBoost),
      windZ: windZ * this.altitude.windMultiplierAtAltitude(height) * (1 + terrain.ridgeWindBoost),
    };
  }
}
