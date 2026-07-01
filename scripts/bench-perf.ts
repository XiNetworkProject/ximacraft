/**
 * Benchmark headless des chemins chauds (CPU) : génération terrain, meshing,
 * lumière locale, neige, WorldMemory. Le rendu réel (rAF) ne tourne pas en
 * headless (voir memory: headless-preview-raf-limit), donc on mesure ici le
 * temps CPU des systèmes — la métrique demandée par la mission.
 *
 * Bundlé par esbuild puis exécuté par Node (voir scripts/run-bench.mjs).
 */
import { performance } from "node:perf_hooks";
import * as THREE from "three";
import { BlockRegistry } from "../src/world/BlockRegistry";
import { World } from "../src/world/World";
import { ChunkMesher } from "../src/world/ChunkMesher";
import { ChunkManager } from "../src/world/ChunkManager";
import { BlockId } from "../src/world/BlockTypes";
import { CHUNK_SIZE } from "../src/utils/Constants";
import { WorldSnowSystem } from "../src/weather/ground/WorldSnowSystem";
import { WeatherEngine } from "../src/weather/WeatherEngine";

const atlasStub = { getUv: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) } as any;
const SEED = "bench-fixed-seed";

function stats(samples: number[]): { avg: number; p95: number; p99: number; max: number; total: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((a, b) => a + b, 0);
  const idx = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { avg: total / samples.length, p95: idx(0.95), p99: idx(0.99), max: sorted[sorted.length - 1], total };
}

function fmt(ms: number): string {
  return ms.toFixed(3).padStart(8) + " ms";
}

function line(label: string, s: ReturnType<typeof stats>): void {
  console.log(
    `${label.padEnd(28)} avg ${fmt(s.avg)} | p95 ${fmt(s.p95)} | p99 ${fmt(s.p99)} | max ${fmt(s.max)} | total ${fmt(s.total)}`,
  );
}

/** Génère une grille de chunks autour de l'origine et mesure le temps de gen. */
function benchGenerationAndMeshing(radius: number): void {
  const registry = new BlockRegistry();
  const world = new World(SEED, registry);
  const mesher = new ChunkMesher(world, registry, atlasStub);

  const coords: Array<[number, number]> = [];
  for (let cz = -radius; cz <= radius; cz += 1) {
    for (let cx = -radius; cx <= radius; cx += 1) {
      coords.push([cx, cz]);
    }
  }

  const genSamples: number[] = [];
  for (const [cx, cz] of coords) {
    const t = performance.now();
    world.ensureChunk(cx, cz);
    genSamples.push(performance.now() - t);
  }

  const meshSamples: number[] = [];
  let triangles = 0;
  for (const [cx, cz] of coords) {
    const chunk = world.getChunk(cx, cz)!;
    const t = performance.now();
    const result = mesher.build(chunk);
    meshSamples.push(performance.now() - t);
    triangles += result.triangles;
    result.opaque?.dispose();
    result.transparent?.dispose();
    result.water?.dispose();
  }

  console.log(`\n== Génération + meshing (${coords.length} chunks, monde calme) ==`);
  line("terrain gen / chunk", stats(genSamples));
  line("meshing / chunk", stats(meshSamples));
  console.log(`triangles totaux: ${triangles.toLocaleString()}`);
}

/** Mesure le meshing d'un chunk truffé de lanternes (village de nuit). */
function benchVillageLighting(): void {
  const registry = new BlockRegistry();
  const world = new World(SEED, registry);
  const mesher = new ChunkMesher(world, registry, atlasStub);
  const cx = 0;
  const cz = 0;
  world.ensureChunk(cx, cz);
  // Halo : les voisins existent aussi (sources traversant les frontières).
  for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) world.ensureChunk(cx + dx, cz + dz);

  // Parsème des lanternes/glowstone/sea lanterns comme un village éclairé.
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  const lights = [BlockId.GLOWSTONE, BlockId.SEA_LANTERN, BlockId.HANGING_LANTERN, BlockId.LANTERN_POST, BlockId.FURNACE_ON];
  let n = 0;
  for (let lz = 2; lz < CHUNK_SIZE; lz += 5) {
    for (let lx = 2; lx < CHUNK_SIZE; lx += 5) {
      const wx = originX + lx;
      const wz = originZ + lz;
      const y = world.getSurfaceHeight(wx, wz) + 2;
      world.setBlock(wx, y, wz, lights[n % lights.length], false);
      n += 1;
    }
  }

  const chunk = world.getChunk(cx, cz)!;
  const samples: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    const t = performance.now();
    const result = mesher.build(chunk);
    samples.push(performance.now() - t);
    result.opaque?.dispose();
    result.transparent?.dispose();
    result.water?.dispose();
  }
  console.log(`\n== Meshing village éclairé (${n} sources dans le chunk) ==`);
  line("meshing chunk éclairé", stats(samples));
}

/**
 * Vérifie que le champ de lumière dense (scatter) donne EXACTEMENT le même
 * résultat qu'un gather par bloc de référence (même falloff/teintes). C'est la
 * garantie « couleurs conservées » de la refonte lumière.
 */
function verifyLightFieldExactness(): void {
  const registry = new BlockRegistry();
  const world = new World(SEED, registry);
  const mesher = new ChunkMesher(world, registry, atlasStub);
  for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) world.ensureChunk(dx, dz);
  const originX = 0;
  const originZ = 0;
  const lights = [BlockId.GLOWSTONE, BlockId.SEA_LANTERN, BlockId.HANGING_LANTERN, BlockId.FURNACE_ON, BlockId.CRYING_OBSIDIAN];
  let n = 0;
  for (let lz = 3; lz < CHUNK_SIZE; lz += 6) {
    for (let lx = 3; lx < CHUNK_SIZE; lx += 6) {
      const y = world.getSurfaceHeight(originX + lx, originZ + lz) + 2;
      world.setBlock(originX + lx, y, originZ + lz, lights[n % lights.length], false);
      n += 1;
    }
  }
  const FIELD_RADIUS = 7;
  const chunk = world.getChunk(0, 0)!;
  const lighting = (mesher as any).lighting;
  lighting.beginChunk(world, chunk);

  // Référence : gather par bloc rayon 7, math identique à l'ancienne engine.
  const tint = (id: number) => {
    const key = registry.get(id).key;
    if (key.includes("sea_lantern")) return [0.62, 0.95, 1.05];
    if (key.includes("furnace") || key.includes("campfire")) return [1.18, 0.58, 0.28];
    if (key.includes("lantern")) return [1.12, 0.78, 0.42];
    if (key.includes("crying_obsidian")) return [0.58, 0.32, 1.08];
    if (key.includes("glowstone")) return [1.12, 0.92, 0.5];
    return [1, 0.86, 0.62];
  };
  const refGather = (ix: number, iy: number, iz: number, r: number) => {
    let intensity = 0, red = 0, green = 0, blue = 0;
    for (let dy = -r; dy <= r; dy += 1)
      for (let dz = -r; dz <= r; dz += 1)
        for (let dx = -r; dx <= r; dx += 1) {
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > r * r) continue;
          const id = world.getBlock(ix + dx, iy + dy, iz + dz);
          const e = registry.get(id).lightLevel ?? 0;
          if (e <= 0) continue;
          const dist = Math.sqrt(distSq);
          const t = Math.max(0, 1 - dist / (r + 1));
          const strength = (e / 15) * Math.pow(t, 1.65);
          if (strength <= 0.001) continue;
          const [tr, tg, tb] = tint(id);
          intensity += strength; red += tr * strength; green += tg * strength; blue += tb * strength;
        }
    if (intensity <= 0) return null;
    return { intensity: Math.min(1.6, intensity), r: red / intensity, g: green / intensity, b: blue / intensity };
  };

  let maxErr = 0;
  let checked = 0;
  for (let y = 40; y < 90; y += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const wx = originX + lx, wz = originZ + lz;
        const field = lighting.sampleFieldAt(wx, y, wz);
        const ref = refGather(wx, y, wz, FIELD_RADIUS);
        checked += 1;
        if (!ref) {
          if (field.intensity > 1e-4) maxErr = Math.max(maxErr, field.intensity);
          continue;
        }
        maxErr = Math.max(
          maxErr,
          Math.abs(field.intensity - ref.intensity),
          Math.abs(field.r - ref.r),
          Math.abs(field.g - ref.g),
          Math.abs(field.b - ref.b),
        );
      }
    }
  }
  console.log(`\n== Vérif exactitude champ lumière (${checked} points) ==`);
  console.log(`erreur max vs gather de référence: ${maxErr.toExponential(2)} ${maxErr < 1e-5 ? "OK ✔" : "ÉCART ✘"}`);
}

/**
 * Mesure le coût récurrent du système de neige : matérialisation des couches de
 * neige sur les chunks chargés (le tic périodique qui provoquait des micro-lags).
 */
function benchSnow(): void {
  const registry = new BlockRegistry();
  const world = new World(SEED, registry);
  const engine = new WeatherEngine();
  const snow = new WorldSnowSystem(engine, world);
  // Centre le test sur de la terre ferme (le spawn), pas sur l'océan d'origine.
  const spawn = world.getSpawnPosition();
  const baseCx = Math.floor(spawn.x / CHUNK_SIZE);
  const baseCz = Math.floor(spawn.z / CHUNK_SIZE);
  engine.setObserver(spawn.x, spawn.z);
  // Manteau neigeux persistant sur toute la zone chargée.
  const tiles: any[] = [];
  const baseTx = Math.floor(spawn.x / 64);
  const baseTz = Math.floor(spawn.z / 64);
  for (let tz = baseTz - 3; tz <= baseTz + 3; tz += 1) for (let tx = baseTx - 3; tx <= baseTx + 3; tx += 1) tiles.push({ tx, tz, depth: 0.5, lastSnowAt: 0 });
  snow.restore({ version: 1, tiles });
  for (let cz = baseCz - 3; cz <= baseCz + 3; cz += 1) for (let cx = baseCx - 3; cx <= baseCx + 3; cx += 1) world.ensureChunk(cx, cz);

  // Steady-state : plus de chute de neige (scene undefined). On force plusieurs
  // tics d'application et on mesure — c'est le coût « rescan » périodique.
  const samples: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    const t = performance.now();
    snow.update(0.34, undefined);
    samples.push(performance.now() - t);
  }
  console.log(`\n== Neige steady-state (49 chunks chargés, ${snow.getPendingCount?.() ?? "?"} en attente) ==`);
  line("snow.update() / tic", stats(samples));

  // Correctness : la neige doit être matérialisée et posée sur une surface.
  let snowBlocks = 0;
  let misplaced = 0;
  for (let cz = baseCz - 3; cz <= baseCz + 3; cz += 1) {
    for (let cx = baseCx - 3; cx <= baseCx + 3; cx += 1) {
      const chunk = world.getChunk(cx, cz)!;
      const ox = cx * CHUNK_SIZE;
      const oz = cz * CHUNK_SIZE;
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          for (let y = 1; y < 120; y += 1) {
            const id = chunk.getLocal(lx, y, lz);
            if (id < BlockId.SNOW_LAYER_1 || id > BlockId.SNOW_LAYER_8) continue;
            snowBlocks += 1;
            const below = world.getBlock(ox + lx, y - 1, oz + lz);
            if (below === BlockId.AIR || below === BlockId.WATER) misplaced += 1;
          }
        }
      }
    }
  }
  console.log(`neige posée: ${snowBlocks} blocs, mal placés: ${misplaced} ${snowBlocks > 0 && misplaced === 0 ? "OK ✔" : "✘"}`);
}

/**
 * Simule un sprint : le joueur avance de 1 bloc/frame sur ~1200 blocs, générant
 * en continu de nouveaux chunks. Mesure le temps CPU par frame du ChunkManager
 * (génération + meshing budgétés + unload). C'est la métrique « chunks nouveaux
 * sans gros blocage » : ce sont les p95/p99/max qui comptent.
 */
function benchSprint(): void {
  const registry = new BlockRegistry();
  const world = new World(SEED, registry);
  const scene = new THREE.Scene();
  const tm = {
    atlas: atlasStub,
    opaqueMaterial: new THREE.MeshBasicMaterial(),
    transparentMaterial: new THREE.MeshBasicMaterial(),
    waterMaterial: new THREE.MeshBasicMaterial(),
  } as any;
  const cm = new ChunkManager(scene, world, registry, tm);
  cm.renderDistance = 6;
  cm.unloadDistance = 10;
  cm.maxChunkGenerationsPerFrame = 2;
  cm.maxChunkRebuildsPerFrame = 2;

  const spawn = world.getSpawnPosition();
  const pos = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
  // Amorçage : charge la zone de départ (hors mesure).
  for (let i = 0; i < 200; i += 1) cm.update(pos, 1, 0);

  const frames: number[] = [];
  for (let step = 0; step < 1200; step += 1) {
    pos.x += 1; // sprint plein est vers +x
    const t = performance.now();
    cm.update(pos, 1, 0);
    frames.push(performance.now() - t);
  }
  console.log(`\n== Sprint 1200 blocs (rendu 6, budget 2 gen + 2 mesh/frame) ==`);
  line("chunkManager.update()/frame", stats(frames));
  const over16 = frames.filter((f) => f > 16).length;
  const over33 = frames.filter((f) => f > 33).length;
  const over50 = frames.filter((f) => f > 50).length;
  console.log(`frames >16ms: ${over16} | >33ms: ${over33} | >50ms: ${over50}`);
}

function main(): void {
  console.log("XimaCraft — benchmark CPU headless");
  console.log("seed:", SEED);
  benchGenerationAndMeshing(3); // 7x7 = 49 chunks
  benchVillageLighting();
  benchSnow();
  benchSprint();
  verifyLightFieldExactness();
}

main();
