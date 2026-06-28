import * as THREE from "three";
import { LoadedTexture } from "./ResourcePackLoader";

export type AtlasUv = {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
};

export class TextureAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly tileSize: number;
  readonly size: number;
  private readonly uvs = new Map<string, AtlasUv>();
  private readonly tileUrls = new Map<string, string>();

  private constructor(texture: THREE.CanvasTexture, tileSize: number, size: number) {
    this.texture = texture;
    this.tileSize = tileSize;
    this.size = size;
  }

  static create(textures: Map<string, LoadedTexture>): TextureAtlas {
    const entries = [...textures.values()];
    const maxSourceSize = entries.reduce((max, entry) => {
      const image = entry.image as { width?: number; height?: number };
      return Math.max(max, image.width ?? 64, image.height ?? 64);
    }, 64);
    const tileSize = Math.min(256, Math.max(64, maxSourceSize));
    const columns = Math.ceil(Math.sqrt(entries.length));
    const rows = Math.ceil(entries.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = columns * tileSize;
    canvas.height = rows * tileSize;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const atlasTexture = new THREE.CanvasTexture(canvas);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.generateMipmaps = false;
    atlasTexture.colorSpace = THREE.SRGBColorSpace;

    const atlas = new TextureAtlas(atlasTexture, tileSize, canvas.width);

    entries.forEach((entry, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = col * tileSize;
      const y = row * tileSize;
      context.drawImage(entry.image, x, y, tileSize, tileSize);

      const bleed = 0.5;
      atlas.uvs.set(entry.logicalName, {
        u0: (x + bleed) / canvas.width,
        v0: 1 - (y + tileSize - bleed) / canvas.height,
        u1: (x + tileSize - bleed) / canvas.width,
        v1: 1 - (y + bleed) / canvas.height,
      });
    });

    atlasTexture.needsUpdate = true;
    return atlas;
  }

  getUv(name: string): AtlasUv {
    return this.uvs.get(name) ?? this.uvs.get("missing") ?? { u0: 0, v0: 0, u1: 1, v1: 1 };
  }

  getTileDataUrl(name: string): string {
    const cached = this.tileUrls.get(name);
    if (cached) {
      return cached;
    }

    const source = this.texture.image as HTMLCanvasElement;
    const uv = this.getUv(name);
    const bleed = 0.5;
    const sx = Math.max(0, Math.floor(uv.u0 * source.width - bleed));
    const sy = Math.max(0, Math.floor((1 - uv.v1) * source.height - bleed));
    const sw = Math.min(this.tileSize, source.width - sx);
    const sh = Math.min(this.tileSize, source.height - sy);
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/png");
    this.tileUrls.set(name, url);
    return url;
  }
}
