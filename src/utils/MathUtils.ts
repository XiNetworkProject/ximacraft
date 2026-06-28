import { CHUNK_SIZE } from "./Constants";

export type Vec3Key = `${number},${number},${number}`;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function worldToChunk(value: number): number {
  return floorDiv(Math.floor(value), CHUNK_SIZE);
}

export function worldToLocal(value: number): number {
  return positiveModulo(Math.floor(value), CHUNK_SIZE);
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function blockKey(x: number, y: number, z: number): Vec3Key {
  return `${x},${y},${z}`;
}

export function parseBlockKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(",").map(Number);
  return [x, y, z];
}

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
