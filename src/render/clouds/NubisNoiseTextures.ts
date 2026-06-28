import * as THREE from "three";

export interface NubisNoiseTextures {
  base: THREE.Data3DTexture;
  detail: THREE.Data3DTexture;
  dispose(): void;
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function hash3(x: number, y: number, z: number, salt: number): number {
  let value = Math.imul(x + salt * 17, 374761393);
  value = (value + Math.imul(y + salt * 29, 668265263)) | 0;
  value = (value + Math.imul(z + salt * 43, 1442695041)) | 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function gradientDot(hash: number, x: number, y: number, z: number): number {
  switch (Math.floor(hash * 12) % 12) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x + z;
    case 5: return -x + z;
    case 6: return x - z;
    case 7: return -x - z;
    case 8: return y + z;
    case 9: return -y + z;
    case 10: return y - z;
    default: return -y - z;
  }
}

function perlinNoise(x: number, y: number, z: number, size: number, frequency: number, salt: number): number {
  const px = (x / size) * frequency;
  const py = (y / size) * frequency;
  const pz = (z / size) * frequency;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const z0 = Math.floor(pz);
  const fx = fade(px - x0);
  const fy = fade(py - y0);
  const fz = fade(pz - z0);
  const sample = (ix: number, iy: number, iz: number, dx: number, dy: number, dz: number): number => gradientDot(
    hash3(wrap(ix, frequency), wrap(iy, frequency), wrap(iz, frequency), salt),
    dx,
    dy,
    dz,
  );
  const x00 = THREE.MathUtils.lerp(sample(x0, y0, z0, px - x0, py - y0, pz - z0), sample(x0 + 1, y0, z0, px - x0 - 1, py - y0, pz - z0), fx);
  const x10 = THREE.MathUtils.lerp(sample(x0, y0 + 1, z0, px - x0, py - y0 - 1, pz - z0), sample(x0 + 1, y0 + 1, z0, px - x0 - 1, py - y0 - 1, pz - z0), fx);
  const x01 = THREE.MathUtils.lerp(sample(x0, y0, z0 + 1, px - x0, py - y0, pz - z0 - 1), sample(x0 + 1, y0, z0 + 1, px - x0 - 1, py - y0, pz - z0 - 1), fx);
  const x11 = THREE.MathUtils.lerp(sample(x0, y0 + 1, z0 + 1, px - x0, py - y0 - 1, pz - z0 - 1), sample(x0 + 1, y0 + 1, z0 + 1, px - x0 - 1, py - y0 - 1, pz - z0 - 1), fx);
  const noise = THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(x00, x10, fy),
    THREE.MathUtils.lerp(x01, x11, fy),
    fz,
  );
  return THREE.MathUtils.clamp(noise * 0.5 + 0.5, 0, 1);
}

function perlinFbm(x: number, y: number, z: number, size: number): number {
  return perlinNoise(x, y, z, size, 3, 11) * 0.54
    + perlinNoise(x, y, z, size, 6, 23) * 0.29
    + perlinNoise(x, y, z, size, 12, 47) * 0.17;
}

function worley(x: number, y: number, z: number, size: number, frequency: number, salt: number): number {
  const px = (x / size) * frequency;
  const py = (y / size) * frequency;
  const pz = (z / size) * frequency;
  const cellX = Math.floor(px);
  const cellY = Math.floor(py);
  const cellZ = Math.floor(pz);
  let nearest = Number.POSITIVE_INFINITY;

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cellX + dx;
        const ny = cellY + dy;
        const nz = cellZ + dz;
        const wx = wrap(nx, frequency);
        const wy = wrap(ny, frequency);
        const wz = wrap(nz, frequency);
        const featureX = nx + hash3(wx, wy, wz, salt);
        const featureY = ny + hash3(wx, wy, wz, salt + 1);
        const featureZ = nz + hash3(wx, wy, wz, salt + 2);
        const distance = (featureX - px) ** 2 + (featureY - py) ** 2 + (featureZ - pz) ** 2;
        nearest = Math.min(nearest, distance);
      }
    }
  }
  return 1 - THREE.MathUtils.clamp(Math.sqrt(nearest) / Math.sqrt(3), 0, 1);
}

function makeTexture(data: Uint8Array<ArrayBuffer>, size: number, name: string): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.name = name;
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function generateBaseNoise(size: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * size * 4);
  let index = 0;
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const perlin = perlinFbm(x, y, z, size);
        const worley4 = worley(x, y, z, size, 4, 71);
        const worley8 = worley(x, y, z, size, 8, 89);
        const worley16 = worley(x, y, z, size, 16, 107);
        const worleyFbm = worley4 * 0.625 + worley8 * 0.25 + worley16 * 0.125;
        const perlinWorley = THREE.MathUtils.clamp(perlin * 0.72 + worleyFbm * 0.52 - 0.22, 0, 1);
        data[index] = Math.round(perlinWorley * 255);
        data[index + 1] = Math.round(worleyFbm * 255);
        data[index + 2] = Math.round((worley8 * 0.7 + worley16 * 0.3) * 255);
        data[index + 3] = Math.round(worley16 * 255);
        index += 4;
      }
    }
  }
  return data;
}

function generateDetailNoise(size: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * size * 4);
  let index = 0;
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const worley4 = worley(x, y, z, size, 4, 131);
        const worley8 = worley(x, y, z, size, 8, 149);
        const worley16 = worley(x, y, z, size, 16, 167);
        data[index] = Math.round(worley4 * 255);
        data[index + 1] = Math.round(worley8 * 255);
        data[index + 2] = Math.round(worley16 * 255);
        data[index + 3] = 255;
        index += 4;
      }
    }
  }
  return data;
}

/** Clean-room Nubis-style low-frequency shape and high-frequency erosion noise. */
export function createNubisNoiseTextures(): NubisNoiseTextures {
  const base = makeTexture(generateBaseNoise(64), 64, "NubisBasePerlinWorley64");
  const detail = makeTexture(generateDetailNoise(32), 32, "NubisDetailWorley32");
  return {
    base,
    detail,
    dispose: () => {
      base.dispose();
      detail.dispose();
    },
  };
}
