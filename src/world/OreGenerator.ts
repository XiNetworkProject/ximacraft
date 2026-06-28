import { Noise } from "../utils/Noise";
import { BlockId } from "./BlockTypes";

export class OreGenerator {
  constructor(private readonly noise: Noise) {}

  oreForStone(x: number, y: number, z: number, mountainBiome: boolean): BlockId {
    const roll = this.noise.random3D(x * 13, y * 17, z * 19);
    const vein = this.noise.fbm3D(x * 0.13, y * 0.13, z * 0.13, 2);

    if (y < 18 && vein > 0.18 && roll > 0.992) return BlockId.DIAMOND_ORE;
    if (y < 32 && vein > 0.12 && roll > 0.986) return BlockId.GOLD_ORE;
    if (mountainBiome && y > 44 && vein > 0.1 && roll > 0.992) return BlockId.EMERALD_ORE;
    if (y < 52 && vein > 0.04 && roll > 0.976) return BlockId.REDSTONE_ORE;
    if (y < 58 && vein > 0.02 && roll > 0.972) return BlockId.LAPIS_ORE;
    if (y < 68 && vein > -0.02 && roll > 0.955) return BlockId.IRON_ORE;
    if (y < 72 && vein > -0.04 && roll > 0.955) return BlockId.COPPER_ORE;
    if (y < 88 && vein > -0.08 && roll > 0.935) return BlockId.COAL_ORE;

    const rock = this.noise.fbm3D(x * 0.045 + 130, y * 0.045 - 20, z * 0.045 + 80, 3);
    if (y < 82 && rock > 0.44) return BlockId.GRANITE;
    if (y < 82 && rock < -0.44) return BlockId.DIORITE;
    if (y < 76 && Math.abs(rock) < 0.035 && roll > 0.42) return BlockId.ANDESITE;
    if (y > 18 && y < 58 && rock > 0.28 && roll < 0.08) return BlockId.GRAVEL;

    return BlockId.STONE;
  }
}
