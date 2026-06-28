import * as THREE from "three";
import { WeatherSample } from "../../weather/WeatherTypes";
import { BlockId } from "../../world/BlockTypes";
import { World } from "../../world/World";

const LEAF_COUNT = 90;
const MOTE_COUNT = 130;
const DUST_COUNT = 110;
const WATER_COUNT = 90;
const AREA = 72;

export class AmbientLifeSystem {
  private readonly leaves: THREE.Points;
  private readonly leafPositions = new Float32Array(LEAF_COUNT * 3);
  private readonly leafSeeds = new Float32Array(LEAF_COUNT);
  private readonly motes: THREE.Points;
  private readonly motePositions = new Float32Array(MOTE_COUNT * 3);
  private readonly moteSeeds = new Float32Array(MOTE_COUNT);
  private readonly dust: THREE.Points;
  private readonly dustPositions = new Float32Array(DUST_COUNT * 3);
  private readonly dustSeeds = new Float32Array(DUST_COUNT);
  private readonly water: THREE.Points;
  private readonly waterPositions = new Float32Array(WATER_COUNT * 3);
  private readonly waterVelocities = new Float32Array(WATER_COUNT * 3);
  private readonly waterLife = new Float32Array(WATER_COUNT);
  private waterCursor = 0;
  private wasInWater = false;

  constructor(private readonly scene: THREE.Scene) {
    this.seed(this.leafPositions, this.leafSeeds, 2, 18);
    this.seed(this.motePositions, this.moteSeeds, 0.5, 12);
    this.seed(this.dustPositions, this.dustSeeds, -1, 7);
    this.hideWater();

    const leafGeometry = new THREE.BufferGeometry();
    leafGeometry.setAttribute("position", new THREE.BufferAttribute(this.leafPositions, 3));
    const leafMaterial = new THREE.PointsMaterial({
      color: 0x7ba349,
      size: 0.13,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.leaves = new THREE.Points(leafGeometry, leafMaterial);
    this.leaves.frustumCulled = false;

    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute("position", new THREE.BufferAttribute(this.motePositions, 3));
    const moteMaterial = new THREE.PointsMaterial({
      color: 0xf3d46a,
      size: 0.045,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.motes = new THREE.Points(moteGeometry, moteMaterial);
    this.motes.frustumCulled = false;

    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(this.dustPositions, 3));
    const dustMaterial = new THREE.PointsMaterial({
      color: 0xc7aa78,
      size: 0.075,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.dust = new THREE.Points(dustGeometry, dustMaterial);
    this.dust.frustumCulled = false;

    const waterGeometry = new THREE.BufferGeometry();
    waterGeometry.setAttribute("position", new THREE.BufferAttribute(this.waterPositions, 3));
    const waterMaterial = new THREE.PointsMaterial({
      color: 0x9ce7ff,
      size: 0.075,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.water = new THREE.Points(waterGeometry, waterMaterial);
    this.water.frustumCulled = false;

    scene.add(this.leaves, this.motes, this.dust, this.water);
  }

  update(
    delta: number,
    sample: WeatherSample,
    cameraPosition: THREE.Vector3,
    world: World,
    dayFactor: number,
    playerPosition: THREE.Vector3,
    playerVelocity: THREE.Vector3,
  ): void {
    const biome = world.getBiomeAt(cameraPosition.x, cameraPosition.z).id;
    const forest = biome === "forest";
    const green = biome === "plains" || biome === "hills";
    const cold = biome === "snow" || sample.temperature < 2;
    const dryEnough = sample.precipitation < 0.12;
    const sandy = biome === "beach" || biome === "desert";
    const leafActivity = dryEnough && !cold ? (forest ? 0.5 : green ? 0.2 : 0.05) + Math.min(0.28, sample.windSpeed * 0.012) : 0;
    const moteActivity = dryEnough && !cold && dayFactor > 0.35 && sample.windSpeed < 14 ? (forest ? 0.36 : green ? 0.28 : 0.08) : 0;
    const dustActivity = dryEnough && !cold ? (sandy ? 0.34 : sample.windSpeed > 11 ? 0.12 : 0) : 0;

    this.updateLeaves(delta, sample, cameraPosition, leafActivity);
    this.updateMotes(delta, sample, cameraPosition, moteActivity);
    this.updateDust(delta, sample, cameraPosition, dustActivity);
    this.updateWater(delta, world, playerPosition, playerVelocity);
  }

  dispose(): void {
    this.scene.remove(this.leaves, this.motes, this.dust, this.water);
    this.leaves.geometry.dispose();
    (this.leaves.material as THREE.Material).dispose();
    this.motes.geometry.dispose();
    (this.motes.material as THREE.Material).dispose();
    this.dust.geometry.dispose();
    (this.dust.material as THREE.Material).dispose();
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
  }

  private updateLeaves(delta: number, sample: WeatherSample, cameraPosition: THREE.Vector3, activity: number): void {
    const material = this.leaves.material as THREE.PointsMaterial;
    material.opacity = THREE.MathUtils.lerp(material.opacity, activity * 0.42, Math.min(1, delta * 1.8));
    material.size = 0.11 + activity * 0.08;
    this.leaves.visible = material.opacity > 0.01;
    if (!this.leaves.visible) return;

    this.leaves.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    const speed = Math.max(0.001, Math.hypot(sample.windX, sample.windZ));
    const wx = sample.windX / speed;
    const wz = sample.windZ / speed;
    const time = performance.now() * 0.001;
    for (let i = 0; i < LEAF_COUNT; i += 1) {
      const base = i * 3;
      const seed = this.leafSeeds[i];
      this.leafPositions[base] += (wx * (1.4 + sample.windSpeed * 0.32) + Math.sin(time * 1.7 + seed) * 0.45) * delta;
      this.leafPositions[base + 1] -= (0.18 + seed * 0.18) * delta;
      this.leafPositions[base + 2] += (wz * (1.4 + sample.windSpeed * 0.32) + Math.cos(time * 1.3 + seed) * 0.45) * delta;
      this.wrap(this.leafPositions, base, -wx, -wz, 2, 18);
    }
    this.leaves.geometry.attributes.position.needsUpdate = true;
  }

  private updateMotes(delta: number, sample: WeatherSample, cameraPosition: THREE.Vector3, activity: number): void {
    const material = this.motes.material as THREE.PointsMaterial;
    material.opacity = THREE.MathUtils.lerp(material.opacity, activity * 0.5, Math.min(1, delta * 2.4));
    this.motes.visible = material.opacity > 0.01;
    if (!this.motes.visible) return;

    this.motes.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    const time = performance.now() * 0.001;
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      const base = i * 3;
      const seed = this.moteSeeds[i];
      this.motePositions[base] += (Math.sin(time * 2.5 + seed * 7) * 0.42 + sample.windX * 0.035) * delta;
      this.motePositions[base + 1] += Math.sin(time * 3.1 + seed * 13) * 0.16 * delta;
      this.motePositions[base + 2] += (Math.cos(time * 2.2 + seed * 9) * 0.42 + sample.windZ * 0.035) * delta;
      this.wrap(this.motePositions, base, 0, 0, 0.5, 12);
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
  }

  private updateDust(delta: number, sample: WeatherSample, cameraPosition: THREE.Vector3, activity: number): void {
    const material = this.dust.material as THREE.PointsMaterial;
    material.opacity = THREE.MathUtils.lerp(material.opacity, activity * 0.38, Math.min(1, delta * 2));
    this.dust.visible = material.opacity > 0.01;
    if (!this.dust.visible) return;

    this.dust.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    const speed = Math.max(0.001, Math.hypot(sample.windX, sample.windZ));
    const wx = sample.windX / speed;
    const wz = sample.windZ / speed;
    const time = performance.now() * 0.001;
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const base = i * 3;
      const seed = this.dustSeeds[i];
      this.dustPositions[base] += (wx * (2.2 + sample.windSpeed * 0.5) + Math.sin(time + seed * 9) * 0.55) * delta;
      this.dustPositions[base + 1] += Math.sin(time * 1.6 + seed * 5) * 0.18 * delta;
      this.dustPositions[base + 2] += (wz * (2.2 + sample.windSpeed * 0.5) + Math.cos(time + seed * 7) * 0.55) * delta;
      this.wrap(this.dustPositions, base, -wx, -wz, -1, 7);
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  private updateWater(delta: number, world: World, playerPosition: THREE.Vector3, playerVelocity: THREE.Vector3): void {
    const inWater =
      world.getBlock(playerPosition.x, playerPosition.y + 0.45, playerPosition.z) === BlockId.WATER ||
      world.getBlock(playerPosition.x, playerPosition.y + 1.25, playerPosition.z) === BlockId.WATER;
    const speed = playerVelocity.length();
    if (inWater && (!this.wasInWater || speed > 3.1)) {
      this.spawnWater(playerPosition, Math.min(20, this.wasInWater ? 5 + Math.floor(speed * 2) : 18), playerVelocity);
    }
    this.wasInWater = inWater;

    let alive = 0;
    for (let i = 0; i < WATER_COUNT; i += 1) {
      if (this.waterLife[i] <= 0) continue;
      this.waterLife[i] = Math.max(0, this.waterLife[i] - delta);
      const base = i * 3;
      this.waterVelocities[base + 1] -= 5.4 * delta;
      this.waterPositions[base] += this.waterVelocities[base] * delta;
      this.waterPositions[base + 1] += this.waterVelocities[base + 1] * delta;
      this.waterPositions[base + 2] += this.waterVelocities[base + 2] * delta;
      alive += 1;
    }
    const material = this.water.material as THREE.PointsMaterial;
    material.opacity = Math.min(0.58, alive / WATER_COUNT);
    this.water.visible = alive > 0;
    if (alive > 0) this.water.geometry.attributes.position.needsUpdate = true;
  }

  private spawnWater(position: THREE.Vector3, count: number, velocity: THREE.Vector3): void {
    for (let n = 0; n < count; n += 1) {
      const i = this.waterCursor++ % WATER_COUNT;
      const base = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const spread = 0.25 + Math.random() * 0.55;
      this.waterPositions[base] = position.x + Math.cos(angle) * 0.32;
      this.waterPositions[base + 1] = position.y + 1.1 + Math.random() * 0.5;
      this.waterPositions[base + 2] = position.z + Math.sin(angle) * 0.32;
      this.waterVelocities[base] = Math.cos(angle) * spread + velocity.x * 0.08;
      this.waterVelocities[base + 1] = 1.2 + Math.random() * 2.4 + Math.max(0, velocity.y) * 0.1;
      this.waterVelocities[base + 2] = Math.sin(angle) * spread + velocity.z * 0.08;
      this.waterLife[i] = 0.45 + Math.random() * 0.55;
    }
  }

  private seed(positions: Float32Array, seeds: Float32Array, minY: number, maxY: number): void {
    for (let i = 0; i < seeds.length; i += 1) {
      const base = i * 3;
      positions[base] = (Math.random() - 0.5) * AREA;
      positions[base + 1] = minY + Math.random() * (maxY - minY);
      positions[base + 2] = (Math.random() - 0.5) * AREA;
      seeds[i] = Math.random();
    }
  }

  private hideWater(): void {
    for (let i = 0; i < WATER_COUNT; i += 1) {
      const base = i * 3;
      this.waterPositions[base] = 0;
      this.waterPositions[base + 1] = -999;
      this.waterPositions[base + 2] = 0;
      this.waterLife[i] = 0;
    }
  }

  private wrap(positions: Float32Array, base: number, upwindX: number, upwindZ: number, minY: number, maxY: number): void {
    if (Math.abs(positions[base]) > AREA * 0.55 || Math.abs(positions[base + 2]) > AREA * 0.55 || positions[base + 1] < minY) {
      positions[base] = upwindX * AREA * 0.45 + (Math.random() - 0.5) * 18;
      positions[base + 1] = minY + Math.random() * (maxY - minY);
      positions[base + 2] = upwindZ * AREA * 0.45 + (Math.random() - 0.5) * 18;
    }
    if (positions[base + 1] > maxY) positions[base + 1] = minY;
  }
}
