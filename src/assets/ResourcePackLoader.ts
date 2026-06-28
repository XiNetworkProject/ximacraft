import { textureAliases } from "./textureAliases";

export type LoadedTexture = {
  logicalName: string;
  resolvedName: string;
  image: CanvasImageSource;
  fallback: boolean;
};

export type ResourcePackStats = {
  basePath: string | null;
  loadedCount: number;
  missing: string[];
  fallbacks: string[];
};

export type ResourcePackResult = {
  textures: Map<string, LoadedTexture>;
  stats: ResourcePackStats;
};

const BASE_PATHS = [
  "/resourcepack/assets/minecraft/textures/block/",
  "/resourcepack/Faithful 64x - March 2025 Release/assets/minecraft/textures/block/",
  "/resourcepack/Faithful 64x/assets/minecraft/textures/block/",
  "/resourcepack/faithful64/assets/minecraft/textures/block/",
  "/resourcepacks/lbpr/assets/minecraft/textures/block/",
  "/resourcepacks/lbpr/LBPR Reload! v.6.5 for mc1.21.5/assets/minecraft/textures/block/",
  "/resourcepack/FaithfulPBR_256_1.1p/assets/minecraft/textures/block/",
  "/resourcepack/FaithfulPBR/assets/minecraft/textures/block/",
];

const fallbackColors: Record<string, [number, number, number, number]> = {
  grass_top: [75, 151, 67, 255],
  grass_side: [70, 130, 62, 255],
  dirt: [121, 82, 50, 255],
  water: [45, 92, 190, 150],
  glass: [220, 246, 255, 95],
  leaves: [56, 130, 60, 210],
  spruce_leaves: [48, 96, 72, 220],
  dark_oak_leaves: [44, 94, 46, 220],
  spruce_log: [95, 61, 37, 255],
  spruce_log_top: [86, 62, 42, 255],
  dark_oak_log: [74, 45, 26, 255],
  dark_oak_log_top: [70, 48, 31, 255],
  short_grass: [74, 150, 56, 220],
  tall_grass: [72, 145, 58, 220],
  fern: [62, 128, 62, 220],
  dandelion: [238, 204, 58, 230],
  poppy: [205, 60, 46, 230],
  blue_flower: [96, 136, 220, 230],
  white_flower: [238, 232, 210, 230],
  wild_bush: [64, 118, 52, 220],
  reeds: [110, 143, 62, 220],
  lily_pad: [54, 118, 60, 210],
  moss_carpet: [76, 124, 65, 220],
  mud: [74, 51, 40, 255],
  animal_tracks: [94, 81, 68, 190],
  campfire: [62, 42, 29, 255],
  weathered_planks: [111, 96, 77, 255],
  weathered_beam: [76, 59, 44, 255],
  weathered_beam_top: [70, 55, 42, 255],
  stone: [132, 136, 140, 255],
  sand: [215, 202, 140, 255],
  red_sand: [181, 92, 50, 255],
  bedrock: [34, 34, 34, 255],
  glowstone: [248, 206, 95, 255],
  missing: [220, 32, 180, 255],
};

export class ResourcePackLoader {
  private basePath: string | null = null;

  async load(logicalTextureNames: string[]): Promise<ResourcePackResult> {
    this.basePath = await this.detectBasePath();
    const textures = new Map<string, LoadedTexture>();
    const missing: string[] = [];
    const fallbacks: string[] = [];

    for (const logicalName of logicalTextureNames) {
      if (logicalName === "missing") {
        textures.set(logicalName, {
          logicalName,
          resolvedName: "generated_fallback",
          image: this.createFallbackTexture(logicalName),
          fallback: true,
        });
        continue;
      }

      const loaded = this.basePath ? await this.loadFirstAvailable(logicalName, this.basePath) : null;
      if (loaded) {
        textures.set(logicalName, loaded);
        continue;
      }

      missing.push(logicalName);
      fallbacks.push(logicalName);
      textures.set(logicalName, {
        logicalName,
        resolvedName: "generated_fallback",
        image: this.createFallbackTexture(logicalName),
        fallback: true,
      });
    }

    const stats: ResourcePackStats = {
      basePath: this.basePath,
      loadedCount: [...textures.values()].filter((texture) => !texture.fallback).length,
      missing,
      fallbacks,
    };

    console.groupCollapsed("[ResourcePackLoader] BlockWorld Local texture report");
    console.info("Path used:", stats.basePath ?? "none - generated fallbacks");
    console.info("Textures loaded:", stats.loadedCount);
    console.info("Textures missing:", stats.missing);
    console.info("Fallback textures:", stats.fallbacks);
    console.groupEnd();

    return { textures, stats };
  }

  private async detectBasePath(): Promise<string | null> {
    for (const basePath of BASE_PATHS) {
      if (await this.exists(`${basePath}stone.png`)) {
        return basePath;
      }
    }
    console.warn(
      "[ResourcePackLoader] Resource pack not found. The game will continue with generated fallback textures.",
    );
    return null;
  }

  private async loadFirstAvailable(logicalName: string, basePath: string): Promise<LoadedTexture | null> {
    const candidates = textureAliases[logicalName] ?? [logicalName];
    for (const candidate of candidates) {
      if (candidate.endsWith("_n") || candidate.endsWith("_s")) {
        continue;
      }

      const url = `${basePath}${candidate}.png`;
      if (!(await this.exists(url))) {
        continue;
      }

      const image = await this.loadImage(url);
      if (!image) {
        continue;
      }

      return {
        logicalName,
        resolvedName: candidate,
        image,
        fallback: false,
      };
    }

    console.warn(`[ResourcePackLoader] Missing texture "${logicalName}". Tried: ${candidates.join(", ")}`);
    return null;
  }

  private async exists(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      return response.ok;
    } catch {
      try {
        const response = await fetch(url, { method: "GET", cache: "no-store" });
        return response.ok;
      } catch {
        return false;
      }
    }
  }

  private loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  private createFallbackTexture(logicalName: string): HTMLCanvasElement {
    if (logicalName === "grass_top") return this.createGrassTopTexture();
    if (logicalName === "grass_side") return this.createGrassSideTexture();
    if (logicalName === "dirt") return this.createDirtTexture();
    if (logicalName === "water") return this.createWaterTexture();
    if (logicalName === "glass") return this.createGlassTexture();
    if (logicalName === "leaves") return this.createLeavesTexture();
    if (logicalName === "spruce_leaves") return this.createLeavesTexture();
    if (logicalName === "dark_oak_leaves") return this.createLeavesTexture();
    if (logicalName === "short_grass") return this.createPlantTexture(logicalName, "grass");
    if (logicalName === "tall_grass") return this.createPlantTexture(logicalName, "tall_grass");
    if (logicalName === "fern") return this.createPlantTexture(logicalName, "fern");
    if (logicalName === "dandelion") return this.createPlantTexture(logicalName, "flower_yellow");
    if (logicalName === "poppy") return this.createPlantTexture(logicalName, "flower_red");
    if (logicalName === "blue_flower") return this.createPlantTexture(logicalName, "flower_blue");
    if (logicalName === "white_flower") return this.createPlantTexture(logicalName, "flower_white");
    if (logicalName === "wild_bush") return this.createPlantTexture(logicalName, "bush");
    if (logicalName === "reeds") return this.createPlantTexture(logicalName, "reeds");
    if (logicalName === "lily_pad") return this.createFlatNatureTexture("lily");
    if (logicalName === "moss_carpet") return this.createFlatNatureTexture("moss");
    if (logicalName === "animal_tracks") return this.createFlatNatureTexture("tracks");
    if (logicalName === "campfire") return this.createFlatNatureTexture("campfire");

    const [r, g, b, a] = fallbackColors[logicalName] ?? fallbackColors.missing;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = `rgba(${Math.max(r - 32, 0)}, ${Math.max(g - 32, 0)}, ${Math.max(b - 32, 0)}, ${a / 255})`;
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        if ((x + y) % 2 === 0) {
          context.fillRect(x * 16, y * 16, 16, 16);
        }
      }
    }

    context.strokeStyle = `rgba(${Math.min(r + 40, 255)}, ${Math.min(g + 40, 255)}, ${Math.min(b + 40, 255)}, ${a / 255})`;
    context.lineWidth = 6;
    context.strokeRect(3, 3, 250, 250);
    return canvas;
  }

  private createGrassTopTexture(): HTMLCanvasElement {
    return this.makeTexture((context, rand) => {
      this.noiseFill(context, rand, [62, 130, 48], [114, 178, 70], 255);
      for (let i = 0; i < 900; i += 1) {
        const x = Math.floor(rand() * 256);
        const y = Math.floor(rand() * 256);
        const length = 2 + Math.floor(rand() * 8);
        const green = 105 + Math.floor(rand() * 90);
        context.strokeStyle = `rgba(${42 + rand() * 40}, ${green}, ${32 + rand() * 36}, ${0.35 + rand() * 0.4})`;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + (rand() - 0.5) * 5, y - length);
        context.stroke();
      }
      this.pixelSpeckles(context, rand, 1200, [36, 86, 26], [146, 202, 88], 0.32);
    }, "grass_top");
  }

  private createGrassSideTexture(): HTMLCanvasElement {
    return this.makeTexture((context, rand) => {
      this.drawDirtBase(context, rand);
      const topHeight = 54;
      context.fillStyle = "#4f963f";
      context.fillRect(0, 0, 256, topHeight);
      for (let x = 0; x < 256; x += 4) {
        const blade = 24 + Math.floor(rand() * 42);
        const shade = 75 + Math.floor(rand() * 75);
        context.fillStyle = `rgba(${40 + rand() * 45}, ${shade + 55}, ${35 + rand() * 35}, 0.9)`;
        context.fillRect(x, 0, 4, topHeight + blade);
      }
      for (let i = 0; i < 500; i += 1) {
        const x = Math.floor(rand() * 256);
        const y = Math.floor(rand() * 126);
        context.fillStyle = `rgba(45, ${110 + rand() * 70}, 42, ${0.25 + rand() * 0.35})`;
        context.fillRect(x, y, 2 + Math.floor(rand() * 4), 2 + Math.floor(rand() * 8));
      }
    }, "grass_side");
  }

  private createDirtTexture(): HTMLCanvasElement {
    return this.makeTexture((context, rand) => {
      this.drawDirtBase(context, rand);
      this.pixelSpeckles(context, rand, 1600, [72, 45, 28], [152, 104, 62], 0.42);
    }, "dirt");
  }

  private createWaterTexture(): HTMLCanvasElement {
    return this.makeTexture((context, rand) => {
      const gradient = context.createLinearGradient(0, 0, 256, 256);
      gradient.addColorStop(0, "rgba(40, 96, 190, 0.64)");
      gradient.addColorStop(0.5, "rgba(54, 130, 220, 0.58)");
      gradient.addColorStop(1, "rgba(24, 72, 164, 0.68)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 38; i += 1) {
        const y = rand() * 256;
        context.strokeStyle = `rgba(180, 230, 255, ${0.1 + rand() * 0.18})`;
        context.lineWidth = 1 + rand() * 2;
        context.beginPath();
        for (let x = -20; x < 276; x += 18) {
          const wave = Math.sin(x * 0.04 + i) * (3 + rand() * 2);
          x === -20 ? context.moveTo(x, y + wave) : context.lineTo(x, y + wave);
        }
        context.stroke();
      }
    }, "water");
  }

  private createGlassTexture(): HTMLCanvasElement {
    return this.makeTexture((context) => {
      context.fillStyle = "rgba(218, 246, 255, 0.32)";
      context.fillRect(0, 0, 256, 256);
      context.strokeStyle = "rgba(255,255,255,0.72)";
      context.lineWidth = 8;
      context.strokeRect(4, 4, 248, 248);
      context.strokeStyle = "rgba(156,214,235,0.45)";
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(36, 220);
      context.lineTo(220, 36);
      context.moveTo(28, 122);
      context.lineTo(122, 28);
      context.stroke();
    }, "glass");
  }

  private createLeavesTexture(): HTMLCanvasElement {
    return this.makeTexture((context, rand) => {
      context.clearRect(0, 0, 256, 256);
      for (let i = 0; i < 2800; i += 1) {
        const x = Math.floor(rand() * 256);
        const y = Math.floor(rand() * 256);
        const size = 2 + Math.floor(rand() * 8);
        const alpha = rand() < 0.12 ? 0 : 0.55 + rand() * 0.4;
        context.fillStyle = `rgba(${35 + rand() * 50}, ${95 + rand() * 95}, ${32 + rand() * 42}, ${alpha})`;
        context.fillRect(x, y, size, size);
      }
      context.fillStyle = "rgba(20, 70, 20, 0.35)";
      for (let i = 0; i < 120; i += 1) {
        context.fillRect(rand() * 256, rand() * 256, 3 + rand() * 12, 1 + rand() * 4);
      }
    }, "leaves");
  }

  private createPlantTexture(
    logicalName: string,
    kind: "grass" | "tall_grass" | "fern" | "flower_yellow" | "flower_red" | "flower_blue" | "flower_white" | "bush" | "reeds",
  ): HTMLCanvasElement {
    return this.makeTexture((context, rand) => {
      context.clearRect(0, 0, 256, 256);
      const groundY = 232;
      const stems = kind === "reeds" ? 16 : kind === "bush" ? 34 : kind === "fern" ? 22 : kind === "tall_grass" ? 26 : 18;
      for (let i = 0; i < stems; i += 1) {
        const x = 42 + rand() * 172;
        const height =
          kind === "reeds" ? 122 + rand() * 98
            : kind === "grass" ? 48 + rand() * 72
            : kind === "tall_grass" ? 96 + rand() * 102
              : kind === "bush" ? 48 + rand() * 82
                : 70 + rand() * 92;
        const lean = (rand() - 0.5) * (kind === "reeds" ? 12 : kind === "tall_grass" ? 32 : 20);
        const green = kind === "fern" ? 118 + rand() * 58 : kind === "reeds" ? 118 + rand() * 42 : 104 + rand() * 76;
        context.strokeStyle = `rgba(${kind === "reeds" ? 84 + rand() * 28 : 32 + rand() * 34}, ${green}, ${kind === "reeds" ? 48 + rand() * 22 : 34 + rand() * 34}, ${0.62 + rand() * 0.28})`;
        context.lineWidth = kind === "reeds" ? 7 + rand() * 3 : kind === "bush" ? 5 + rand() * 5 : 3 + rand() * 3;
        context.beginPath();
        context.moveTo(x, groundY);
        context.quadraticCurveTo(x + lean * 0.35, groundY - height * 0.5, x + lean, groundY - height);
        context.stroke();
        if (kind === "reeds" && rand() > 0.45) {
          context.strokeStyle = `rgba(92, 72, 38, ${0.52 + rand() * 0.24})`;
          context.lineWidth = 9 + rand() * 4;
          context.beginPath();
          context.moveTo(x + lean, groundY - height + 6);
          context.lineTo(x + lean + (rand() - 0.5) * 8, groundY - height - 18 - rand() * 28);
          context.stroke();
        }
        if (kind === "fern") {
          for (let leaf = 0; leaf < 5; leaf += 1) {
            const ty = groundY - height * (0.28 + leaf * 0.12);
            const side = leaf % 2 === 0 ? 1 : -1;
            context.beginPath();
            context.moveTo(x + lean * 0.35, ty);
            context.lineTo(x + lean * 0.35 + side * (18 + rand() * 18), ty - 7 - rand() * 10);
            context.stroke();
          }
        }
        if (kind === "bush" && rand() > 0.28) {
          context.fillStyle = `rgba(${44 + rand() * 28}, ${114 + rand() * 72}, ${42 + rand() * 34}, ${0.45 + rand() * 0.35})`;
          context.beginPath();
          context.ellipse(x + lean * 0.55, groundY - height * 0.62, 18 + rand() * 18, 12 + rand() * 14, rand() * Math.PI, 0, Math.PI * 2);
          context.fill();
        }
      }

      const flowerColor = kind === "flower_yellow" ? [238, 205, 45]
        : kind === "flower_red" ? [206, 54, 44]
          : kind === "flower_blue" ? [91, 132, 216]
            : kind === "flower_white" ? [236, 232, 211]
              : null;
      if (flowerColor) {
        const count = 5 + Math.floor(rand() * 5);
        for (let i = 0; i < count; i += 1) {
          const x = 72 + rand() * 112;
          const y = 72 + rand() * 72;
          context.fillStyle = `rgba(${flowerColor[0]}, ${flowerColor[1]}, ${flowerColor[2]}, ${0.78 + rand() * 0.18})`;
          for (let petal = 0; petal < 6; petal += 1) {
            const a = (petal / 6) * Math.PI * 2;
            context.beginPath();
            context.ellipse(x + Math.cos(a) * 7, y + Math.sin(a) * 5, 7, 4, a, 0, Math.PI * 2);
            context.fill();
          }
          context.fillStyle = "rgba(245, 211, 72, 0.88)";
          context.fillRect(x - 3, y - 3, 6, 6);
        }
      }

      context.fillStyle = "rgba(42, 92, 36, 0.34)";
      for (let i = 0; i < 120; i += 1) {
        context.fillRect(36 + rand() * 184, 210 + rand() * 28, 1 + rand() * 4, 1 + rand() * 10);
      }
    }, logicalName);
  }

  private createFlatNatureTexture(kind: "lily" | "moss" | "tracks" | "campfire"): HTMLCanvasElement {
    return this.makeTexture((context, rand) => {
      context.clearRect(0, 0, 256, 256);
      if (kind === "lily") {
        for (let i = 0; i < 5; i += 1) {
          context.fillStyle = `rgba(${40 + rand() * 28}, ${104 + rand() * 64}, ${48 + rand() * 30}, ${0.72 + rand() * 0.18})`;
          context.beginPath();
          context.ellipse(128 + (rand() - 0.5) * 34, 128 + (rand() - 0.5) * 28, 62 + rand() * 18, 38 + rand() * 14, rand() * Math.PI, 0.2, Math.PI * 1.92);
          context.fill();
        }
        context.strokeStyle = "rgba(20, 80, 30, 0.38)";
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(128, 128);
        context.lineTo(190, 96);
        context.stroke();
        return;
      }
      if (kind === "moss") {
        this.noiseFill(context, rand, [42, 88, 38], [96, 142, 72], 210);
        context.fillStyle = "rgba(30, 70, 30, 0.26)";
        for (let i = 0; i < 180; i += 1) context.fillRect(rand() * 256, rand() * 256, 2 + rand() * 12, 1 + rand() * 5);
        return;
      }
      if (kind === "tracks") {
        context.fillStyle = "rgba(90, 76, 62, 0.18)";
        context.fillRect(0, 0, 256, 256);
        context.fillStyle = "rgba(46, 34, 28, 0.45)";
        for (let i = 0; i < 5; i += 1) {
          const x = 74 + i * 26 + (rand() - 0.5) * 10;
          const y = 72 + i * 24 + (rand() - 0.5) * 20;
          context.beginPath();
          context.ellipse(x, y, 15, 9, -0.75, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.ellipse(x + 48, y + 18, 15, 9, 0.75, 0, Math.PI * 2);
          context.fill();
        }
        return;
      }
      context.fillStyle = "rgba(44, 30, 22, 0.94)";
      context.fillRect(54, 106, 148, 36);
      context.fillRect(90, 70, 34, 118);
      context.fillStyle = "rgba(210, 88, 28, 0.38)";
      context.beginPath();
      context.ellipse(128, 126, 26, 16, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(24, 18, 14, 0.45)";
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(60, 116);
      context.lineTo(198, 144);
      context.moveTo(96, 70);
      context.lineTo(124, 188);
      context.stroke();
    }, kind);
  }

  private makeTexture(draw: (context: CanvasRenderingContext2D, rand: () => number) => void, seedText: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    draw(context, this.makeRandom(seedText));
    return canvas;
  }

  private drawDirtBase(context: CanvasRenderingContext2D, rand: () => number): void {
    this.noiseFill(context, rand, [84, 55, 34], [142, 91, 52], 255);
    for (let i = 0; i < 120; i += 1) {
      context.fillStyle = `rgba(${60 + rand() * 44}, ${38 + rand() * 34}, ${24 + rand() * 20}, ${0.22 + rand() * 0.22})`;
      context.fillRect(rand() * 256, rand() * 256, 8 + rand() * 28, 3 + rand() * 14);
    }
  }

  private noiseFill(
    context: CanvasRenderingContext2D,
    rand: () => number,
    low: [number, number, number],
    high: [number, number, number],
    alpha: number,
  ): void {
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        const t = rand();
        const r = Math.floor(low[0] + (high[0] - low[0]) * t);
        const g = Math.floor(low[1] + (high[1] - low[1]) * t);
        const b = Math.floor(low[2] + (high[2] - low[2]) * t);
        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha / 255})`;
        context.fillRect(x, y, 4, 4);
      }
    }
  }

  private pixelSpeckles(
    context: CanvasRenderingContext2D,
    rand: () => number,
    count: number,
    low: [number, number, number],
    high: [number, number, number],
    alpha: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const t = rand();
      context.fillStyle = `rgba(${Math.floor(low[0] + (high[0] - low[0]) * t)}, ${Math.floor(
        low[1] + (high[1] - low[1]) * t,
      )}, ${Math.floor(low[2] + (high[2] - low[2]) * t)}, ${alpha})`;
      context.fillRect(rand() * 256, rand() * 256, 1 + rand() * 5, 1 + rand() * 5);
    }
  }

  private makeRandom(seedText: string): () => number {
    let seed = 2166136261;
    for (let i = 0; i < seedText.length; i += 1) {
      seed ^= seedText.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }
    return () => {
      seed += 0x6d2b79f5;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
