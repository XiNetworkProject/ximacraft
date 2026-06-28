import { lerp, smoothstep } from "./MathUtils";

export class Noise {
  constructor(private readonly seed: number) {}

  noise2D(x: number, z: number): number {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = smoothstep(x - x0);
    const tz = smoothstep(z - z0);

    const a = this.hash2(x0, z0);
    const b = this.hash2(x0 + 1, z0);
    const c = this.hash2(x0, z0 + 1);
    const d = this.hash2(x0 + 1, z0 + 1);

    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz) * 2 - 1;
  }

  noise3D(x: number, y: number, z: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const tx = smoothstep(x - x0);
    const ty = smoothstep(y - y0);
    const tz = smoothstep(z - z0);

    const c000 = this.hash3(x0, y0, z0);
    const c100 = this.hash3(x0 + 1, y0, z0);
    const c010 = this.hash3(x0, y0 + 1, z0);
    const c110 = this.hash3(x0 + 1, y0 + 1, z0);
    const c001 = this.hash3(x0, y0, z0 + 1);
    const c101 = this.hash3(x0 + 1, y0, z0 + 1);
    const c011 = this.hash3(x0, y0 + 1, z0 + 1);
    const c111 = this.hash3(x0 + 1, y0 + 1, z0 + 1);

    const x00 = lerp(c000, c100, tx);
    const x10 = lerp(c010, c110, tx);
    const x01 = lerp(c001, c101, tx);
    const x11 = lerp(c011, c111, tx);
    const y0v = lerp(x00, x10, ty);
    const y1v = lerp(x01, x11, ty);

    return lerp(y0v, y1v, tz) * 2 - 1;
  }

  fbm2D(x: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amplitude = 0.5;
    let frequency = 1;
    let value = 0;
    let normalizer = 0;

    for (let i = 0; i < octaves; i += 1) {
      value += this.noise2D(x * frequency, z * frequency) * amplitude;
      normalizer += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / normalizer;
  }

  fbm3D(x: number, y: number, z: number, octaves = 3): number {
    let amplitude = 0.5;
    let frequency = 1;
    let value = 0;
    let normalizer = 0;

    for (let i = 0; i < octaves; i += 1) {
      value += this.noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
      normalizer += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }

    return value / normalizer;
  }

  random2D(x: number, z: number): number {
    return this.hash2(Math.floor(x), Math.floor(z));
  }

  random3D(x: number, y: number, z: number): number {
    return this.hash3(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  private hash2(x: number, z: number): number {
    let h = this.seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  private hash3(x: number, y: number, z: number): number {
    let h = this.seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 1442695041) ^ Math.imul(z, 668265263);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
}
