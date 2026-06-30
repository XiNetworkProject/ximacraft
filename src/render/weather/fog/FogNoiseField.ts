export class FogNoiseField {
  value3(x: number, y: number, z: number): number {
    return hash3(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  smooth3(x: number, y: number, z: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const fz = fade(z - iz);

    const x00 = lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx);
    const x10 = lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx);
    const x01 = lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx);
    const x11 = lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx);
    const y0 = lerp(x00, x10, fy);
    const y1 = lerp(x01, x11, fy);
    return lerp(y0, y1, fz);
  }

  fbm3(x: number, y: number, z: number, octaves = 4): number {
    let amp = 0.5;
    let freq = 1;
    let value = 0;
    let total = 0;
    for (let i = 0; i < octaves; i += 1) {
      value += this.smooth3(x * freq, y * freq, z * freq) * amp;
      total += amp;
      amp *= 0.52;
      freq *= 2.03;
    }
    return total > 0 ? value / total : 0;
  }
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
