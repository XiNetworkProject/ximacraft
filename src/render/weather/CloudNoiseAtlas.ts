import * as THREE from "three";

const SIZE = 32;
const TILES_X = 8;
const TILES_Y = SIZE / TILES_X;

function hash(x: number, y: number, z: number, salt: number): number {
  let value = Math.imul(x + salt * 17, 374761393);
  value = (value + Math.imul(y + salt * 31, 668265263)) | 0;
  value = (value + Math.imul(z + salt * 47, 2147483647)) | 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function fade(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, y: number, z: number, frequency: number, salt: number): number {
  const px = (x / SIZE) * frequency;
  const py = (y / SIZE) * frequency;
  const pz = (z / SIZE) * frequency;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const z0 = Math.floor(pz);
  const x1 = (x0 + 1) % frequency;
  const y1 = (y0 + 1) % frequency;
  const z1 = (z0 + 1) % frequency;
  const fx = fade(px - x0);
  const fy = fade(py - y0);
  const fz = fade(pz - z0);

  const xa = x0 % frequency;
  const ya = y0 % frequency;
  const za = z0 % frequency;
  const c000 = hash(xa, ya, za, salt);
  const c100 = hash(x1, ya, za, salt);
  const c010 = hash(xa, y1, za, salt);
  const c110 = hash(x1, y1, za, salt);
  const c001 = hash(xa, ya, z1, salt);
  const c101 = hash(x1, ya, z1, salt);
  const c011 = hash(xa, y1, z1, salt);
  const c111 = hash(x1, y1, z1, salt);
  const x00 = THREE.MathUtils.lerp(c000, c100, fx);
  const x10 = THREE.MathUtils.lerp(c010, c110, fx);
  const x01 = THREE.MathUtils.lerp(c001, c101, fx);
  const x11 = THREE.MathUtils.lerp(c011, c111, fx);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(x00, x10, fy),
    THREE.MathUtils.lerp(x01, x11, fy),
    fz,
  );
}

function fbm(x: number, y: number, z: number, baseFrequency: number, salt: number): number {
  const low = valueNoise(x, y, z, baseFrequency, salt) * 0.58;
  const medium = valueNoise(x, y, z, baseFrequency * 2, salt + 1) * 0.29;
  const high = valueNoise(x, y, z, baseFrequency * 4, salt + 2) * 0.13;
  return low + medium + high;
}

/** Packs a tileable 32^3 RGBA cloud volume into a WebGL1-compatible 2D atlas. */
export function createCloudNoiseAtlas(): THREE.DataTexture {
  const width = SIZE * TILES_X;
  const height = SIZE * TILES_Y;
  const data = new Uint8Array(width * height * 4);

  for (let z = 0; z < SIZE; z += 1) {
    const tileX = z % TILES_X;
    const tileY = Math.floor(z / TILES_X);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const low = fbm(x, y, z, 2, 3);
        const detail = fbm(x, y, z, 4, 17);
        const billow = 1 - Math.abs(low * 2 - 1);
        const wispy = THREE.MathUtils.clamp(detail * 0.72 + Math.abs(low - detail) * 0.55, 0, 1);
        const px = tileX * SIZE + x;
        const py = tileY * SIZE + y;
        const index = (py * width + px) * 4;
        data[index] = Math.round(low * 255);
        data[index + 1] = Math.round(detail * 255);
        data[index + 2] = Math.round(billow * 255);
        data[index + 3] = Math.round(wispy * 255);
      }
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "CloudNoiseAtlas32";
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
