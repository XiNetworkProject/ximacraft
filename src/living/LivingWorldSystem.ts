import * as THREE from "three";
import { clamp, hashString, makeRng } from "../utils/MathUtils";
import { WORLD_DAY_TICKS } from "../utils/Constants";
import { WeatherSample, WeatherType } from "../weather/WeatherTypes";
import { World } from "../world/World";
import { BlockId } from "../world/BlockTypes";
import { SeasonState } from "./SeasonSystem";
import { LivingWorldDebugState, WildlifeMode, WildlifeSpecies } from "./LivingWorldTypes";
import { EntityAnimationController } from "./EntityAnimationController";
import { EntityAssetManager } from "./EntityAssetManager";

type Quality = "low" | "balanced" | "high";

interface SpeciesConfig {
  max: number;
  cellSize: number;
  range: number;
  speed: number;
  scale: THREE.Vector3;
  altitude: "ground" | "air" | "water" | "canopy";
}

interface Animal {
  key: string;
  species: WildlifeSpecies;
  slot: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  phase: number;
  age: number;
  visible: number;
  mode: WildlifeMode;
  homeX: number;
  homeZ: number;
  hidden: boolean;
}

const SPECIES: Record<WildlifeSpecies, SpeciesConfig> = {
  bird: { max: 42, cellSize: 42, range: 150, speed: 6.5, scale: new THREE.Vector3(0.42, 0.16, 0.24), altitude: "air" },
  butterfly: { max: 48, cellSize: 20, range: 70, speed: 1.8, scale: new THREE.Vector3(0.22, 0.05, 0.16), altitude: "air" },
  dragonfly: { max: 32, cellSize: 24, range: 90, speed: 3.3, scale: new THREE.Vector3(0.34, 0.035, 0.08), altitude: "air" },
  firefly: { max: 42, cellSize: 22, range: 82, speed: 1.2, scale: new THREE.Vector3(0.08, 0.08, 0.08), altitude: "air" },
  rabbit: { max: 24, cellSize: 32, range: 94, speed: 3.6, scale: new THREE.Vector3(0.35, 0.28, 0.48), altitude: "ground" },
  deer: { max: 8, cellSize: 78, range: 155, speed: 5.2, scale: new THREE.Vector3(0.58, 1.1, 1), altitude: "ground" },
  fish: { max: 56, cellSize: 24, range: 110, speed: 2.1, scale: new THREE.Vector3(0.32, 0.13, 0.62), altitude: "water" },
  frog: { max: 18, cellSize: 28, range: 74, speed: 2.2, scale: new THREE.Vector3(0.28, 0.18, 0.32), altitude: "ground" },
  bat: { max: 28, cellSize: 34, range: 105, speed: 4.4, scale: new THREE.Vector3(0.34, 0.1, 0.2), altitude: "canopy" },
};

export class LivingWorldSystem {
  private readonly meshes = new Map<WildlifeSpecies, THREE.InstancedMesh>();
  private readonly assets = new EntityAssetManager();
  private readonly animation = new EntityAnimationController();
  private readonly animals = new Map<string, Animal>();
  private readonly dummy = new THREE.Object3D();
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private seed = 1;
  private enabled = true;
  private forceTimer = 0;
  private forcedSpecies: WildlifeSpecies | null = null;
  private scanTimer = 0;
  private debugState: LivingWorldDebugState = {
    enabled: true,
    activeAnimals: 0,
    visibleAnimals: 0,
    species: emptyCounts(),
    ambience: "quiet",
  };

  constructor(private readonly scene: THREE.Scene) {
    for (const species of Object.keys(SPECIES) as WildlifeSpecies[]) {
      const config = SPECIES[species];
      const asset = this.assets.assetFor(species);
      const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, config.max);
      mesh.frustumCulled = false;
      mesh.castShadow = species !== "fish" && species !== "firefly";
      mesh.receiveShadow = false;
      for (let i = 0; i < config.max; i += 1) mesh.setMatrixAt(i, this.hiddenMatrix);
      mesh.instanceMatrix.needsUpdate = true;
      this.meshes.set(species, mesh);
      this.scene.add(mesh);
    }
  }

  setSeed(seed: string): void {
    this.seed = hashString(seed) || 1;
    this.clear();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hideAll();
  }

  force(species: WildlifeSpecies | "all", seconds = 45): void {
    this.forceTimer = seconds;
    this.forcedSpecies = species === "all" ? null : species;
  }

  update(
    delta: number,
    world: World,
    player: THREE.Vector3,
    sample: WeatherSample,
    ticks: number,
    season: SeasonState,
    quality: Quality,
  ): void {
    this.forceTimer = Math.max(0, this.forceTimer - delta);
    if (!this.enabled) {
      this.hideAll();
      this.debugState = { ...this.debugState, enabled: false, activeAnimals: 0, visibleAnimals: 0, species: emptyCounts() };
      return;
    }

    this.scanTimer -= delta;
    if (this.scanTimer <= 0) {
      this.scanTimer = quality === "high" ? 0.55 : quality === "balanced" ? 0.85 : 1.4;
      this.scanForAnimals(world, player, sample, ticks, season, quality);
    }

    const counts = emptyCounts();
    let visibleTotal = 0;
    for (const animal of this.animals.values()) {
      this.updateAnimal(animal, delta, world, player, sample, ticks, season);
      if (animal.visible > 0.02) {
        counts[animal.species] += 1;
        visibleTotal += 1;
      }
    }
    for (const species of Object.keys(SPECIES) as WildlifeSpecies[]) {
      const mesh = this.meshes.get(species)!;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.debugState = {
      enabled: true,
      activeAnimals: this.animals.size,
      visibleAnimals: visibleTotal,
      species: counts,
      ambience: this.describeAmbience(sample, ticks, season),
    };
  }

  debug(): LivingWorldDebugState {
    return {
      enabled: this.debugState.enabled,
      activeAnimals: this.debugState.activeAnimals,
      visibleAnimals: this.debugState.visibleAnimals,
      species: { ...this.debugState.species },
      ambience: this.debugState.ambience,
    };
  }

  debugText(): string {
    const state = this.debug();
    const species = (Object.keys(state.species) as WildlifeSpecies[])
      .filter((key) => state.species[key] > 0)
      .map((key) => `${key}=${state.species[key]}`)
      .join(" ");
    return `LivingWorld enabled=${state.enabled} active=${state.activeAnimals} visible=${state.visibleAnimals} ${species || "no visible animals"} ambience=${state.ambience} models=${this.assets.debugProfile()}`;
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh);
    }
    this.meshes.clear();
    this.assets.dispose();
    this.animals.clear();
  }

  clear(): void {
    this.animals.clear();
    this.hideAll();
  }

  private scanForAnimals(world: World, player: THREE.Vector3, sample: WeatherSample, ticks: number, season: SeasonState, quality: Quality): void {
    const wanted = new Set<string>();
    for (const species of Object.keys(SPECIES) as WildlifeSpecies[]) {
      if (this.forcedSpecies && species !== this.forcedSpecies && this.forceTimer > 0) continue;
      const config = SPECIES[species];
      const range = config.range * (quality === "high" ? 1.18 : quality === "low" ? 0.7 : 1);
      const cell = config.cellSize;
      const minX = Math.floor((player.x - range) / cell);
      const maxX = Math.floor((player.x + range) / cell);
      const minZ = Math.floor((player.z - range) / cell);
      const maxZ = Math.floor((player.z + range) / cell);
      for (let cz = minZ; cz <= maxZ; cz += 1) {
        for (let cx = minX; cx <= maxX; cx += 1) {
          const key = `${species}:${cx},${cz}`;
          const rng = this.cellRng(species, cx, cz);
          if (rng() > this.presenceChance(species, world, cx, cz, cell, sample, ticks, season)) continue;
          const x = cx * cell + rng() * cell;
          const z = cz * cell + rng() * cell;
          if (Math.hypot(x - player.x, z - player.z) > range || Math.hypot(x - player.x, z - player.z) < 10) continue;
          const y = this.spawnY(species, world, x, z, rng);
          if (y === null) continue;
          wanted.add(key);
          if (!this.animals.has(key)) this.spawnAnimal(key, species, x, y, z, rng);
        }
      }
    }

    for (const [key, animal] of this.animals) {
      if (!wanted.has(key) && Math.hypot(animal.position.x - player.x, animal.position.z - player.z) > SPECIES[animal.species].range * 1.35) {
        animal.hidden = true;
      }
    }
  }

  private spawnAnimal(key: string, species: WildlifeSpecies, x: number, y: number, z: number, rng: () => number): void {
    const slot = this.findFreeSlot(species);
    if (slot < 0) return;
    const animal: Animal = {
      key,
      species,
      slot,
      position: new THREE.Vector3(x, y, z),
      velocity: new THREE.Vector3((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4),
      target: new THREE.Vector3(x + (rng() - 0.5) * 12, y, z + (rng() - 0.5) * 12),
      phase: rng() * Math.PI * 2,
      age: 0,
      visible: 0,
      mode: SPECIES[species].altitude === "water" ? "swim" : SPECIES[species].altitude === "ground" ? "wander" : "fly",
      homeX: x,
      homeZ: z,
      hidden: false,
    };
    this.animals.set(key, animal);
  }

  private updateAnimal(animal: Animal, delta: number, world: World, player: THREE.Vector3, sample: WeatherSample, ticks: number, season: SeasonState): void {
    const config = SPECIES[animal.species];
    const distance = animal.position.distanceTo(player);
    const badWeather = sample.precipitation > 0.34 || sample.weatherType === WeatherType.THUNDERSTORM || sample.windSpeed > 18;
    const blizzard = sample.weatherType === WeatherType.SNOW && sample.windSpeed > 14;
    animal.age += delta;
    animal.hidden = animal.hidden || blizzard || (badWeather && animal.species !== "fish" && animal.species !== "frog" && animal.species !== "bat");
    if (this.forceTimer > 0 && (!this.forcedSpecies || this.forcedSpecies === animal.species)) animal.hidden = false;
    animal.visible = clamp(animal.visible + delta * (animal.hidden ? -1.35 : 0.62), 0, 1);
    if (animal.visible <= 0 && animal.hidden) {
      this.hideInstance(animal);
      this.animals.delete(animal.key);
      return;
    }

    const detailed = distance < 58;
    if (detailed && (animal.species === "rabbit" || animal.species === "deer" || animal.species === "frog") && distance < (animal.species === "deer" ? 24 : 13)) {
      animal.mode = "flee";
      const away = animal.position.clone().sub(player).setY(0).normalize();
      animal.velocity.x += away.x * config.speed * delta * 3.2;
      animal.velocity.z += away.z * config.speed * delta * 3.2;
    } else if (animal.mode === "flee" && distance > 30) {
      animal.mode = config.altitude === "water" ? "swim" : config.altitude === "ground" ? "wander" : "fly";
    }

    if (detailed && animal.position.distanceTo(animal.target) < 2.5) {
      const rng = this.cellRng(animal.species, Math.floor(animal.homeX), Math.floor(animal.homeZ + animal.age * 0.05));
      animal.target.set(animal.homeX + (rng() - 0.5) * 22, animal.position.y, animal.homeZ + (rng() - 0.5) * 22);
    }

    const toTarget = animal.target.clone().sub(animal.position).setY(0);
    if (toTarget.lengthSq() > 0.01 && animal.mode !== "flee") {
      toTarget.normalize();
      const activity = this.activityFor(animal.species, ticks, season, sample);
      animal.velocity.x += toTarget.x * config.speed * activity * delta * 0.65;
      animal.velocity.z += toTarget.z * config.speed * activity * delta * 0.65;
    }

    const maxSpeed = config.speed * (animal.mode === "flee" ? 1.65 : 1);
    const horizontal = Math.hypot(animal.velocity.x, animal.velocity.z);
    if (horizontal > maxSpeed) {
      animal.velocity.x = (animal.velocity.x / horizontal) * maxSpeed;
      animal.velocity.z = (animal.velocity.z / horizontal) * maxSpeed;
    }
    animal.velocity.multiplyScalar(Math.exp(-delta * (animal.mode === "flee" ? 0.8 : 1.5)));
    animal.position.x += animal.velocity.x * delta;
    animal.position.z += animal.velocity.z * delta;

    const surfaceY = world.getSurfaceHeight(animal.position.x, animal.position.z) + 1.02;
    if (config.altitude === "water") {
      animal.position.y = this.waterY(world, animal.position.x, animal.position.z) ?? THREE.MathUtils.lerp(animal.position.y, surfaceY - 0.6, 0.03);
      animal.position.y += Math.sin(animal.age * 2.6 + animal.phase) * 0.025;
    } else if (config.altitude === "ground") {
      animal.position.y = THREE.MathUtils.lerp(animal.position.y, surfaceY + (animal.species === "frog" ? 0.05 : 0.12), 0.22);
      if (animal.species === "frog") animal.position.y += Math.max(0, Math.sin(animal.age * 5 + animal.phase)) * 0.16;
    } else {
      const lift = config.altitude === "canopy" ? 7.5 : animal.species === "bird" ? 16 : animal.species === "firefly" ? 1.8 : 2.4;
      animal.position.y = THREE.MathUtils.lerp(animal.position.y, surfaceY + lift + Math.sin(animal.age * (animal.species === "bird" ? 0.9 : 2.2) + animal.phase) * 1.4, 0.055);
    }

    this.writeInstance(animal);
  }

  private writeInstance(animal: Animal): void {
    const config = SPECIES[animal.species];
    const heading = Math.atan2(animal.velocity.x, animal.velocity.z);
    const pose = this.animation.pose({
      species: animal.species,
      mode: animal.mode,
      age: animal.age,
      phase: animal.phase,
      visible: animal.visible,
      heading,
      baseScale: config.scale,
    });
    this.dummy.position.copy(animal.position);
    this.dummy.position.y += pose.bob;
    this.dummy.rotation.copy(pose.rotation);
    this.dummy.scale.copy(pose.scale);
    this.dummy.updateMatrix();
    this.meshes.get(animal.species)!.setMatrixAt(animal.slot, this.dummy.matrix);
  }

  private hideInstance(animal: Animal): void {
    this.meshes.get(animal.species)!.setMatrixAt(animal.slot, this.hiddenMatrix);
  }

  private hideAll(): void {
    for (const species of Object.keys(SPECIES) as WildlifeSpecies[]) {
      const mesh = this.meshes.get(species)!;
      for (let i = 0; i < SPECIES[species].max; i += 1) mesh.setMatrixAt(i, this.hiddenMatrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private findFreeSlot(species: WildlifeSpecies): number {
    const used = new Set<number>();
    for (const animal of this.animals.values()) if (animal.species === species) used.add(animal.slot);
    for (let i = 0; i < SPECIES[species].max; i += 1) if (!used.has(i)) return i;
    return -1;
  }

  private presenceChance(
    species: WildlifeSpecies,
    world: World,
    cx: number,
    cz: number,
    cell: number,
    sample: WeatherSample,
    ticks: number,
    season: SeasonState,
  ): number {
    if (this.forceTimer > 0 && (!this.forcedSpecies || this.forcedSpecies === species)) return 0.82;
    const x = cx * cell + cell * 0.5;
    const z = cz * cell + cell * 0.5;
    const biome = world.getBiomeAt(x, z).id;
    const time = timeOfDay(ticks);
    const dawnDusk = 1 - Math.min(1, Math.abs(time - 0.25) * 5, Math.abs(time - 0.75) * 5);
    const night = time < 0.2 || time > 0.8;
    const rainSuppression = sample.weatherType === WeatherType.THUNDERSTORM ? 0.1 : sample.precipitation > 0.35 ? 0.34 : 1;
    const windSuppression = sample.windSpeed > 20 ? 0.26 : sample.windSpeed > 13 ? 0.62 : 1;
    const insect = species === "butterfly" || species === "dragonfly" || species === "firefly";
    const baseSeason = insect ? season.insectActivity : season.wildlife;
    let chance = 0;
    switch (species) {
      case "bird":
        chance = (biome === "forest" ? 0.52 : biome === "plains" || biome === "hills" ? 0.38 : biome === "beach" ? 0.28 : 0.12) * (night ? 0.18 : 1);
        break;
      case "butterfly":
        chance = (biome === "plains" || biome === "forest" || biome === "hills" ? 0.44 : 0.04) * (night ? 0.02 : 1);
        break;
      case "dragonfly":
        chance = this.hasWaterNear(world, x, z) ? 0.48 : 0.03;
        break;
      case "firefly":
        chance = (biome === "forest" || this.hasWaterNear(world, x, z) ? 0.52 : 0.08) * (night ? 1 : dawnDusk * 0.34);
        break;
      case "rabbit":
        chance = biome === "plains" || biome === "hills" ? 0.3 + dawnDusk * 0.18 : biome === "forest" ? 0.12 : 0.03;
        break;
      case "deer":
        chance = biome === "forest" || biome === "plains" || biome === "hills" ? 0.085 + dawnDusk * 0.06 : 0.01;
        break;
      case "fish":
        chance = this.hasWaterNear(world, x, z) ? 0.7 : 0;
        break;
      case "frog":
        chance = this.hasWaterNear(world, x, z) && sample.temperature > 4 ? 0.22 + (night ? 0.16 : 0) : 0;
        break;
      case "bat":
        chance = night ? (biome === "mountains" || biome === "forest" || biome === "hills" ? 0.36 : 0.12) : 0.01;
        break;
    }
    if (sample.weatherType === WeatherType.SNOW && sample.windSpeed > 12) chance *= 0.05;
    return clamp(chance * baseSeason * rainSuppression * windSuppression, 0, 0.95);
  }

  private spawnY(species: WildlifeSpecies, world: World, x: number, z: number, rng: () => number): number | null {
    const config = SPECIES[species];
    if (config.altitude === "water") return this.waterY(world, x, z);
    const surface = world.getSurfaceHeight(x, z) + 1.08;
    if (world.getBlock(Math.floor(x), Math.floor(surface), Math.floor(z)) === BlockId.WATER) return null;
    if (config.altitude === "ground") return surface + 0.1;
    if (config.altitude === "canopy") return surface + 5 + rng() * 8;
    return surface + 2 + rng() * 18;
  }

  private waterY(world: World, x: number, z: number): number | null {
    const sx = Math.floor(x);
    const sz = Math.floor(z);
    const surface = world.getSurfaceHeight(x, z);
    for (let y = surface + 4; y >= Math.max(1, surface - 8); y -= 1) {
      if (world.getBlock(sx, y, sz) === BlockId.WATER) return y + 0.35;
    }
    return null;
  }

  private hasWaterNear(world: World, x: number, z: number): boolean {
    for (const [ox, oz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 0], [-8, 0], [0, 8], [0, -8]]) {
      const y = world.getSurfaceHeight(x + ox, z + oz);
      if (world.getBlock(Math.floor(x + ox), y, Math.floor(z + oz)) === BlockId.WATER || world.getBlock(Math.floor(x + ox), y + 1, Math.floor(z + oz)) === BlockId.WATER) return true;
    }
    return false;
  }

  private activityFor(species: WildlifeSpecies, ticks: number, season: SeasonState, sample: WeatherSample): number {
    const time = timeOfDay(ticks);
    const night = time < 0.2 || time > 0.8;
    const dawnDusk = Math.max(0, 1 - Math.min(Math.abs(time - 0.25), Math.abs(time - 0.75)) * 5);
    let activity = species === "bat" || species === "firefly" ? (night ? 1 : 0.25) : 0.55 + dawnDusk * 0.45;
    if (species === "fish") activity = 0.75;
    if (species === "frog") activity = sample.precipitation > 0.08 || night ? 0.9 : 0.46;
    if (species === "butterfly" || species === "dragonfly") activity *= season.insectActivity;
    if (sample.weatherType === WeatherType.THUNDERSTORM || sample.windSpeed > 18) activity *= 0.2;
    return clamp(activity, 0.05, 1);
  }

  private describeAmbience(sample: WeatherSample, ticks: number, season: SeasonState): string {
    const time = timeOfDay(ticks);
    if (sample.weatherType === WeatherType.THUNDERSTORM) return "wildlife hiding under storm";
    if (sample.weatherType === WeatherType.SNOW && sample.windSpeed > 12) return "muted winter whiteout";
    if (time < 0.18 || time > 0.82) return season.season === "summer" ? "warm night insects" : "quiet night";
    if (time > 0.21 && time < 0.32) return "morning chorus";
    if (time > 0.68 && time < 0.8) return "evening activity";
    return season.season === "winter" ? "sparse winter life" : "daytime wildlife";
  }

  private cellRng(species: WildlifeSpecies, cx: number, cz: number): () => number {
    return makeRng((this.seed ^ hashString(species) ^ Math.imul(cx, 374761393) ^ Math.imul(cz, 668265263)) >>> 0);
  }
}

function emptyCounts(): Record<WildlifeSpecies, number> {
  return { bird: 0, butterfly: 0, dragonfly: 0, firefly: 0, rabbit: 0, deer: 0, fish: 0, frog: 0, bat: 0 };
}

function timeOfDay(ticks: number): number {
  return ((ticks % WORLD_DAY_TICKS) + WORLD_DAY_TICKS) % WORLD_DAY_TICKS / WORLD_DAY_TICKS;
}
