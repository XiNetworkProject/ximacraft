import * as THREE from "three";

/**
 * Bruit 3D pré-baké et TILEABLE pour les couches stratiformes.
 *
 * Deux textures `Data3DTexture` (WebGL2 / sampler3D) générées UNE SEULE FOIS et
 * mises en cache au niveau module (jamais re-baké par frame) :
 *  - `shape`  : basse fréquence Perlin-Worley (billow) + octaves Worley de
 *               déformation/érosion → silhouette et relief intérieur de la masse.
 *  - `detail` : Worley haute fréquence → érosion douce des bords.
 *
 * Les techniques (Perlin-Worley pour la forme, Worley FBM pour l'érosion, bruit
 * pré-baké en texture 3D, cache) sont ADAPTÉES (clean-room TypeScript, aucune
 * copie de source) depuis :
 *   - Sebastian Lague — "Coding Adventure: Clouds"  (MIT, Copyright (c) 2019 Sebastian Lague)
 *     https://github.com/SebLague/Clouds
 *   - frmlinn — clouds-sim  (MIT)  https://github.com/frmlinn/clouds-sim
 * Voir docs/CLOUDS_REFERENCES.md, LICENSES/ et THIRD_PARTY_NOTICES.md.
 *
 * `mhr1235/cl0ud` n'a servi que d'inspiration esthétique — aucun code repris.
 */

export interface StratiformNoiseTextures {
  shape: THREE.Data3DTexture;
  detail: THREE.Data3DTexture;
  /** Temps réel (ms) passé à générer les deux textures (mesuré une fois). */
  bakeMs: number;
}

const SHAPE_SIZE = 48;
const DETAIL_SIZE = 32;

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function hash3(x: number, y: number, z: number, salt: number): number {
  let value = Math.imul(x + salt * 19, 374761393);
  value = (value + Math.imul(y + salt * 31, 668265263)) | 0;
  value = (value + Math.imul(z + salt * 47, 1442695041)) | 0;
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

/** Perlin classique TILEABLE (période = frequency) → renvoie [0,1]. */
function perlin(x: number, y: number, z: number, size: number, frequency: number, salt: number): number {
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

/** Worley (F1) inversé TILEABLE → renvoie [0,1], 1 = cœur de cellule. */
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
        if (distance < nearest) nearest = distance;
      }
    }
  }
  return 1 - THREE.MathUtils.clamp(Math.sqrt(nearest) / Math.sqrt(3), 0, 1);
}

function worleyFbm(x: number, y: number, z: number, size: number, baseFreq: number, salt: number): number {
  const a = worley(x, y, z, size, baseFreq, salt);
  const b = worley(x, y, z, size, baseFreq * 2, salt + 5);
  const c = worley(x, y, z, size, baseFreq * 4, salt + 11);
  return a * 0.625 + b * 0.25 + c * 0.125;
}

function perlinFbm(x: number, y: number, z: number, size: number, baseFreq: number, salt: number): number {
  return perlin(x, y, z, size, baseFreq, salt) * 0.58
    + perlin(x, y, z, size, baseFreq * 2, salt + 3) * 0.29
    + perlin(x, y, z, size, baseFreq * 4, salt + 7) * 0.13;
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

function generateShape(size: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * size * 4);
  let index = 0;
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // R : silhouette Perlin-Worley (billow) — masse principale, très douce.
        const perlinLow = perlinFbm(x, y, z, size, 2, 3);
        const billow = worleyFbm(x, y, z, size, 3, 23);
        const perlinWorley = THREE.MathUtils.clamp(perlinLow * 0.72 + billow * 0.5 - 0.2, 0, 1);
        // G/B : octaves Worley pour le domain-warp et l'érosion progressive.
        const warp = worleyFbm(x, y, z, size, 4, 41);
        const holes = worley(x, y, z, size, 6, 59);
        // A : Perlin FBM doux pour casser toute répétition régulière.
        const soft = perlinFbm(x, y, z, size, 3, 71);
        data[index] = Math.round(perlinWorley * 255);
        data[index + 1] = Math.round(warp * 255);
        data[index + 2] = Math.round(holes * 255);
        data[index + 3] = Math.round(soft * 255);
        index += 4;
      }
    }
  }
  return data;
}

function generateDetail(size: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * size * 4);
  let index = 0;
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        data[index] = Math.round(worley(x, y, z, size, 4, 131) * 255);
        data[index + 1] = Math.round(worley(x, y, z, size, 8, 149) * 255);
        data[index + 2] = Math.round(worley(x, y, z, size, 16, 167) * 255);
        data[index + 3] = 255;
        index += 4;
      }
    }
  }
  return data;
}

let cached: StratiformNoiseTextures | null = null;
let cacheFailed = false;

/**
 * Renvoie les textures de bruit 3D stratiformes (mises en cache après le premier
 * bake). Renvoie `null` si l'environnement ne supporte pas `Data3DTexture`
 * (fallback FBM 2D côté shader). Ne bake jamais deux fois.
 */
export function getStratiformNoiseTextures(): StratiformNoiseTextures | null {
  if (cached) return cached;
  if (cacheFailed) return null;
  try {
    const started = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const shape = makeTexture(generateShape(SHAPE_SIZE), SHAPE_SIZE, "StratiformShapePerlinWorley48");
    const detail = makeTexture(generateDetail(DETAIL_SIZE), DETAIL_SIZE, "StratiformDetailWorley32");
    const bakeMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    cached = { shape, detail, bakeMs };
    return cached;
  } catch (error) {
    console.warn("StratiformNoiseTextures: 3D noise unavailable, falling back to 2D FBM.", error);
    cacheFailed = true;
    return null;
  }
}

/** Libère le cache (tests/hot-reload). Les textures GPU sont partagées : rare. */
export function disposeStratiformNoiseTextures(): void {
  cached?.shape.dispose();
  cached?.detail.dispose();
  cached = null;
  cacheFailed = false;
}
