import { WeatherSample, WeatherType } from "../weather/WeatherTypes";
import { SurfaceWeatherState } from "../weather/ground/SurfaceWeatherState";
import { World } from "../world/World";
import { BlockId, isPlant, isSnowLayer } from "../world/BlockTypes";

export class WorldMemorySystem {
  private timer = 0;
  private cursor = 0;

  update(delta: number, world: World, surface: SurfaceWeatherState, player: { x: number; z: number }, sample: WeatherSample): void {
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = sample.windSpeed > 16 || sample.precipitation > 0.1 ? 1.2 : 2.8;

    for (let i = 0; i < 8; i += 1) {
      this.cursor += 1;
      const angle = this.cursor * 2.399963229728653;
      const radius = 8 + ((this.cursor * 37) % 28);
      const x = Math.floor(player.x + Math.cos(angle) * radius);
      const z = Math.floor(player.z + Math.sin(angle) * radius);
      const y = world.getSurfaceHeight(x, z);
      const base = world.getBlock(x, y, z);
      const above = world.getBlock(x, y + 1, z);
      if (above !== BlockId.AIR && !isPlant(above) && !isSnowLayer(above)) continue;
      const col = surface.get(x, z);
      const wet = col?.wetness ?? 0;
      if (this.shouldLeaveTracks(base, above, wet, sample)) {
        world.setBlock(x, y + 1, z, BlockId.ANIMAL_TRACKS);
        continue;
      }
      if (this.shouldDropBranch(base, above, sample)) {
        world.setBlock(x, y + 1, z, (this.cursor & 1) === 0 ? BlockId.SPRUCE_LOG_X : BlockId.OAK_LOG_Z);
      }
    }
  }

  debug(sample: WeatherSample): string {
    return `WorldMemory wind=${sample.windSpeed.toFixed(1)} precip=${sample.precipitation.toFixed(2)}`;
  }

  private shouldLeaveTracks(base: BlockId, above: BlockId, wetness: number, sample: WeatherSample): boolean {
    if (above !== BlockId.AIR && !isSnowLayer(above)) return false;
    const hash = (this.cursor * 1103515245 + 12345) >>> 0;
    const roll = (hash % 1000) / 1000;
    if (isSnowLayer(above) || base === BlockId.SNOW_BLOCK) return roll < 0.18;
    if (base === BlockId.SAND || base === BlockId.RED_SAND) return roll < 0.07;
    if (base === BlockId.MUD || wetness > 0.42) return roll < 0.12;
    return false;
  }

  private shouldDropBranch(base: BlockId, above: BlockId, sample: WeatherSample): boolean {
    if (above !== BlockId.AIR || (base !== BlockId.GRASS && base !== BlockId.DIRT && base !== BlockId.MUD)) return false;
    if (sample.windSpeed < 17 && sample.weatherType !== WeatherType.THUNDERSTORM) return false;
    const hash = (this.cursor * 1664525 + 1013904223) >>> 0;
    return (hash % 1000) / 1000 < 0.018;
  }
}
