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

import * as THREE from "three";
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
import { isForestBiome } from "../src/world/BiomeGenerator";
import { BlockId } from "../src/world/BlockTypes";
import { Chunk } from "../src/world/Chunk";
import { SEA_LEVEL } from "../src/utils/Constants";
import { BlockGeometryBuilder } from "../src/world/BlockGeometryBuilder";
import { ThermalComfortSystem } from "../src/environment/ThermalComfortSystem";
import { SurfaceConditionSystem } from "../src/environment/SurfaceConditionSystem";
import { WorldPhenologySystem } from "../src/environment/WorldPhenologySystem";
import { FogBankSystem } from "../src/environment/FogBankSystem";
import { dewPointC } from "../src/environment/EnvironmentDirector";
import { SeasonState } from "../src/living/SeasonSystem";
import { WeatherRadarHistory } from "../src/weather/map/WeatherRadarHistory";
import { FogDensitySampler } from "../src/render/weather/fog/FogDensitySampler";
import type { FogBankRenderSample } from "../src/environment/FogBankSystem";
import { FogLodSystem } from "../src/render/weather/fog/FogLodSystem";
import { EntityAssetManager } from "../src/living/EntityAssetManager";
import { EntityAnimationController } from "../src/living/EntityAnimationController";
import { SpatialAudioMixer } from "../src/assets/SpatialAudioMixer";
import { PlayerInventory } from "../src/player/PlayerInventory";
import { CraftingSystem } from "../src/items/CraftingSystem";
import { SmeltingSystem } from "../src/items/SmeltingSystem";
import { WorldMemorySystem } from "../src/living/WorldMemorySystem";
import { World } from "../src/world/World";
import { BlockRegistry } from "../src/world/BlockRegistry";
import { buildWorldMapData } from "../src/ui/WorldMapJournalUI";
import { LightingEngine } from "../src/world/LightingEngine";
import { WaterWaves } from "../src/render/weather/WaterWaves";

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
console.log("\n[environment] seasons, comfort, dew/frost and fog are coherent");
{
  const thermal = new ThermalComfortSystem();
  const cold = thermal.resolve({ temperature: -4, humidity: 0.72, windSpeed: 12, sunExposure: 0.05, precipitation: 0.2 });
  const hot = thermal.resolve({ temperature: 31, humidity: 0.78, windSpeed: 2, sunExposure: 0.9, precipitation: 0 });
  check("wind and precipitation create cold stress in winter", cold.coldStress > 0.35 && cold.feelsLike < -4, `feels=${cold.feelsLike.toFixed(1)} stress=${cold.coldStress.toFixed(2)}`);
  check("humid sunny heat creates heat stress", hot.heatStress > 0.35 && hot.feelsLike > 33, `feels=${hot.feelsLike.toFixed(1)} stress=${hot.heatStress.toFixed(2)}`);

  const surfaceState = new SurfaceWeatherState(() => 70);
  const surface = new SurfaceConditionSystem();
  const frostSample = {
    temperature: -1,
    humidity: 0.94,
    pressure: 1016,
    instability: 0,
    cloudCover: 0.12,
    precipitation: 0,
    thunderRisk: 0,
    windX: 0.3,
    windZ: 0.2,
    clearingBias: 0,
    weatherType: WeatherType.CLEAR,
    windSpeed: 0.36,
  };
  const frost = surface.resolve({ x: 0, z: 0, weather: frostSample, dewPoint: dewPointC(-1, 0.94), dayFactor: 0.05, exposedToSky: 1, surfaceState });
  const dew = surface.resolve({ x: 0, z: 0, weather: { ...frostSample, temperature: 7, humidity: 0.92, windSpeed: 0.4 }, dewPoint: dewPointC(7, 0.92), dayFactor: 0.08, exposedToSky: 1, surfaceState });
  check("cold saturated calm night creates frost", frost.frost > 0.1 && frost.mood === "frost", `frost=${frost.frost.toFixed(2)} mood=${frost.mood}`);
  check("mild saturated calm night creates dew", dew.dew > 0.1 && dew.mood === "dew", `dew=${dew.dew.toFixed(2)} mood=${dew.mood}`);
  const snowyColumn = surfaceState.ensure(3, 4, 0);
  snowyColumn.snowDepth = 0.58;
  snowyColumn.wetness = 0.82;
  const snowySurface = surface.resolve({
    x: 3,
    z: 4,
    weather: { ...frostSample, temperature: -4, humidity: 0.88, precipitation: 0.65, weatherType: WeatherType.SNOW, windSpeed: 9 },
    dewPoint: dewPointC(-4, 0.88),
    dayFactor: 0.35,
    exposedToSky: 0.9,
    surfaceState,
  });
  check(
    "snow surface exposes cover, burial, compacted road and wet visual channels",
    snowySurface.groundSnowWhitening > 0.45 &&
      snowySurface.vegetationSnowWhitening > 0.45 &&
      snowySurface.flowerBurial > snowySurface.grassBurial &&
      snowySurface.roadCompaction > 0.05 &&
      snowySurface.wetDarkening > 0.05,
    `ground=${snowySurface.groundSnowWhitening.toFixed(2)} veg=${snowySurface.vegetationSnowWhitening.toFixed(2)} flower=${snowySurface.flowerBurial.toFixed(2)} road=${snowySurface.roadCompaction.toFixed(2)} wet=${snowySurface.wetDarkening.toFixed(2)}`,
  );

  const phenology = new WorldPhenologySystem();
  const winter: SeasonState = { season: "winter", dayOfYear: 80, progress: 0.35, temperatureOffset: -6, vegetation: 0.28, wildlife: 0.4, insectActivity: 0.03, leafWarmth: 0.08, snowBias: 0.78 };
  const autumn: SeasonState = { season: "autumn", dayOfYear: 60, progress: 0.6, temperatureOffset: -1, vegetation: 0.72, wildlife: 0.78, insectActivity: 0.38, leafWarmth: 0.72, snowBias: 0.08 };
  const winterVisual = phenology.resolve(winter, snowySurface, -3, 0.8, 0.3);
  const autumnVisual = phenology.resolve(autumn, dew, 11, 0.65, 0.55);
  check("winter visual state mutes vegetation and raises snow/frost", winterVisual.vegetation < 0.4 && winterVisual.snow > 0.4 && winterVisual.frost > 0.1);
  check("winter visual state drives mesh snow and deciduous leaf drop", winterVisual.snowGround > 0.45 && winterVisual.snowVegetation > 0.45 && winterVisual.leafDrop > 0.5);
  check("autumn visual state warms leaves without forcing full snow", autumnVisual.leafWarmth > 0.65 && autumnVisual.snow < 0.2);

  const fogA = new FogBankSystem();
  const fogB = new FogBankSystem();
  let stateA = fogA.update(3, { seed: "fog-seed", playerX: 0, playerZ: 0, humidity: 0.96, dewPoint: 8, temperature: 8.2, windX: 0.8, windZ: 0.1, windSpeed: 0.8, dayFactor: 0.02, precipitation: 0, waterNearby: 0.8, valleyFactor: 0.5 });
  let stateB = fogB.update(3, { seed: "fog-seed", playerX: 0, playerZ: 0, humidity: 0.96, dewPoint: 8, temperature: 8.2, windX: 0.8, windZ: 0.1, windSpeed: 0.8, dayFactor: 0.02, precipitation: 0, waterNearby: 0.8, valleyFactor: 0.5 });
  for (let i = 0; i < 12; i += 1) {
    stateA = fogA.update(3, { seed: "fog-seed", playerX: 0, playerZ: 0, humidity: 0.96, dewPoint: 8, temperature: 8.2, windX: 0.8, windZ: 0.1, windSpeed: 0.8, dayFactor: 0.02, precipitation: 0, waterNearby: 0.8, valleyFactor: 0.5 });
    stateB = fogB.update(3, { seed: "fog-seed", playerX: 0, playerZ: 0, humidity: 0.96, dewPoint: 8, temperature: 8.2, windX: 0.8, windZ: 0.1, windSpeed: 0.8, dayFactor: 0.02, precipitation: 0, waterNearby: 0.8, valleyFactor: 0.5 });
  }
  check("humid calm water/valley setup creates visible fog or mist", stateA.density > 0.15, `density=${stateA.density.toFixed(2)}`);
  check("fog bank sampling is deterministic for same seed/input", stateA.density.toFixed(3) === stateB.density.toFixed(3) && stateA.kind === stateB.kind, `a=${stateA.density.toFixed(3)} b=${stateB.density.toFixed(3)}`);
}

// ============================================================================
console.log("\n[environment] volumetric fog layers respect terrain, sun and LOD");
{
  const sample: FogBankRenderSample = { id: "valley-test", x: 0, z: 0, radius: 220, density: 0.78, kind: "valley" };
  const lod = new FogLodSystem();
  const sampler = new FogDensitySampler();
  const getHeight = (x: number, z: number) => Math.hypot(x, z) > 80 ? 94 : 55;
  const baseContext = {
    time: 12,
    cameraX: -90,
    cameraZ: 20,
    windX: 3,
    windZ: 0.8,
    sunExposure: 0.08,
    environment: null,
    getHeight,
  };
  const near = lod.settingsFor(120, sample.density, "high");
  const far = lod.settingsFor(1800, sample.density, "high");
  const layers = sampler.layersFor(sample, near, baseContext);
  const sunnyLayers = sampler.layersFor(sample, near, { ...baseContext, sunExposure: 0.9 });
  const profile = sampler.heightProfileFor(sample, baseContext);
  const opacity = layers.reduce((sum, l) => sum + l.opacity, 0);
  const sunnyOpacity = sunnyLayers.reduce((sum, l) => sum + l.opacity, 0);
  check("volumetric fog creates several stacked layers", layers.length >= 5, `layers=${layers.length}`);
  check("valley fog stays under surrounding relief", profile.topY <= profile.reliefCeilingY + 0.01 && profile.topY < 94, `top=${profile.topY.toFixed(1)} relief=${profile.reliefCeilingY.toFixed(1)}`);
  check("all fog layers remain inside the computed height field", layers.every((l) => l.y >= profile.baseY - 3 && l.y <= profile.topY + 3), `base=${profile.baseY.toFixed(1)} top=${profile.topY.toFixed(1)}`);
  check("morning sun dissipates visible fog density", opacity > sunnyOpacity * 1.35, `fog=${opacity.toFixed(2)} sunny=${sunnyOpacity.toFixed(2)}`);
  check("distant fog uses fewer layers than nearby fog", far.slices < near.slices, `near=${near.slices} far=${far.slices}`);
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
console.log("\n[living] wildlife models, animation and spatial cues are real systems");
{
  const assets = new EntityAssetManager();
  const rabbit = assets.assetFor("rabbit");
  const deer = assets.assetFor("deer");
  const bird = assets.assetFor("bird");
  const rabbitVertices = rabbit.geometry.getAttribute("position").count;
  const deerVertices = deer.geometry.getAttribute("position").count;
  const birdVertices = bird.geometry.getAttribute("position").count;
  check("wildlife assets are multi-part procedural silhouettes, not single cubes", rabbit.definition.parts.length >= 6 && deer.definition.parts.length >= 8 && bird.definition.parts.length >= 5);
  check("wildlife geometries have rich vertex silhouettes", rabbitVertices > 120 && deerVertices > 160 && birdVertices > 40, `rabbit=${rabbitVertices} deer=${deerVertices} bird=${birdVertices}`);

  const animation = new EntityAnimationController();
  const butterflyA = animation.pose({ species: "butterfly", mode: "fly", age: 0, phase: 0, visible: 1, heading: 0, baseScale: new THREE.Vector3(1, 1, 1) });
  const butterflyB = animation.pose({ species: "butterfly", mode: "fly", age: 0.2, phase: 0, visible: 1, heading: 0, baseScale: new THREE.Vector3(1, 1, 1) });
  const frog = animation.pose({ species: "frog", mode: "flee", age: 0.2, phase: 0, visible: 1, heading: 0, baseScale: new THREE.Vector3(1, 1, 1) });
  check("winged wildlife animation changes scale/roll over time", Math.abs(butterflyA.scale.x - butterflyB.scale.x) > 0.01 || Math.abs(butterflyA.rotation.z - butterflyB.rotation.z) > 0.01);
  check("ground wildlife animation exposes hop/bob state", frog.bob > 0);

  const mixer = new SpatialAudioMixer();
  mixer.setListener({ x: 0, y: 64, z: 0 });
  mixer.emit({ id: "wildlife.frog.wet", x: 12, y: 65, z: 5, volume: 0.2, radius: 64 });
  mixer.emit({ id: "wildlife.bird.distant", x: -24, y: 72, z: -28, volume: 0.15, radius: 96 });
  const events = mixer.consume();
  check("spatial wildlife mixer queues distinct local audio events", events.length === 2 && events[0].id.includes("frog") && events[1].id.includes("bird"));
  check("spatial wildlife mixer consume clears the event queue", mixer.consume().length === 0);
  assets.dispose();
  mixer.dispose();
}

// ============================================================================
console.log("\n[inventory] survival inventory, crafting grid and furnace have real state");
{
  const inv = new PlayerInventory();
  inv.slots.fill(null);
  inv.slots[0] = { blockId: BlockId.OAK_PLANKS, count: 60 };
  inv.slots[9] = { blockId: BlockId.OAK_PLANKS, count: 40 };
  const remaining = inv.insertStack({ blockId: BlockId.OAK_PLANKS, count: 12 }, 0, inv.slots.length);
  check("insertStack merges before using empty slots", remaining === null && inv.count(BlockId.OAK_PLANKS) === 112);
  check("stacks stay capped at 64 while overflow occupies another slot", inv.slots.some((slot) => slot?.blockId === BlockId.OAK_PLANKS && slot.count === 64));
  inv.moveSlotToRange(0, 9, inv.slots.length);
  check("shift-style transfer moves hotbar stacks into inventory range", inv.slots[0] === null && inv.count(BlockId.OAK_PLANKS) === 112);

  const crafting = new CraftingSystem();
  const grid2 = Array.from({ length: 4 }, () => null) as Array<{ blockId: BlockId; count: number } | null>;
  grid2[0] = { blockId: BlockId.OAK_PLANKS, count: 1 };
  grid2[1] = { blockId: BlockId.OAK_PLANKS, count: 1 };
  grid2[2] = { blockId: BlockId.OAK_PLANKS, count: 1 };
  grid2[3] = { blockId: BlockId.OAK_PLANKS, count: 1 };
  const tableMatch = crafting.matchGrid(grid2, 2, 2, false);
  check("2x2 grid crafts a crafting table from four planks", tableMatch?.recipe.id === "planks_to_table" && tableMatch.output.blockId === BlockId.CRAFTING_TABLE);

  const grid3 = Array.from({ length: 9 }, (_, index) => (index === 4 ? null : { blockId: BlockId.COBBLESTONE, count: 1 }));
  const furnaceNoTable = crafting.matchGrid(grid3, 3, 3, false);
  const furnaceWithTable = crafting.matchGrid(grid3, 3, 3, true);
  check("3x3 furnace recipe requires a crafting table context", furnaceNoTable === null && furnaceWithTable?.output.blockId === BlockId.FURNACE);
  if (furnaceWithTable) crafting.consumeMatchedGrid(grid3, 3, 3, furnaceWithTable.recipe);
  check("crafting result consumes one ingredient from each occupied grid cell", grid3.filter(Boolean).length === 0);

  const smelting = new SmeltingSystem();
  const furnace = smelting.createState();
  furnace.input = { blockId: BlockId.SAND, count: 2 };
  furnace.fuel = { blockId: BlockId.COAL_ORE, count: 2 };
  let changed = smelting.updateFurnace(furnace, 0.1);
  check("furnace starts only from explicit input and fuel slots", changed && Boolean(furnace.activeRecipeId));
  smelting.updateFurnace(furnace, 6);
  check("furnace progress produces output after recipe duration", furnace.output?.blockId === BlockId.GLASS && furnace.output.count >= 1);
  check("furnace consumes fuel and input instead of auto-smelting inventory", (furnace.input?.count ?? 0) <= 1 && (furnace.fuel?.count ?? 0) <= 1);
}

// ============================================================================
console.log("\n[map] world map and journal are generated from real world state");
{
  const world = new World("journal-map-seed", new BlockRegistry());
  const memory = new WorldMemorySystem();
  const surface = new SurfaceWeatherState((x, z) => world.getSurfaceHeight(x, z));
  const sample = new WeatherEngine().sampleObserver();
  memory.update(1, world, surface, { x: 64, z: 64 }, sample);
  memory.update(1, world, surface, { x: 118, z: 42 }, { ...sample, weatherType: WeatherType.LIGHT_RAIN, precipitation: 0.25 });
  const journal = memory.snapshot();
  const mapA = buildWorldMapData(world, { x: 118, z: 42 }, 1024, 64, journal);
  const mapB = buildWorldMapData(world, { x: 118, z: 42 }, 1024, 64, journal);
  check("world journal records visited biomes and weather", journal.biomes.length >= 1 && journal.weather.includes(WeatherType.LIGHT_RAIN));
  check("world map samples deterministic terrain around the player", JSON.stringify(mapA.samples.slice(0, 16)) === JSON.stringify(mapB.samples.slice(0, 16)));
  check("world map exposes relief, biome and water/road layers", mapA.samples.length > 100 && mapA.samples.some((s) => s.height !== mapA.samples[0].height) && mapA.samples.some((s) => s.biome));
  check("world map carries player marker and journal snapshot", mapA.player.x === 118 && mapA.journal.distanceTravelled > 0);
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
  const path = BlockGeometryBuilder.boxesFor("path", { north: false, south: false, east: false, west: false, up: false, down: false }, 1);
  check("slab geometry is half-height", slab.length === 1 && slab[0].maxY === 0.5);
  check("stair geometry is built from multiple boxes, not a full cube", stair.length >= 2);
  check("connected fence geometry adds two rails only toward connections", fence.length === 5);
  check("terrain path geometry is full height to avoid blue ground holes", path.length === 1 && path[0].maxY === 1);
}

// ============================================================================
console.log("\n[world] macro-biomes, forest patches and bridgeable roads are coherent");
{
  const gen = new TerrainGenerator("macro-biome-coherence-test");
  const primaries: string[] = [];
  let transitionInRange = true;
  for (let x = -2048; x <= 2048; x += 64) {
    const z = 384;
    const h = gen.getHeight(x, z);
    const hydro = gen.macro.sample(x, z).hydrology;
    const biome = gen.biomes.sample(x, z, h, hydro);
    primaries.push(biome.primary ?? biome.id);
    transitionInRange &&= (biome.transition ?? 0) >= 64 && (biome.transition ?? 0) <= 256;
  }
  let primaryChanges = 0;
  for (let i = 1; i < primaries.length; i += 1) {
    if (primaries[i] !== primaries[i - 1]) primaryChanges += 1;
  }
  check("macro-biome primary identity changes slowly across several kilometers", primaryChanges < primaries.length * 0.38, `changes=${primaryChanges}/${primaries.length}`);
  check("biome transitions stay in the requested 64-256m range", transitionInRange);

  let forestAnchor: { x: number; z: number; biome: string } | null = null;
  let plainAnchor: { x: number; z: number; biome: string } | null = null;
  for (let z = -2048; z <= 2048; z += 32) {
    for (let x = -2048; x <= 2048; x += 32) {
      const h = gen.getHeight(x, z);
      const hydro = gen.macro.sample(x, z).hydrology;
      const biome = gen.biomes.sample(x, z, h, hydro).id;
      if (!forestAnchor && isForestBiome(biome)) forestAnchor = { x, z, biome };
      if (!plainAnchor && (biome === "plains" || biome === "dry_prairie" || biome === "flower_meadow")) plainAnchor = { x, z, biome };
    }
  }

  function treeAnchorsAround(anchor: { x: number; z: number; biome: string } | null): number {
    if (!anchor) return 0;
    let count = 0;
    for (let z = anchor.z - 128; z <= anchor.z + 128; z += 1) {
      for (let x = anchor.x - 128; x <= anchor.x + 128; x += 1) {
        const h = gen.getHeight(x, z);
        const hydro = gen.macro.sample(x, z).hydrology;
        const biome = gen.biomes.sample(x, z, h, hydro).id;
        if (biome !== anchor.biome) continue;
        if (gen.structures.shouldPlaceTree(x, z, biome, h)) count += 1;
      }
    }
    return count;
  }

  const forestTrees = treeAnchorsAround(forestAnchor);
  const plainTrees = treeAnchorsAround(plainAnchor);
  check("forest patches produce many more tree anchors than open plains", forestTrees > Math.max(24, plainTrees * 3), `forest=${forestTrees} plains=${plainTrees} forestBiome=${forestAnchor?.biome} plainBiome=${plainAnchor?.biome}`);
  check("plains stay open instead of becoming a uniform tree carpet", plainTrees < 35, `plainTrees=${plainTrees}`);

  let riverCoherent = false;
  for (let z = -2048; z <= 2048 && !riverCoherent; z += 32) {
    for (let x = -2048; x <= 2048 && !riverCoherent; x += 32) {
      const h = gen.getHeight(x, z);
      const hydro = gen.macro.sample(x, z).hydrology;
      if (Math.max(hydro.river, hydro.stream) < 0.62) continue;
      let neighboringWatercourse = 0;
      for (const [dx, dz] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) {
        const nh = gen.getHeight(x + dx, z + dz);
        const n = gen.macro.sample(x + dx, z + dz).hydrology;
        if (Math.max(n.river, n.stream) > 0.24 || nh <= h + 2) neighboringWatercourse += 1;
      }
      riverCoherent = neighboringWatercourse >= 2;
    }
  }
  check("river/stream samples have neighboring continuity across chunks", riverCoherent);

  let sawSettlement = false;
  let sawBridgeableRoad = false;
  for (let z = -3072; z <= 3072; z += 32) {
    for (let x = -3072; x <= 3072; x += 32) {
      const h = gen.getHeight(x, z);
      const hydro = gen.macro.sample(x, z).hydrology;
      const biome = gen.biomes.sample(x, z, h, hydro).id;
      const settlement = gen.regions.settlementAt(x, z, h, biome, (wx, wz) => gen.getHeight(wx, wz));
      sawSettlement ||= !!settlement && settlement.radius > 48;
      const road = gen.regions.roadStrengthAt(x, z, h, biome, (wx, wz) => gen.getHeight(wx, wz));
      if (road > 0.78) {
        const bridge = gen.regions.sampleColumn(x, z, h, biome, (wx, wz) => gen.getHeight(wx, wz), 0.7);
        sawBridgeableRoad ||= bridge.blocks.some((b) => b.block === BlockId.OAK_SLAB || b.block === BlockId.WEATHERED_BEAM);
      }
    }
  }
  check("region planner can produce multi-chunk settlements", sawSettlement);
  check("road planner materializes bridge deck blocks when crossing water", sawBridgeableRoad);
}

// ============================================================================
console.log("\n[radar] history records real simulation snapshots for replay");
{
  const engine = new WeatherEngine();
  engine.setObserver(0, 0);
  // Intervalle court + petite grille pour un test rapide et déterministe.
  const history = new WeatherRadarHistory({
    recordIntervalSeconds: 2,
    retentionSeconds: 20,
    radius: 2048,
    cellSize: 512,
  });
  // Un orage proche fait évoluer le champ de précipitation dans le temps.
  engine.spawnStormCell(1400, 0, 0);

  check("history starts empty", !history.hasData(), `count=${history.count}`);

  // ~12 s de simulation avec captures régulières.
  for (let t = 0; t < 12; t += 0.5) {
    engine.update(0.5);
    history.update(engine, 0, 0);
  }
  check("history records multiple snapshots", history.count >= 3, `count=${history.count}`);
  check("recorded span is positive and bounded by retention", history.spanSeconds > 0 && history.spanSeconds <= 22, `span=${history.spanSeconds.toFixed(1)}`);
  check("oldest snapshot is in the past", history.oldestOffset(engine) < 0, `oldest=${history.oldestOffset(engine).toFixed(1)}`);

  // Échantillon historique au temps présent == champ réel (nœud de grille exact).
  const live = engine.sampleAt(0, 0);
  const replayedNow = history.sampleField(engine.state.time, 0, 0);
  check("history sample at grid node matches the recorded field", !!replayedNow && Math.abs(replayedNow.precipitation - live.precipitation) < 1e-3, `replay=${replayedNow?.precipitation.toFixed(3)} live=${live.precipitation.toFixed(3)}`);

  // Le champ a évolué : un instant passé diffère du présent (l'orage a grossi).
  const past = history.sampleField(engine.state.time - 8, 0, 0);
  check("a past field sample is available and finite", !!past && Number.isFinite(past.precipitation), `past=${past?.precipitation}`);

  // Requête plus ancienne que le plus ancien instantané → bornée (pas de null).
  const tooOld = history.sampleField(engine.state.time - 9999, 0, 0);
  check("queries older than history clamp to the oldest snapshot", !!tooOld, `tooOld=${tooOld?.precipitation}`);

  // Interpolation temporelle bornée entre deux instantanés.
  const newest = engine.state.time;
  const a = history.sampleField(newest - 4, 0, 0)!;
  const b = history.sampleField(newest - 2, 0, 0)!;
  const mid = history.sampleField(newest - 3, 0, 0)!;
  const lo = Math.min(a.precipitation, b.precipitation) - 1e-3;
  const hi = Math.max(a.precipitation, b.precipitation) + 1e-3;
  check("interpolated sample lies between bracketing snapshots", mid.precipitation >= lo && mid.precipitation <= hi, `mid=${mid.precipitation.toFixed(3)} lo=${lo.toFixed(3)} hi=${hi.toFixed(3)}`);

  // Éviction : après un long run, l'historique reste borné par la rétention.
  for (let t = 0; t < 40; t += 0.5) {
    engine.update(0.5);
    history.update(engine, 0, 0);
  }
  check("retention bounds the snapshot count (ring buffer)", history.spanSeconds <= 22, `span=${history.spanSeconds.toFixed(1)}`);
}

// ============================================================================
console.log("\n[radar] recorded lightning strikes replay at their own time");
{
  const engine = new WeatherEngine();
  engine.setObserver(0, 0);
  const history = new WeatherRadarHistory({ recordIntervalSeconds: 2, retentionSeconds: 30, radius: 1024, cellSize: 512 });
  engine.update(1);
  history.update(engine, 0, 0);
  const strikeTime = engine.state.time;
  history.recordStrike(120, -80, 0.9, strikeTime);
  // Avance jusqu'à la prochaine capture pour drainer l'éclair dans un instantané.
  for (let t = 0; t < 4; t += 0.5) {
    engine.update(0.5);
    history.update(engine, 0, 0);
  }
  const strikes = history.strikesAt(strikeTime);
  check("a recorded strike is retrievable near its timestamp", strikes.some((s) => s.x === 120 && s.z === -80), `count=${strikes.length}`);
  const far = history.strikesAt(strikeTime + 1000, 1);
  check("strikes far from the cursor time are not returned", far.length === 0, `far=${far.length}`);
}

// ============================================================================
console.log("\n[hydrology] rivers follow real terrain: downhill, accumulating, continuous");
{
  for (const seed of ["flow-seed-a", "flow-seed-b", "flow-seed-c"]) {
    const gen = new TerrainGenerator(seed);
    const flow = gen.macro.hydrology.rivers.flow;
    const R = 40;
    let downhillViolations = 0;
    let accumViolations = 0;
    let continuityViolations = 0;
    let streamNodes = 0;
    let riverNodes = 0;
    for (let j = -R; j <= R; j += 1) {
      for (let i = -R; i <= R; i += 1) {
        const h = flow.nodeHeight(i, j);
        const down = flow.downstream(i, j);
        const cat = flow.classify(flow.accumulation(i, j));
        if (cat === "stream") streamNodes += 1;
        if (cat === "river" || cat === "great_river") riverNodes += 1;
        if (down) {
          // Le terrain descend (ou franchit un seuil peu profond), jamais une côte.
          if (flow.nodeHeight(down.i, down.j) - h > flow.breachLimit) downhillViolations += 1;
          // L'accumulation ne décroît jamais vers l'aval.
          if (flow.accumulation(down.i, down.j) < flow.accumulation(i, j)) accumViolations += 1;
          // Un chenal de rivière reste un chenal en aval (continuité).
          if (cat === "river" || cat === "great_river") {
            const downCat = flow.classify(flow.accumulation(down.i, down.j));
            if (downCat === "dry" || downCat === "source") continuityViolations += 1;
          }
        }
      }
    }
    check(`[${seed}] river flow never goes uphill past the breach sill`, downhillViolations === 0, `violations=${downhillViolations}`);
    check(`[${seed}] flow accumulation never decreases downstream`, accumViolations === 0, `violations=${accumViolations}`);
    check(`[${seed}] river channels stay continuous downstream`, continuityViolations === 0, `violations=${continuityViolations}`);
    check(`[${seed}] streams form a real network (not barren)`, streamNodes > 120, `streams=${streamNodes} rivers=${riverNodes}`);
  }
}

// ============================================================================
console.log("\n[hydrology] traced channel widens downstream and starts higher than it ends");
{
  const gen = new TerrainGenerator("flow-trace-seed");
  const flow = gen.macro.hydrology.rivers.flow;
  // Trouve un nœud source/ruisseau, puis descend le chenal réel.
  let startI = 0;
  let startJ = 0;
  let found = false;
  for (let j = -40; j <= 40 && !found; j += 1) {
    for (let i = -40; i <= 40 && !found; i += 1) {
      const cat = flow.classify(flow.accumulation(i, j));
      if (cat === "stream" && flow.downstream(i, j)) {
        startI = i;
        startJ = j;
        found = true;
      }
    }
  }
  check("found a stream head to trace", found, `start=${startI},${startJ}`);

  let ci = startI;
  let cj = startJ;
  const startHeight = flow.nodeHeight(ci, cj);
  let startWidth = flow.widthFor(flow.accumulation(ci, cj));
  let endWidth = startWidth;
  let endHeight = startHeight;
  let widthDrops = 0;
  let maxCategoryRank = 0;
  const rank: Record<string, number> = { dry: 0, source: 1, stream: 2, river: 3, great_river: 4 };
  const seen = new Set<string>();
  for (let step = 0; step < 80; step += 1) {
    const key = `${ci},${cj}`;
    if (seen.has(key)) break; // garde-fou anti-cycle de débordement
    seen.add(key);
    const w = flow.widthFor(flow.accumulation(ci, cj));
    if (w < endWidth - 0.001) widthDrops += 1;
    endWidth = w;
    endHeight = flow.nodeHeight(ci, cj);
    maxCategoryRank = Math.max(maxCategoryRank, rank[flow.classify(flow.accumulation(ci, cj))]);
    const down = flow.downstream(ci, cj);
    if (!down) break;
    ci = down.i;
    cj = down.j;
  }
  check("channel width is non-decreasing downstream", widthDrops === 0, `drops=${widthDrops} start=${startWidth.toFixed(1)} end=${endWidth.toFixed(1)}`);
  check("channel grows wider from source to mouth", endWidth >= startWidth, `start=${startWidth.toFixed(1)} end=${endWidth.toFixed(1)}`);
  check("source sits at or above the mouth altitude", startHeight >= endHeight, `start=${startHeight} end=${endHeight}`);
  check("traced channel reaches at least a stream class", maxCategoryRank >= 2, `rank=${maxCategoryRank}`);
}

// ============================================================================
console.log("\n[hydrology] flow network is seed-deterministic and coupled to carved terrain");
{
  const a = new TerrainGenerator("flow-determinism");
  const b = new TerrainGenerator("flow-determinism");
  let sameFlow = true;
  let sameAccum = true;
  for (let j = -20; j <= 20; j += 1) {
    for (let i = -20; i <= 20; i += 1) {
      sameFlow &&= a.macro.hydrology.rivers.flow.flowDir(i, j) === b.macro.hydrology.rivers.flow.flowDir(i, j);
      sameAccum &&= a.macro.hydrology.rivers.flow.accumulation(i, j) === b.macro.hydrology.rivers.flow.accumulation(i, j);
    }
  }
  check("flow directions repeat exactly for the same seed", sameFlow);
  check("flow accumulation repeats exactly for the same seed", sameAccum);

  // Couplage au terrain : là où une rivière coule, le terrain est creusé et noyé.
  const gen = new TerrainGenerator("flow-couple");
  let carvedChannels = 0;
  let floodedChannels = 0;
  let channelSamples = 0;
  for (let z = -2400; z <= 2400 && channelSamples < 40; z += 24) {
    for (let x = -2400; x <= 2400 && channelSamples < 40; x += 24) {
      const rough = gen.macro.roughHeight(x, z);
      const macro = gen.macro.sample(x, z);
      if (macro.hydrology.river > 0.5) {
        channelSamples += 1;
        if (macro.altitude <= rough) carvedChannels += 1;
        if (macro.hydrology.waterLevel >= macro.altitude) floodedChannels += 1;
      }
    }
  }
  check("river columns were actually found in a broad scan", channelSamples > 5, `samples=${channelSamples}`);
  check("river beds are carved at or below the rough terrain", channelSamples > 0 && carvedChannels === channelSamples, `carved=${carvedChannels}/${channelSamples}`);
  check("river channels hold water at or above the bed", channelSamples > 0 && floodedChannels === channelSamples, `flooded=${floodedChannels}/${channelSamples}`);
}

// ============================================================================
console.log("\n[render] voxel lighting and water runtime state are deterministic");
{
  const registry = new BlockRegistry();
  const world = new World("render-lighting-test", registry);
  world.ensureChunk(0, 0);
  world.setBlock(0, 72, 0, BlockId.GLOWSTONE, false);
  world.setBlock(4, 72, 0, BlockId.SEA_LANTERN, false);

  const lighting = new LightingEngine(registry);
  const nearGlow = lighting.sampleLocalLight(world, 1, 72, 0, 8);
  const farGlow = lighting.sampleLocalLight(world, 12, 72, 0, 8);
  const cachedGlow = lighting.sampleLocalLight(world, 1, 72, 0, 8);
  check("local voxel light is produced near emissive blocks", nearGlow.intensity > 0.35 && nearGlow.sources >= 1, `intensity=${nearGlow.intensity.toFixed(2)} sources=${nearGlow.sources}`);
  check("local voxel light attenuates with distance", nearGlow.intensity > farGlow.intensity, `near=${nearGlow.intensity.toFixed(2)} far=${farGlow.intensity.toFixed(2)}`);
  check("light cache returns deterministic samples", JSON.stringify(nearGlow) === JSON.stringify(cachedGlow));

  const water = new WaterWaves();
  water.update(1, 12, 0, 0.82);
  const rainAfterStorm = water.uniforms.uWaterRain.value;
  const chopAfterWind = water.uniforms.uWaterChop.value;
  water.update(1, 0, 0, 0);
  check("water shader receives rain intensity smoothly", rainAfterStorm > 0.75, `rain=${rainAfterStorm.toFixed(2)}`);
  check("water shader increases chop under stronger wind", chopAfterWind > 0.1, `chop=${chopAfterWind.toFixed(3)}`);
  check("water shader keeps a normalized flow vector", Math.abs(water.uniforms.uWaterFlow.value.length() - 1) < 0.001);
}

// ============================================================================
console.log(`\n=== weather atlas tests: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
