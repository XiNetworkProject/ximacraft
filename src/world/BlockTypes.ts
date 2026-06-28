export enum BlockId {
  AIR = 0,
  STONE = 1,
  GRASS = 2,
  DIRT = 3,
  SAND = 4,
  RED_SAND = 5,
  BEDROCK = 6,
  COBBLESTONE = 7,
  OAK_LOG = 8,
  OAK_LEAVES = 9,
  OAK_PLANKS = 10,
  COAL_ORE = 11,
  IRON_ORE = 12,
  GOLD_ORE = 13,
  DIAMOND_ORE = 14,
  COPPER_ORE = 15,
  EMERALD_ORE = 16,
  REDSTONE_ORE = 17,
  LAPIS_ORE = 18,
  CRAFTING_TABLE = 19,
  FURNACE = 20,
  FURNACE_ON = 21,
  GLOWSTONE = 22,
  WATER = 23,
  GLASS = 24,
  WHITE_WOOL = 25,
  BLACK_WOOL = 26,
  RED_WOOL = 27,
  BLUE_WOOL = 28,
  GREEN_WOOL = 29,
  YELLOW_WOOL = 30,
  BRICKS = 31,
  OBSIDIAN = 32,
  ANDESITE = 33,
  DIORITE = 34,
  GRANITE = 35,
  GRAVEL = 36,
  SMOOTH_STONE = 37,
  CHISELED_STONE_BRICKS = 38,
  CRACKED_STONE_BRICKS = 39,
  MOSSY_COBBLESTONE = 40,
  MOSSY_STONE_BRICKS = 41,
  END_STONE = 42,
  END_STONE_BRICKS = 43,
  NETHER_BRICKS = 44,
  CRACKED_NETHER_BRICKS = 45,
  CHISELED_NETHER_BRICKS = 46,
  PRISMARINE_BRICKS = 47,
  QUARTZ_BRICKS = 48,
  QUARTZ_PILLAR = 49,
  BLUE_ICE = 50,
  PACKED_ICE = 51,
  ICE = 52,
  SEA_LANTERN = 53,
  COPPER_BLOCK = 54,
  EXPOSED_COPPER = 55,
  WEATHERED_COPPER = 56,
  OXIDIZED_COPPER = 57,
  GOLD_BLOCK = 58,
  IRON_BLOCK = 59,
  RAW_COPPER_BLOCK = 60,
  RAW_GOLD_BLOCK = 61,
  RAW_IRON_BLOCK = 62,
  NETHERITE_BLOCK = 63,
  CRYING_OBSIDIAN = 64,
  SPONGE = 65,
  WET_SPONGE = 66,
  TUFF_BRICKS = 67,
  BIRCH_LOG = 68,
  BIRCH_LEAVES = 69,
  BIRCH_PLANKS = 70,
  ACACIA_PLANKS = 71,
  SPRUCE_PLANKS = 72,
  DARK_OAK_PLANKS = 73,
  JUNGLE_PLANKS = 74,
  CYAN_WOOL = 75,
  GRAY_WOOL = 76,
  LIGHT_BLUE_WOOL = 77,
  LIGHT_GRAY_WOOL = 78,
  LIME_WOOL = 79,
  MAGENTA_WOOL = 80,
  ORANGE_WOOL = 81,
  PINK_WOOL = 82,
  PURPLE_WOOL = 83,
  BROWN_WOOL = 84,
  OAK_LOG_X = 85,
  OAK_LOG_Z = 86,
  BIRCH_LOG_X = 87,
  BIRCH_LOG_Z = 88,
  SNOW_BLOCK = 89,
  SNOW_LAYER_1 = 90,
  SNOW_LAYER_2 = 91,
  SNOW_LAYER_3 = 92,
  SNOW_LAYER_4 = 93,
  SNOW_LAYER_5 = 94,
  SNOW_LAYER_6 = 95,
  SNOW_LAYER_7 = 96,
  SNOW_LAYER_8 = 97,
  SHORT_GRASS = 98,
  TALL_GRASS = 99,
  FERN = 100,
  DANDELION = 101,
  POPPY = 102,
  BLUE_FLOWER = 103,
  WHITE_FLOWER = 104,
  WILD_BUSH = 105,
  SPRUCE_LOG = 106,
  SPRUCE_LOG_X = 107,
  SPRUCE_LOG_Z = 108,
  SPRUCE_LEAVES = 109,
  DARK_OAK_LOG = 110,
  DARK_OAK_LOG_X = 111,
  DARK_OAK_LOG_Z = 112,
  DARK_OAK_LEAVES = 113,
  REEDS = 114,
  LILY_PAD = 115,
  MOSS_CARPET = 116,
  MUD = 117,
  ANIMAL_TRACKS = 118,
  CAMPFIRE = 119,
  WEATHERED_PLANKS = 120,
  WEATHERED_BEAM = 121,
  WEATHERED_BEAM_X = 122,
  WEATHERED_BEAM_Z = 123,
}

export function isSnowLayer(id: BlockId | number): boolean {
  return id >= BlockId.SNOW_LAYER_1 && id <= BlockId.SNOW_LAYER_8;
}

export function isLeaves(id: BlockId | number): boolean {
  return id === BlockId.OAK_LEAVES || id === BlockId.BIRCH_LEAVES || id === BlockId.SPRUCE_LEAVES || id === BlockId.DARK_OAK_LEAVES;
}

export function isPlant(id: BlockId | number): boolean {
  return (
    id === BlockId.SHORT_GRASS ||
    id === BlockId.TALL_GRASS ||
    id === BlockId.FERN ||
    id === BlockId.DANDELION ||
    id === BlockId.POPPY ||
    id === BlockId.BLUE_FLOWER ||
    id === BlockId.WHITE_FLOWER ||
    id === BlockId.WILD_BUSH ||
    id === BlockId.REEDS ||
    id === BlockId.LILY_PAD ||
    id === BlockId.MOSS_CARPET ||
    id === BlockId.ANIMAL_TRACKS
  );
}

export function snowLayerLevel(id: BlockId | number): number {
  return isSnowLayer(id) ? id - BlockId.SNOW_LAYER_1 + 1 : 0;
}

export function snowLayerId(level: number): BlockId {
  const clamped = Math.max(1, Math.min(8, Math.round(level)));
  return (BlockId.SNOW_LAYER_1 + clamped - 1) as BlockId;
}

export type BlockFace = "top" | "bottom" | "north" | "south" | "east" | "west";

export type TextureFaces = {
  top?: string;
  bottom?: string;
  side?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
  front?: string;
};

export type BlockDefinition = {
  id: BlockId;
  key: string;
  displayName: string;
  texture?: string;
  textures?: TextureFaces;
  solid: boolean;
  transparent?: boolean;
  liquid?: boolean;
  unbreakable?: boolean;
  hardness: number;
  emitsLight?: boolean;
  lightLevel?: number;
  color: number;
  creativeHidden?: boolean;
  collisionHeight?: number;
  renderHeight?: number;
  renderStyle?: "cube" | "cross";
};
