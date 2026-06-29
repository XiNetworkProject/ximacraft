/**
 * Tests headless (logique pure, sans Three.js) de l'atlas météo.
 *
 * Lancé par scripts/run-weather-tests.mjs (bundle esbuild + node). Vérifie :
 *  - les transitions de scénarios sont graduelles et crédibles ;
 *  - un orage naît TOUJOURS d'un champ de cumulus existant (jamais clair->orage) ;
 *  - les orages restent RARES sous haute pression sèche ;
 *  - la pluie/neige est DÉRIVÉE des nuages épais + humidité (front chaud, neige) ;
 *  - la population de nuages est persistante (pas de top-N, dissipation lente).
 */

import { WeatherEngine } from "../src/weather/WeatherEngine";
import { WeatherScenarioDirector } from "../src/weather/scene/WeatherScenarioDirector";
import { PrecipitationKind, PrecipitationState, SkyState, WeatherScenario } from "../src/weather/scene/WeatherScene";
import { WeatherType } from "../src/weather/WeatherTypes";
import { CloudPopulation } from "../src/clouds/CloudPopulation";
import { CloudPopulationBand } from "../src/weather/scene/WeatherScene";
import { SurfaceWeatherState } from "../src/weather/ground/SurfaceWeatherState";
import { GroundAccumulationSystem } from "../src/weather/ground/GroundAccumulationSystem";
import { VisibilityController } from "../src/weather/visibility/VisibilityController";
import { TerrainGenerator } from "../src/world/TerrainGenerator";
import { BlockId } from "../src/world/BlockTypes";
import { Chunk } from "../src/world/Chunk";
import { SEA_LEVEL } from "../src/utils/Constants";
import { BlockGeometryBuilder } from "../src/world/BlockGeometryBuilder";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  - ${name}`);
  } else {
    failed += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL- ${name} ${detail}`);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STORM_SKIES = new Set<SkyState>([
  SkyState.STORM_VISIBLE_FAR, SkyState.STORM_APPROACHING, SkyState.STORM_OVERHEAD, SkyState.STORM_RECEDING,
]);

interface Harness {
  engine: WeatherEngine;
  director: WeatherScenarioDirector;
}

function makeHarness(seed: number, env: Parameters<WeatherScenarioDirector["setEnvironment"]>[0]): Harness {
  const engine = new WeatherEngine();
  engine.setObserver(0, 0);
  const director = new WeatherScenarioDirector(engine);
  director.setRng(mulberry32(seed));
  director.setEnvironment(env);
  return { engine, director };
}

function step(h: Harness, seconds: number, dt = 0.5): void {
  for (let t = 0; t < seconds; t += dt) {
    h.director.update(dt);
    h.engine.update(dt);
  }
}

/** Collecte la suite des états de ciel rencontrés pendant `seconds`. */
function collectSkySequence(h: Harness, seconds: number, dt = 0.5): SkyState[] {
  const seq: SkyState[] = [];
  for (let t = 0; t < seconds; t += dt) {
    h.director.update(dt);
    h.engine.update(dt);
    const sky = h.director.currentScene.skyState;
    if (seq[seq.length - 1] !== sky) seq.push(sky);
  }
  return seq;
}

// ============================================================================
console.log("\n[scene] storm born from cumulus field (never clear -> storm)");
{
  const h = makeHarness(1, { season: "SUMMER", timeOfDay: 0.5, biomeHumidity: 0.7, biomeTemperature: 22 });
  h.director.forceScenario(WeatherScenario.ISOLATED_THUNDERSTORM_DAY);
  const seq = collectSkySequence(h, 4000);
  const firstStorm = seq.findIndex((s) => STORM_SKIES.has(s));
  const fairIdx = seq.indexOf(SkyState.FAIR_WEATHER_CUMULUS);
  const towerIdx = seq.indexOf(SkyState.TOWERING_CUMULUS_FIELD);
  check("isolated thunderstorm reaches a storm sky", firstStorm >= 0, `seq=${seq.join(">")}`);
  check("fair cumulus precedes the storm", fairIdx >= 0 && fairIdx < firstStorm, `fair=${fairIdx} storm=${firstStorm}`);
  check("towering cumulus precedes the storm", towerIdx >= 0 && towerIdx < firstStorm, `tower=${towerIdx} storm=${firstStorm}`);
  check("a lightning-capable storm event was spawned", h.engine.getActiveEvents().some((e) => e.producesLightning) || seq.includes(SkyState.STORM_RECEDING));
  check("scenario ends in a post-shower clearing sky", seq.includes(SkyState.POST_SHOWER_SKY), `seq=${seq.join(">")}`);
}

// ============================================================================
console.log("\n[scene] fair cumulus day: clear -> cirrus/wisps -> cumulus, no storm");
{
  const h = makeHarness(7, { season: "SUMMER", timeOfDay: 0.45, biomeHumidity: 0.55, biomeTemperature: 19 });
  h.director.forceScenario(WeatherScenario.FAIR_CUMULUS_DAY);
  const seq = collectSkySequence(h, 4000);
  check("starts clear", seq[0] === SkyState.CRYSTAL_CLEAR, `seq=${seq.join(">")}`);
  check("develops fair-weather cumulus", seq.includes(SkyState.FAIR_WEATHER_CUMULUS));
  check("develops scattered cumulus", seq.includes(SkyState.SCATTERED_CUMULUS));
  check("never becomes a storm sky", !seq.some((s) => STORM_SKIES.has(s)), `seq=${seq.join(">")}`);
}

// ============================================================================
console.log("\n[scene] warm front: rain is DERIVED only under the thick humid deck");
{
  const h = makeHarness(3, { season: "AUTUMN", timeOfDay: 0.4, biomeHumidity: 0.6, biomeTemperature: 10, pressureTrend: -0.4 });
  // Phase voile haut (index 1) : ciel lumineux, pas de pluie.
  h.director.forceScenario(WeatherScenario.WARM_FRONT_SEQUENCE, { startPhase: 1 });
  step(h, 80);
  const veilPrecip = h.engine.sampleObserver().precipitation;
  check("high veil has ~no precipitation", veilPrecip < 0.08, `precip=${veilPrecip.toFixed(3)}`);
  // Phase nimbostratus (index 3) : pluie régulière dérivée.
  h.director.forceScenario(WeatherScenario.WARM_FRONT_SEQUENCE, { startPhase: 3 });
  step(h, 220);
  const rainPrecip = h.engine.sampleObserver().precipitation;
  check("nimbostratus produces steady rain", rainPrecip > 0.2, `precip=${rainPrecip.toFixed(3)}`);
}

// ============================================================================
console.log("\n[scene] winter overcast snow: cold + derived snow type");
{
  const h = makeHarness(11, { season: "WINTER", timeOfDay: 0.4, biomeHumidity: 0.7, biomeTemperature: -4, snowCover: 0.5 });
  h.director.forceScenario(WeatherScenario.WINTER_OVERCAST_SNOW, { startPhase: 1 });
  step(h, 260);
  const s = h.engine.sampleObserver();
  check("surface is below freezing", s.temperature <= 0, `temp=${s.temperature.toFixed(1)}`);
  check("precipitation present", s.precipitation > 0.15, `precip=${s.precipitation.toFixed(3)}`);
  check("classified as snow", s.weatherType === WeatherType.SNOW, `type=${s.weatherType}`);
}

// ============================================================================
console.log("\n[scene] transitions are gradual (no instant cover jumps)");
{
  const h = makeHarness(5, { season: "SPRING", timeOfDay: 0.5, biomeHumidity: 0.55, biomeTemperature: 14 });
  h.director.forceScenario(WeatherScenario.WARM_FRONT_SEQUENCE, { immediate: false });
  let prev = h.engine.sampleObserver().cloudCover;
  let maxJump = 0;
  for (let t = 0; t < 3000; t += 1) {
    h.director.update(1);
    h.engine.update(1);
    const cover = h.engine.sampleObserver().cloudCover;
    maxJump = Math.max(maxJump, Math.abs(cover - prev));
    prev = cover;
  }
  check("cloud cover never jumps abruptly (<0.2/s)", maxJump < 0.2, `maxJump=${maxJump.toFixed(3)}`);
}

// ============================================================================
console.log("\n[scene] clearing after rain is gradual (no rain -> blue instantly)");
{
  const h = makeHarness(9, { season: "AUTUMN", timeOfDay: 0.4, biomeHumidity: 0.65, biomeTemperature: 11, pressureTrend: -0.3 });
  h.director.forceScenario(WeatherScenario.FRONTAL_RAIN_SEQUENCE, { startPhase: 1 });
  step(h, 260);
  const peak = h.engine.sampleObserver().precipitation;
  // Passe en phase éclaircie lente.
  h.director.forceScenario(WeatherScenario.FRONTAL_RAIN_SEQUENCE, { startPhase: 3, immediate: false });
  let prev = h.engine.sampleObserver().precipitation;
  let maxDrop = 0;
  for (let t = 0; t < 400; t += 1) {
    h.director.update(1);
    h.engine.update(1);
    const p = h.engine.sampleObserver().precipitation;
    maxDrop = Math.max(maxDrop, prev - p);
    prev = p;
  }
  check("rain was significant before clearing", peak > 0.2, `peak=${peak.toFixed(3)}`);
  check("rain fades gradually (<0.15/s drop)", maxDrop < 0.15, `maxDrop=${maxDrop.toFixed(3)}`);
}

// ============================================================================
console.log("\n[scene] storms are RARE under stable dry high pressure");
{
  const h = makeHarness(42, { season: "SPRING", timeOfDay: 0.5, biomeHumidity: 0.3, biomeTemperature: 16, pressureTrend: 0.3 });
  h.director.forceScenario(WeatherScenario.CLEAR_DAY);
  const scenarioCounts = new Map<WeatherScenario, number>();
  let prevScenario = h.director.scenarioId;
  let transitions = 0;
  for (let t = 0; t < 60000; t += 1) {
    h.director.update(1);
    h.engine.update(1);
    if (h.director.scenarioId !== prevScenario) {
      prevScenario = h.director.scenarioId;
      transitions += 1;
      scenarioCounts.set(prevScenario, (scenarioCounts.get(prevScenario) ?? 0) + 1);
    }
  }
  const storms = (scenarioCounts.get(WeatherScenario.ISOLATED_THUNDERSTORM_DAY) ?? 0) +
    (scenarioCounts.get(WeatherScenario.ORGANIZED_THUNDERSTORM_DAY) ?? 0);
  check("multiple scenarios were chosen", transitions >= 5, `transitions=${transitions}`);
  check("storm scenarios are rare under dry high pressure", storms <= Math.max(1, transitions * 0.12), `storms=${storms}/${transitions}`);
}

// ============================================================================
console.log("\n[population] persistent clusters, 4 bands, no top-N deletion");
{
  const pop = new CloudPopulation(mulberry32(123));
  const richSampler = () => ({ cumulusPotential: 0.7, cloudCover: 0.5 });
  for (let t = 0; t < 60; t += 0.5) {
    pop.update(0.5, 0, 0, 0, 0, { background: 0.2, horizon: 0.8, mid: 0.8, hero: 0.8 }, richSampler);
  }
  const hero = pop.count(CloudPopulationBand.HERO_VOLUMES);
  const mid = pop.count(CloudPopulationBand.MID_FIELD);
  const horizon = pop.count(CloudPopulationBand.HORIZON_FIELD);
  check("hero volumes are capped at 5", hero <= 5, `hero=${hero}`);
  check("mid field is populated", mid > 0, `mid=${mid}`);
  check("horizon field is richly populated", horizon > 5, `horizon=${horizon}`);

  // Persistance : un cluster donné survit à de nombreux scans (pas de top-N).
  const tracked = pop.clusters.find((c) => c.band === CloudPopulationBand.MID_FIELD);
  const trackedId = tracked?.id ?? "";
  for (let t = 0; t < 40; t += 0.5) {
    pop.update(0.5, 0, 0, 0, 0, { background: 0.2, horizon: 0.8, mid: 0.8, hero: 0.8 }, richSampler);
  }
  check("a tracked cluster persists across many scans", pop.clusters.some((c) => c.id === trackedId), `id=${trackedId}`);
}

// ============================================================================
console.log("\n[population] dissipation is gradual when conditions dry out");
{
  const pop = new CloudPopulation(mulberry32(456));
  const rich = () => ({ cumulusPotential: 0.7, cloudCover: 0.5 });
  const dry = () => ({ cumulusPotential: 0, cloudCover: 0 });
  for (let t = 0; t < 40; t += 0.5) {
    pop.update(0.5, 0, 0, 0, 0, { background: 0.1, horizon: 0.8, mid: 0.8, hero: 0.8 }, rich);
  }
  const before = pop.clusters.length;
  // Une seule mise à jour sèche : les clusters ne doivent PAS disparaître d'un coup.
  pop.update(2, 0, 0, 0, 0, { background: 0, horizon: 0, mid: 0, hero: 0 }, dry);
  const justAfter = pop.clusters.length;
  const dissipating = pop.clusters.filter((c) => c.type === "DISSIPATING").length;
  check("clusters existed before drying", before > 0, `before=${before}`);
  check("clusters are NOT deleted instantly when dry", justAfter > 0, `justAfter=${justAfter}`);
  check("clusters enter DISSIPATING state", dissipating > 0, `dissipating=${dissipating}`);
  // Après un temps suffisant, ils finissent par disparaître (fonte douce).
  for (let t = 0; t < 60; t += 0.5) pop.update(0.5, 0, 0, 0, 0, { background: 0, horizon: 0, mid: 0, hero: 0 }, dry);
  check("clusters eventually clear out", pop.clusters.length < before, `after=${pop.clusters.length} before=${before}`);
}

// ============================================================================
console.log("\n[population] clusters drift with the wind");
{
  const pop = new CloudPopulation(mulberry32(789));
  const rich = () => ({ cumulusPotential: 0.7, cloudCover: 0.5 });
  for (let t = 0; t < 6; t += 0.5) pop.update(0.5, 0, 0, 0, 0, { background: 0.2, horizon: 0.8, mid: 0.8, hero: 0.8 }, rich);
  const tracked = pop.clusters[0];
  const startX = tracked.x;
  for (let t = 0; t < 20; t += 0.5) pop.update(0.5, 0, 0, 12, 0, { background: 0.2, horizon: 0.8, mid: 0.8, hero: 0.8 }, rich);
  check("a cluster drifts downwind (+x)", tracked.x > startX + 10, `dx=${(tracked.x - startX).toFixed(1)}`);
}

// ============================================================================
console.log("\n[surface] rich precipitation drives persistent snow and ice");
{
  const h = makeHarness(812, { season: "WINTER", timeOfDay: 0.3, biomeHumidity: 0.8, biomeTemperature: -5 });
  h.director.forceScenario(WeatherScenario.WINTER_OVERCAST_SNOW, { startPhase: 1 });
  step(h, 3);
  const state = new SurfaceWeatherState(() => 64);
  const ground = new GroundAccumulationSystem(state);
  ground.update(1, h.engine.sampleObserver(), 0, 0, 0, h.director.currentScene.precipitation, -5);
  check("steady snow accumulates on surface columns", state.totalSnow() > 0, `snow=${state.totalSnow().toFixed(3)}`);

  const freezingRain: PrecipitationState = {
    kind: PrecipitationKind.FREEZING_RAIN,
    intensity: 0.8,
    spatialPattern: "uniform",
    beginsAtCloudBase: true,
    reachesGround: true,
    virga: false,
    windTilt: 0.2,
  };
  ground.update(1, { ...h.engine.sampleObserver(), temperature: -3 }, 0, 0, 0, freezingRain, -3);
  const center = state.get(0, 0);
  check("freezing rain creates a persistent ice layer", (center?.iceDepth ?? 0) > 0, `ice=${center?.iceDepth ?? 0}`);
  check("freezing rain also leaves the surface wet", (center?.wetness ?? 0) > 0, `wet=${center?.wetness ?? 0}`);
}

// ============================================================================
console.log("\n[visibility] fog, snow squalls and sand have distinct ranges");
{
  const h = makeHarness(900, { season: "WINTER", timeOfDay: 0.1, biomeHumidity: 0.9, biomeTemperature: -4 });
  const visibility = new VisibilityController();
  h.director.forceSky(SkyState.DENSE_FOG);
  const fog = visibility.resolve(h.director.currentScene);
  h.director.forceSky(SkyState.WHITEOUT);
  const whiteout = visibility.resolve(h.director.currentScene);
  h.director.forceSky(SkyState.SANDSTORM_SKY);
  const sand = visibility.resolve(h.director.currentScene);
  check("dense fog sharply limits range", fog.fogFar < 300, `far=${fog.fogFar.toFixed(1)}`);
  check("whiteout is at least as restrictive as dense fog", whiteout.fogFar <= fog.fogFar, `whiteout=${whiteout.fogFar.toFixed(1)} fog=${fog.fogFar.toFixed(1)}`);
  check("sandstorm exposes a warm dust tint", sand.dustTint > 0.5, `dust=${sand.dustTint.toFixed(2)}`);
}

// ============================================================================
console.log("\n[living] micro-biomes and rare POI are seed-deterministic");
{
  const a = new TerrainGenerator("living-world-test");
  const b = new TerrainGenerator("living-world-test");
  const foundMicroBiomes = new Set<string>();
  let sameMicroBiomes = true;
  for (let z = -192; z <= 192; z += 16) {
    for (let x = -192; x <= 192; x += 16) {
      const height = a.getHeight(x, z);
      const biome = a.biomes.sample(x, z, height).id;
      const ma = a.living.sampleMicroBiome(x, z, biome, height);
      const mb = b.living.sampleMicroBiome(x, z, biome, height);
      sameMicroBiomes &&= ma === mb;
      foundMicroBiomes.add(ma);
    }
  }

  let poiDeterministic = true;
  let sawPoi = false;
  for (let z = -256; z <= 256; z += 1) {
    for (let x = -256; x <= 256; x += 1) {
      const height = a.getHeight(x, z);
      const biome = a.biomes.sample(x, z, height).id;
      const pa = a.living.poiAt(x, z, biome, height);
      const pb = b.living.poiAt(x, z, biome, height);
      poiDeterministic &&= pa === pb;
      sawPoi ||= pa !== null;
    }
  }

  check("micro-biomes repeat exactly for the same seed", sameMicroBiomes);
  check("micro-biome scan produces varied natural pockets", foundMicroBiomes.size >= 4, `types=${[...foundMicroBiomes].join(",")}`);
  check("rare POI anchors repeat exactly for the same seed", poiDeterministic);
  check("rare POI anchors exist in a broad deterministic scan", sawPoi);
}

// ============================================================================
console.log("\n[living] vegetation decorators generate grouped natural detail");
{
  const gen = new TerrainGenerator("living-vegetation-test");
  let meadowPlants = 0;
  let forestGroundCover = 0;
  for (let z = -160; z <= 160; z += 4) {
    for (let x = -160; x <= 160; x += 4) {
      const meadow = gen.living.decorativePlant(x, z, 72, "plains");
      if ([BlockId.TALL_GRASS, BlockId.SHORT_GRASS, BlockId.DANDELION, BlockId.POPPY, BlockId.BLUE_FLOWER, BlockId.WHITE_FLOWER].includes(meadow)) meadowPlants += 1;

      const forest = gen.living.decorativePlant(x + 900, z - 300, 78, "forest");
      if ([BlockId.FERN, BlockId.WILD_BUSH, BlockId.MOSS_CARPET].includes(forest)) forestGroundCover += 1;
    }
  }

  check("meadows create visible but budgeted grass and flower groups", meadowPlants > 180 && meadowPlants < 900, `count=${meadowPlants}`);
  check("forests create grouped fern/bush/moss undergrowth without carpeting every tile", forestGroundCover > 50 && forestGroundCover < 500, `count=${forestGroundCover}`);

  let shoreDecor = 0;
  for (let cz = -3; cz <= 3; cz += 1) {
    for (let cx = -3; cx <= 3; cx += 1) {
      const chunk = new Chunk(cx, cz);
      const h = SEA_LEVEL + 1;
      for (let z = 0; z < 16; z += 1) {
        for (let x = 0; x < 16; x += 1) {
          chunk.setLocal(x, h, z, BlockId.WATER);
        }
      }
      for (let z = 2; z < 14; z += 2) {
        for (let x = 2; x < 14; x += 2) {
          chunk.setLocal(x, h, z, BlockId.GRASS);
          gen.living.decorateColumn(chunk, x, h, z, "plains");
          const above = chunk.getLocal(x, h + 1, z);
          if (above === BlockId.REEDS || chunk.getLocal(x, h, z) === BlockId.MUD) shoreDecor += 1;
        }
      }
    }
  }
  check("shore decorators add reeds or mud near water without legacy track blocks", shoreDecor > 60, `count=${shoreDecor}`);

  let generatedTracks = 0;
  for (let cz = -1; cz <= 1; cz += 1) {
    for (let cx = -1; cx <= 1; cx += 1) {
      const chunk = new Chunk(cx, cz);
      gen.generateChunk(chunk);
      for (const block of chunk.blocks) {
        if (block === BlockId.ANIMAL_TRACKS) generatedTracks += 1;
      }
    }
  }
  check("terrain generation never emits legacy animal track blocks", generatedTracks === 0, `tracks=${generatedTracks}`);
}

// ============================================================================
console.log("\n[world] region planner and block geometry are deterministic");
{
  const a = new TerrainGenerator("region-shape-test");
  const b = new TerrainGenerator("region-shape-test");
  let sameRegionPlan = true;
  let sawRoadOrSettlement = false;
  for (let z = -1536; z <= 1536; z += 64) {
    for (let x = -1536; x <= 1536; x += 64) {
      const ha = a.getHeight(x, z);
      const hb = b.getHeight(x, z);
      const ba = a.biomes.sample(x, z, ha).id;
      const bb = b.biomes.sample(x, z, hb).id;
      const pa = a.regions.sampleColumn(x, z, ha, ba, (wx, wz) => a.getHeight(wx, wz));
      const pb = b.regions.sampleColumn(x, z, hb, bb, (wx, wz) => b.getHeight(wx, wz));
      sameRegionPlan &&= JSON.stringify(pa) === JSON.stringify(pb);
      sawRoadOrSettlement ||= !!pa.surface || pa.blocks.length > 0;
    }
  }
  check("same seed produces identical region plans", sameRegionPlan);
  check("broad scan finds at least one road or settlement column", sawRoadOrSettlement);

  const slab = BlockGeometryBuilder.boxesFor("slab_bottom", { north: false, south: false, east: false, west: false, up: false, down: false }, 1);
  const stair = BlockGeometryBuilder.boxesFor("stair_north", { north: false, south: false, east: false, west: false, up: false, down: false }, 1);
  const fence = BlockGeometryBuilder.boxesFor("fence", { north: true, south: false, east: true, west: false, up: false, down: false }, 1);
  check("slab geometry is half-height", slab.length === 1 && slab[0].maxY === 0.5);
  check("stair geometry is built from multiple boxes, not a full cube", stair.length >= 2);
  check("connected fence geometry adds two rails only toward connections", fence.length === 5);
}

// ============================================================================
console.log(`\n=== weather atlas tests: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
