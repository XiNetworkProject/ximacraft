import { BlockDefinition, BlockFace, BlockId } from "./BlockTypes";

const blocks: BlockDefinition[] = [
  { id: BlockId.AIR, key: "air", displayName: "Air", solid: false, transparent: true, hardness: 0, color: 0x000000 },
  { id: BlockId.STONE, key: "stone", displayName: "Stone", texture: "stone", solid: true, hardness: 1.5, color: 0x8b8f93 },
  {
    id: BlockId.GRASS,
    key: "grass",
    displayName: "Grass",
    textures: { top: "grass_top", side: "grass_side", bottom: "dirt" },
    solid: true,
    hardness: 0.6,
    color: 0x4f9b45,
  },
  { id: BlockId.DIRT, key: "dirt", displayName: "Dirt", texture: "dirt", solid: true, hardness: 0.5, color: 0x7b5235 },
  { id: BlockId.SAND, key: "sand", displayName: "Sand", texture: "sand", solid: true, hardness: 0.5, color: 0xd7ca8c },
  { id: BlockId.RED_SAND, key: "red_sand", displayName: "Red Sand", texture: "red_sand", solid: true, hardness: 0.5, color: 0xb55c32 },
  { id: BlockId.BEDROCK, key: "bedrock", displayName: "Bedrock", texture: "bedrock", solid: true, unbreakable: true, hardness: 999, color: 0x222222 },
  { id: BlockId.COBBLESTONE, key: "cobblestone", displayName: "Cobblestone", texture: "cobblestone", solid: true, hardness: 2, color: 0x74777a },
  {
    id: BlockId.OAK_LOG,
    key: "oak_log",
    displayName: "Oak Log",
    textures: { top: "oak_log_top", bottom: "oak_log_top", side: "oak_log" },
    solid: true,
    hardness: 2,
    color: 0x8a5a2b,
  },
  {
    id: BlockId.OAK_LOG_X,
    key: "oak_log_x",
    displayName: "Oak Log",
    textures: { east: "oak_log_top", west: "oak_log_top", side: "oak_log" },
    solid: true,
    hardness: 2,
    color: 0x8a5a2b,
    creativeHidden: true,
  },
  {
    id: BlockId.OAK_LOG_Z,
    key: "oak_log_z",
    displayName: "Oak Log",
    textures: { north: "oak_log_top", south: "oak_log_top", side: "oak_log" },
    solid: true,
    hardness: 2,
    color: 0x8a5a2b,
    creativeHidden: true,
  },
  { id: BlockId.OAK_LEAVES, key: "oak_leaves", displayName: "Oak Leaves", texture: "leaves", solid: false, transparent: true, hardness: 0.2, color: 0x3f8d3a },
  { id: BlockId.OAK_PLANKS, key: "oak_planks", displayName: "Oak Planks", texture: "oak_planks", solid: true, hardness: 2, color: 0xb98245 },
  { id: BlockId.COAL_ORE, key: "coal_ore", displayName: "Coal Ore", texture: "coal_ore", solid: true, hardness: 3, color: 0x303136 },
  { id: BlockId.IRON_ORE, key: "iron_ore", displayName: "Iron Ore", texture: "iron_ore", solid: true, hardness: 3, color: 0xb28f74 },
  { id: BlockId.GOLD_ORE, key: "gold_ore", displayName: "Gold Ore", texture: "gold_ore", solid: true, hardness: 3, color: 0xf3cb45 },
  { id: BlockId.DIAMOND_ORE, key: "diamond_ore", displayName: "Diamond Ore", texture: "diamond_ore", solid: true, hardness: 3, color: 0x52d5e8 },
  { id: BlockId.COPPER_ORE, key: "copper_ore", displayName: "Copper Ore", texture: "copper_ore", solid: true, hardness: 3, color: 0xc87949 },
  { id: BlockId.EMERALD_ORE, key: "emerald_ore", displayName: "Emerald Ore", texture: "emerald_ore", solid: true, hardness: 3, color: 0x32d16d },
  { id: BlockId.REDSTONE_ORE, key: "redstone_ore", displayName: "Redstone Ore", texture: "redstone_ore", solid: true, hardness: 3, color: 0xc4372e },
  { id: BlockId.LAPIS_ORE, key: "lapis_ore", displayName: "Lapis Ore", texture: "lapis_ore", solid: true, hardness: 3, color: 0x254fa9 },
  {
    id: BlockId.CRAFTING_TABLE,
    key: "crafting_table",
    displayName: "Crafting Table",
    textures: { top: "crafting_table_top", side: "crafting_table_side", front: "crafting_table_front" },
    solid: true,
    hardness: 2.5,
    color: 0x8b5a2b,
  },
  {
    id: BlockId.FURNACE,
    key: "furnace",
    displayName: "Furnace",
    textures: { top: "furnace_top", side: "furnace_side", front: "furnace_front" },
    solid: true,
    hardness: 3.5,
    color: 0x60656b,
  },
  {
    id: BlockId.FURNACE_ON,
    key: "furnace_on",
    displayName: "Lit Furnace",
    textures: { top: "furnace_top", side: "furnace_side", front: "furnace_front_on" },
    solid: true,
    hardness: 3.5,
    emitsLight: true,
    lightLevel: 12,
    color: 0xff9f43,
  },
  { id: BlockId.GLOWSTONE, key: "glowstone", displayName: "Glowstone", texture: "glowstone", solid: true, hardness: 0.3, emitsLight: true, lightLevel: 15, color: 0xf9d46a },
  { id: BlockId.WATER, key: "water", displayName: "Water", texture: "water", solid: false, transparent: true, liquid: true, hardness: 100, color: 0x3866c4 },
  { id: BlockId.GLASS, key: "glass", displayName: "Glass", texture: "glass", solid: true, transparent: true, hardness: 0.3, color: 0xd8f3ff },
  { id: BlockId.WHITE_WOOL, key: "white_wool", displayName: "White Wool", texture: "white_wool", solid: true, hardness: 0.8, color: 0xe9eef2 },
  { id: BlockId.BLACK_WOOL, key: "black_wool", displayName: "Black Wool", texture: "black_wool", solid: true, hardness: 0.8, color: 0x202329 },
  { id: BlockId.RED_WOOL, key: "red_wool", displayName: "Red Wool", texture: "red_wool", solid: true, hardness: 0.8, color: 0xb92d2b },
  { id: BlockId.BLUE_WOOL, key: "blue_wool", displayName: "Blue Wool", texture: "blue_wool", solid: true, hardness: 0.8, color: 0x334fb4 },
  { id: BlockId.GREEN_WOOL, key: "green_wool", displayName: "Green Wool", texture: "green_wool", solid: true, hardness: 0.8, color: 0x4b8a32 },
  { id: BlockId.YELLOW_WOOL, key: "yellow_wool", displayName: "Yellow Wool", texture: "yellow_wool", solid: true, hardness: 0.8, color: 0xd9c341 },
  { id: BlockId.BRICKS, key: "bricks", displayName: "Bricks", texture: "bricks", solid: true, hardness: 2, color: 0xa45345 },
  { id: BlockId.OBSIDIAN, key: "obsidian", displayName: "Obsidian", texture: "obsidian", solid: true, hardness: 50, color: 0x1a1426 },
  { id: BlockId.ANDESITE, key: "andesite", displayName: "Andesite", texture: "andesite", solid: true, hardness: 1.5, color: 0x8b8d88 },
  { id: BlockId.DIORITE, key: "diorite", displayName: "Diorite", texture: "diorite", solid: true, hardness: 1.5, color: 0xd7d4cc },
  { id: BlockId.GRANITE, key: "granite", displayName: "Granite", texture: "granite", solid: true, hardness: 1.5, color: 0x9b6a5a },
  { id: BlockId.GRAVEL, key: "gravel", displayName: "Gravel", texture: "gravel", solid: true, hardness: 0.6, color: 0x74716d },
  { id: BlockId.SMOOTH_STONE, key: "smooth_stone", displayName: "Smooth Stone", texture: "smooth_stone", solid: true, hardness: 2, color: 0x9a9c9e },
  { id: BlockId.CHISELED_STONE_BRICKS, key: "chiseled_stone_bricks", displayName: "Chiseled Stone Bricks", texture: "chiseled_stone_bricks", solid: true, hardness: 1.5, color: 0x777a78 },
  { id: BlockId.CRACKED_STONE_BRICKS, key: "cracked_stone_bricks", displayName: "Cracked Stone Bricks", texture: "cracked_stone_bricks", solid: true, hardness: 1.5, color: 0x686b69 },
  { id: BlockId.MOSSY_COBBLESTONE, key: "mossy_cobblestone", displayName: "Mossy Cobblestone", texture: "mossy_cobblestone", solid: true, hardness: 2, color: 0x59674f },
  { id: BlockId.MOSSY_STONE_BRICKS, key: "mossy_stone_bricks", displayName: "Mossy Stone Bricks", texture: "mossy_stone_bricks", solid: true, hardness: 1.5, color: 0x63705b },
  { id: BlockId.END_STONE, key: "end_stone", displayName: "End Stone", texture: "end_stone", solid: true, hardness: 3, color: 0xd8d0a0 },
  { id: BlockId.END_STONE_BRICKS, key: "end_stone_bricks", displayName: "End Stone Bricks", texture: "end_stone_bricks", solid: true, hardness: 3, color: 0xcfc795 },
  { id: BlockId.NETHER_BRICKS, key: "nether_bricks", displayName: "Nether Bricks", texture: "nether_bricks", solid: true, hardness: 2, color: 0x2d1016 },
  { id: BlockId.CRACKED_NETHER_BRICKS, key: "cracked_nether_bricks", displayName: "Cracked Nether Bricks", texture: "cracked_nether_bricks", solid: true, hardness: 2, color: 0x251015 },
  { id: BlockId.CHISELED_NETHER_BRICKS, key: "chiseled_nether_bricks", displayName: "Chiseled Nether Bricks", texture: "chiseled_nether_bricks", solid: true, hardness: 2, color: 0x32141b },
  { id: BlockId.PRISMARINE_BRICKS, key: "prismarine_bricks", displayName: "Prismarine Bricks", texture: "prismarine_bricks", solid: true, hardness: 1.5, color: 0x5aa49c },
  { id: BlockId.QUARTZ_BRICKS, key: "quartz_bricks", displayName: "Quartz Bricks", texture: "quartz_bricks", solid: true, hardness: 0.8, color: 0xe4ded2 },
  { id: BlockId.QUARTZ_PILLAR, key: "quartz_pillar", displayName: "Quartz Pillar", textures: { top: "quartz_pillar_top", bottom: "quartz_pillar_top", side: "quartz_pillar" }, solid: true, hardness: 0.8, color: 0xe3ddcf },
  { id: BlockId.BLUE_ICE, key: "blue_ice", displayName: "Blue Ice", texture: "blue_ice", solid: true, transparent: true, hardness: 2.8, color: 0x74a7ff },
  { id: BlockId.PACKED_ICE, key: "packed_ice", displayName: "Packed Ice", texture: "packed_ice", solid: true, transparent: true, hardness: 0.5, color: 0xa9d4ff },
  { id: BlockId.ICE, key: "ice", displayName: "Ice", texture: "ice", solid: true, transparent: true, hardness: 0.5, color: 0xb7e7ff },
  { id: BlockId.SEA_LANTERN, key: "sea_lantern", displayName: "Sea Lantern", texture: "sea_lantern", solid: true, hardness: 0.3, emitsLight: true, lightLevel: 15, color: 0xbdeee4 },
  { id: BlockId.COPPER_BLOCK, key: "copper_block", displayName: "Copper Block", texture: "copper_block", solid: true, hardness: 3, color: 0xc8754c },
  { id: BlockId.EXPOSED_COPPER, key: "exposed_copper", displayName: "Exposed Copper", texture: "exposed_copper", solid: true, hardness: 3, color: 0xae7f67 },
  { id: BlockId.WEATHERED_COPPER, key: "weathered_copper", displayName: "Weathered Copper", texture: "weathered_copper", solid: true, hardness: 3, color: 0x6d9a8e },
  { id: BlockId.OXIDIZED_COPPER, key: "oxidized_copper", displayName: "Oxidized Copper", texture: "oxidized_copper", solid: true, hardness: 3, color: 0x58a18e },
  { id: BlockId.GOLD_BLOCK, key: "gold_block", displayName: "Gold Block", texture: "gold_block", solid: true, hardness: 3, color: 0xf4c542 },
  { id: BlockId.IRON_BLOCK, key: "iron_block", displayName: "Iron Block", texture: "iron_block", solid: true, hardness: 5, color: 0xd8d8d0 },
  { id: BlockId.RAW_COPPER_BLOCK, key: "raw_copper_block", displayName: "Raw Copper Block", texture: "raw_copper_block", solid: true, hardness: 5, color: 0x9a6a4c },
  { id: BlockId.RAW_GOLD_BLOCK, key: "raw_gold_block", displayName: "Raw Gold Block", texture: "raw_gold_block", solid: true, hardness: 5, color: 0xd2a83a },
  { id: BlockId.RAW_IRON_BLOCK, key: "raw_iron_block", displayName: "Raw Iron Block", texture: "raw_iron_block", solid: true, hardness: 5, color: 0xa48770 },
  { id: BlockId.NETHERITE_BLOCK, key: "netherite_block", displayName: "Netherite Block", texture: "netherite_block", solid: true, hardness: 50, color: 0x3a3338 },
  { id: BlockId.CRYING_OBSIDIAN, key: "crying_obsidian", displayName: "Crying Obsidian", texture: "crying_obsidian", solid: true, hardness: 50, emitsLight: true, lightLevel: 10, color: 0x3c1a76 },
  { id: BlockId.SPONGE, key: "sponge", displayName: "Sponge", texture: "sponge", solid: true, hardness: 0.6, color: 0xc8bb42 },
  { id: BlockId.WET_SPONGE, key: "wet_sponge", displayName: "Wet Sponge", texture: "wet_sponge", solid: true, hardness: 0.6, color: 0x9f9b46 },
  { id: BlockId.TUFF_BRICKS, key: "tuff_bricks", displayName: "Tuff Bricks", texture: "tuff_bricks", solid: true, hardness: 1.5, color: 0x676b66 },
  { id: BlockId.BIRCH_LOG, key: "birch_log", displayName: "Birch Log", textures: { top: "birch_log_top", bottom: "birch_log_top", side: "birch_log" }, solid: true, hardness: 2, color: 0xcabf96 },
  {
    id: BlockId.BIRCH_LOG_X,
    key: "birch_log_x",
    displayName: "Birch Log",
    textures: { east: "birch_log_top", west: "birch_log_top", side: "birch_log" },
    solid: true,
    hardness: 2,
    color: 0xcabf96,
    creativeHidden: true,
  },
  {
    id: BlockId.BIRCH_LOG_Z,
    key: "birch_log_z",
    displayName: "Birch Log",
    textures: { north: "birch_log_top", south: "birch_log_top", side: "birch_log" },
    solid: true,
    hardness: 2,
    color: 0xcabf96,
    creativeHidden: true,
  },
  { id: BlockId.BIRCH_LEAVES, key: "birch_leaves", displayName: "Birch Leaves", texture: "birch_leaves", solid: false, transparent: true, hardness: 0.2, color: 0x6da34d },
  { id: BlockId.BIRCH_PLANKS, key: "birch_planks", displayName: "Birch Planks", texture: "birch_planks", solid: true, hardness: 2, color: 0xcaa567 },
  { id: BlockId.ACACIA_PLANKS, key: "acacia_planks", displayName: "Acacia Planks", texture: "acacia_planks", solid: true, hardness: 2, color: 0xb25f34 },
  { id: BlockId.SPRUCE_PLANKS, key: "spruce_planks", displayName: "Spruce Planks", texture: "spruce_planks", solid: true, hardness: 2, color: 0x6f4b28 },
  { id: BlockId.DARK_OAK_PLANKS, key: "dark_oak_planks", displayName: "Dark Oak Planks", texture: "dark_oak_planks", solid: true, hardness: 2, color: 0x4c2f1b },
  { id: BlockId.JUNGLE_PLANKS, key: "jungle_planks", displayName: "Jungle Planks", texture: "jungle_planks", solid: true, hardness: 2, color: 0xaa7755 },
  { id: BlockId.CYAN_WOOL, key: "cyan_wool", displayName: "Cyan Wool", texture: "cyan_wool", solid: true, hardness: 0.8, color: 0x158991 },
  { id: BlockId.GRAY_WOOL, key: "gray_wool", displayName: "Gray Wool", texture: "gray_wool", solid: true, hardness: 0.8, color: 0x4e5558 },
  { id: BlockId.LIGHT_BLUE_WOOL, key: "light_blue_wool", displayName: "Light Blue Wool", texture: "light_blue_wool", solid: true, hardness: 0.8, color: 0x6aa9d8 },
  { id: BlockId.LIGHT_GRAY_WOOL, key: "light_gray_wool", displayName: "Light Gray Wool", texture: "light_gray_wool", solid: true, hardness: 0.8, color: 0xa7a7a7 },
  { id: BlockId.LIME_WOOL, key: "lime_wool", displayName: "Lime Wool", texture: "lime_wool", solid: true, hardness: 0.8, color: 0x70b93a },
  { id: BlockId.MAGENTA_WOOL, key: "magenta_wool", displayName: "Magenta Wool", texture: "magenta_wool", solid: true, hardness: 0.8, color: 0xbb55b8 },
  { id: BlockId.ORANGE_WOOL, key: "orange_wool", displayName: "Orange Wool", texture: "orange_wool", solid: true, hardness: 0.8, color: 0xd88422 },
  { id: BlockId.PINK_WOOL, key: "pink_wool", displayName: "Pink Wool", texture: "pink_wool", solid: true, hardness: 0.8, color: 0xdb76a8 },
  { id: BlockId.PURPLE_WOOL, key: "purple_wool", displayName: "Purple Wool", texture: "purple_wool", solid: true, hardness: 0.8, color: 0x7b3fad },
  { id: BlockId.BROWN_WOOL, key: "brown_wool", displayName: "Brown Wool", texture: "brown_wool", solid: true, hardness: 0.8, color: 0x744728 },
  { id: BlockId.SNOW_BLOCK, key: "snow_block", displayName: "Snow Block", texture: "snow", solid: true, hardness: 0.2, color: 0xa7b1b7 },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: (BlockId.SNOW_LAYER_1 + index) as BlockId,
    key: `snow_layer_${index + 1}`,
    displayName: "Snow Layer",
    texture: "snow",
    solid: true,
    transparent: true,
    hardness: 0.08,
    color: 0x9da8ae,
    creativeHidden: true,
    collisionHeight: (index + 1) / 8,
    renderHeight: (index + 1) / 8,
  })),
  {
    id: BlockId.SHORT_GRASS,
    key: "short_grass",
    displayName: "Short Grass",
    texture: "short_grass",
    solid: false,
    transparent: true,
    hardness: 0.05,
    color: 0x5cae43,
    renderStyle: "cross",
  },
  {
    id: BlockId.TALL_GRASS,
    key: "tall_grass",
    displayName: "Tall Grass",
    texture: "tall_grass",
    solid: false,
    transparent: true,
    hardness: 0.05,
    color: 0x5ba844,
    renderStyle: "cross",
  },
  {
    id: BlockId.FERN,
    key: "fern",
    displayName: "Fern",
    texture: "fern",
    solid: false,
    transparent: true,
    hardness: 0.05,
    color: 0x4c9a49,
    renderStyle: "cross",
  },
  {
    id: BlockId.DANDELION,
    key: "dandelion",
    displayName: "Dandelion",
    texture: "dandelion",
    solid: false,
    transparent: true,
    hardness: 0.04,
    color: 0xf2d34b,
    renderStyle: "cross",
  },
  {
    id: BlockId.POPPY,
    key: "poppy",
    displayName: "Poppy",
    texture: "poppy",
    solid: false,
    transparent: true,
    hardness: 0.04,
    color: 0xd13d32,
    renderStyle: "cross",
  },
  {
    id: BlockId.BLUE_FLOWER,
    key: "blue_flower",
    displayName: "Blue Flower",
    texture: "blue_flower",
    solid: false,
    transparent: true,
    hardness: 0.04,
    color: 0x5d8ddc,
    renderStyle: "cross",
  },
  {
    id: BlockId.WHITE_FLOWER,
    key: "white_flower",
    displayName: "White Flower",
    texture: "white_flower",
    solid: false,
    transparent: true,
    hardness: 0.04,
    color: 0xf0ead7,
    renderStyle: "cross",
  },
  {
    id: BlockId.WILD_BUSH,
    key: "wild_bush",
    displayName: "Wild Bush",
    texture: "wild_bush",
    solid: false,
    transparent: true,
    hardness: 0.08,
    color: 0x477a36,
    renderStyle: "cross",
  },
  {
    id: BlockId.SPRUCE_LOG,
    key: "spruce_log",
    displayName: "Spruce Log",
    textures: { top: "spruce_log_top", bottom: "spruce_log_top", side: "spruce_log" },
    solid: true,
    hardness: 2,
    color: 0x5f3d25,
  },
  {
    id: BlockId.SPRUCE_LOG_X,
    key: "spruce_log_x",
    displayName: "Spruce Log",
    textures: { east: "spruce_log_top", west: "spruce_log_top", side: "spruce_log" },
    solid: true,
    hardness: 2,
    color: 0x5f3d25,
    creativeHidden: true,
  },
  {
    id: BlockId.SPRUCE_LOG_Z,
    key: "spruce_log_z",
    displayName: "Spruce Log",
    textures: { north: "spruce_log_top", south: "spruce_log_top", side: "spruce_log" },
    solid: true,
    hardness: 2,
    color: 0x5f3d25,
    creativeHidden: true,
  },
  { id: BlockId.SPRUCE_LEAVES, key: "spruce_leaves", displayName: "Spruce Leaves", texture: "spruce_leaves", solid: false, transparent: true, hardness: 0.2, color: 0x315f47 },
  {
    id: BlockId.DARK_OAK_LOG,
    key: "dark_oak_log",
    displayName: "Dark Oak Log",
    textures: { top: "dark_oak_log_top", bottom: "dark_oak_log_top", side: "dark_oak_log" },
    solid: true,
    hardness: 2,
    color: 0x4a2d1a,
  },
  {
    id: BlockId.DARK_OAK_LOG_X,
    key: "dark_oak_log_x",
    displayName: "Dark Oak Log",
    textures: { east: "dark_oak_log_top", west: "dark_oak_log_top", side: "dark_oak_log" },
    solid: true,
    hardness: 2,
    color: 0x4a2d1a,
    creativeHidden: true,
  },
  {
    id: BlockId.DARK_OAK_LOG_Z,
    key: "dark_oak_log_z",
    displayName: "Dark Oak Log",
    textures: { north: "dark_oak_log_top", south: "dark_oak_log_top", side: "dark_oak_log" },
    solid: true,
    hardness: 2,
    color: 0x4a2d1a,
    creativeHidden: true,
  },
  { id: BlockId.DARK_OAK_LEAVES, key: "dark_oak_leaves", displayName: "Dark Oak Leaves", texture: "dark_oak_leaves", solid: false, transparent: true, hardness: 0.2, color: 0x2f6a30 },
];

export class BlockRegistry {
  private readonly byId = new Map<BlockId, BlockDefinition>();
  private readonly byKey = new Map<string, BlockDefinition>();

  constructor() {
    for (const block of blocks) {
      this.byId.set(block.id, block);
      this.byKey.set(block.key, block);
    }
  }

  get(id: BlockId | number): BlockDefinition {
    return this.byId.get(id as BlockId) ?? this.byId.get(BlockId.AIR)!;
  }

  getByKey(key: string): BlockDefinition | undefined {
    return this.byKey.get(key);
  }

  all(): BlockDefinition[] {
    return [...this.byId.values()];
  }

  placeable(): BlockDefinition[] {
    return this.all().filter((block) => block.id !== BlockId.AIR && !block.liquid && !block.creativeHidden);
  }

  getIconTextureForBlock(id: BlockId | number): string {
    const block = this.get(id);
    if (!block.textures) {
      return block.texture ?? "missing";
    }
    return block.textures.front ?? block.textures.top ?? block.textures.side ?? block.texture ?? "missing";
  }

  getTextureForFace(id: BlockId | number, face: BlockFace): string {
    const block = this.get(id);
    if (!block.textures) {
      return block.texture ?? "missing";
    }

    if (face === "top" && block.textures.top) return block.textures.top;
    if (face === "bottom" && block.textures.bottom) return block.textures.bottom;
    if (face === "north" && block.textures.front) return block.textures.front;
    if (face === "north" && block.textures.north) return block.textures.north;
    if (face === "south" && block.textures.south) return block.textures.south;
    if (face === "east" && block.textures.east) return block.textures.east;
    if (face === "west" && block.textures.west) return block.textures.west;
    return block.textures.side ?? block.texture ?? "missing";
  }

  isOpaque(id: BlockId | number): boolean {
    const block = this.get(id);
    return block.id !== BlockId.AIR && block.solid && !block.transparent && !block.liquid;
  }

  isSolid(id: BlockId | number): boolean {
    const block = this.get(id);
    return block.solid && id !== BlockId.AIR;
  }
}
