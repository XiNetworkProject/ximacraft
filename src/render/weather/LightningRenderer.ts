/**
 * Rendu des éclairs.
 *
 * - Flash global directionnel : une PointLight placée du côté de l'orage qui
 *   illumine brièvement l'environnement (visible même de jour sous un ciel
 *   sombre, plus marqué la nuit).
 * - Trait ramifié pour les coups CLOUD_TO_GROUND proches.
 * - Les éclairs EMBEDDED_IN_RAIN ne montrent qu'une lueur diffuse (pas de trait
 *   net), et les DISTANT ne sont qu'un flash à l'horizon.
 *
 * Consomme les {@link LightningStrike} produits par {@link LightningSystem}.
 */

import * as THREE from "three";
import { LightningStrike, LightningType } from "../../weather/LightningSystem";

const BOLT_TRUNK_SEGMENTS = 26;
const MAX_BOLT_SEGMENTS = 64;
const CLOUD_SEGMENTS = 48;
const BOLT_DECAY = 7;
const GROUND_Y = 64;
const MAX_LOCAL_FLASHES = 4;

interface LocalFlashSlot {
  light: THREE.PointLight;
  life: number;
  duration: number;
  peak: number;
}

export class LightningRenderer {
  private readonly flashes: LocalFlashSlot[] = [];
  private readonly bolt: THREE.LineSegments;
  private readonly cloudBolt: THREE.LineSegments;
  private flash = 0;
  private boltLife = 0;
  private cloudBoltLife = 0;

  constructor(private readonly scene: THREE.Scene) {
    for (let index = 0; index < MAX_LOCAL_FLASHES; index += 1) {
      const light = new THREE.PointLight(0xbfd4ff, 0, 1000, 1.65);
      light.visible = false;
      scene.add(light);
      this.flashes.push({ light, life: 0, duration: 0.2, peak: 0 });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BOLT_SEGMENTS * 2 * 3), 3));
    const material = new THREE.LineBasicMaterial({ color: 0xeaf2ff, transparent: true, opacity: 0, depthWrite: false });
    this.bolt = new THREE.LineSegments(geometry, material);
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    scene.add(this.bolt);

    const cloudGeometry = new THREE.BufferGeometry();
    cloudGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(CLOUD_SEGMENTS * 2 * 3), 3));
    const cloudMaterial = new THREE.LineBasicMaterial({
      color: 0xdce8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.cloudBolt = new THREE.LineSegments(cloudGeometry, cloudMaterial);
    this.cloudBolt.frustumCulled = false;
    this.cloudBolt.visible = false;
    this.cloudBolt.renderOrder = 5;
    scene.add(this.cloudBolt);
  }

  /** Enregistre un éclair (appelé pour chaque strike du LightningSystem). */
  addStrike(strike: LightningStrike, cameraPosition: THREE.Vector3): void {
    // Le rideau de pluie masque partiellement le flash (embedded).
    const masked = 1 - strike.embedded * 0.6;
    const typeScale = strike.type === LightningType.DISTANT ? 0.5 : strike.type === LightningType.CLOUD_TO_GROUND ? 1.1 : 0.8;
    const peak = strike.intensity * masked * typeScale;
    const slot = this.flashes.reduce((oldest, candidate) => candidate.life < oldest.life ? candidate : oldest);
    slot.life = strike.duration;
    slot.duration = strike.duration;
    slot.peak = peak;
    slot.light.position.set(strike.x, strike.cloudBaseY + strike.localOffset.y, strike.z);
    slot.light.distance = strike.flashRadius * 2.4;
    slot.light.visible = true;

    // Trait au sol seulement si proche et pas trop noyé.
    const showBolt = strike.type === LightningType.CLOUD_TO_GROUND && strike.distance < 700 && strike.embedded < 0.4;
    if (showBolt) this.buildBolt(strike);
    const showCloudBolt = (strike.type === LightningType.INTRA_CLOUD || strike.type === LightningType.CLOUD_TO_CLOUD)
      && strike.distance < 24000;
    if (showCloudBolt) this.buildCloudBolt(strike);
  }

  /** À appeler chaque frame. */
  update(dt: number, cameraPosition: THREE.Vector3): void {
    this.flash = 0;
    this.boltLife = Math.max(0, this.boltLife - dt * BOLT_DECAY);
    this.cloudBoltLife = Math.max(0, this.cloudBoltLife - dt * 10);
    for (const slot of this.flashes) {
      slot.life = Math.max(0, slot.life - dt);
      if (slot.life <= 0) {
        slot.light.intensity = 0;
        slot.light.visible = false;
        continue;
      }
      const normalizedLife = slot.life / Math.max(0.001, slot.duration);
      const pulse = Math.pow(normalizedLife, 0.55) * (0.78 + Math.sin(normalizedLife * 26) * 0.22);
      slot.light.intensity = slot.peak * pulse * 9;
      const distance = slot.light.position.distanceTo(cameraPosition);
      const apparent = Math.max(0, 1 - distance / Math.max(1, slot.light.distance));
      this.flash = Math.max(this.flash, slot.peak * pulse * apparent);
    }

    const material = this.bolt.material as THREE.LineBasicMaterial;
    material.opacity = this.boltLife;
    this.bolt.visible = this.boltLife > 0.01;
    const cloudMaterial = this.cloudBolt.material as THREE.LineBasicMaterial;
    cloudMaterial.opacity = this.cloudBoltLife;
    this.cloudBolt.visible = this.cloudBoltLife > 0.01;
  }

  /** Valeur de flash 0..1 (pour un éventuel WeatherLightController/ciel). */
  get flashAmount(): number {
    return this.flash;
  }

  private buildBolt(strike: LightningStrike): void {
    const positions = this.bolt.geometry.attributes.position.array as Float32Array;
    const random = seededRandom(strike.seed);
    const topY = strike.cloudBaseY + 25;
    let x = strike.x;
    let z = strike.z;
    let y = topY;
    let cursor = 0;
    for (let i = 0; i < BOLT_TRUNK_SEGMENTS; i += 1) {
      const t = i / BOLT_TRUNK_SEGMENTS;
      const nextY = topY + (GROUND_Y - topY) * ((i + 1) / BOLT_TRUNK_SEGMENTS);
      const jitter = (1 - t) * 6 + 1.5;
      const nx = strike.x + (random() - 0.5) * jitter;
      const nz = strike.z + (random() - 0.5) * jitter;
      positions[cursor++] = x;
      positions[cursor++] = y;
      positions[cursor++] = z;
      positions[cursor++] = nx;
      positions[cursor++] = nextY;
      positions[cursor++] = nz;
      x = nx;
      z = nz;
      y = nextY;
    }
    const branchSegments = 3;
    for (let branch = 0; branch < strike.branchCount && cursor + branchSegments * 6 <= positions.length; branch += 1) {
      const along = 0.2 + random() * 0.58;
      let branchX = strike.x + (random() - 0.5) * 5;
      let branchY = THREE.MathUtils.lerp(topY, GROUND_Y, along);
      let branchZ = strike.z + (random() - 0.5) * 5;
      const angle = random() * Math.PI * 2;
      for (let segment = 0; segment < branchSegments; segment += 1) {
        const length = 7 + random() * 7;
        const nx = branchX + Math.cos(angle) * length + (random() - 0.5) * 4;
        const ny = branchY - 3 - random() * 7;
        const nz = branchZ + Math.sin(angle) * length + (random() - 0.5) * 4;
        positions[cursor++] = branchX;
        positions[cursor++] = branchY;
        positions[cursor++] = branchZ;
        positions[cursor++] = nx;
        positions[cursor++] = ny;
        positions[cursor++] = nz;
        branchX = nx;
        branchY = ny;
        branchZ = nz;
      }
    }
    this.bolt.geometry.attributes.position.needsUpdate = true;
    this.bolt.geometry.setDrawRange(0, cursor / 3);
    this.boltLife = 1;
  }

  private buildCloudBolt(strike: LightningStrike): void {
    const positions = this.cloudBolt.geometry.attributes.position.array as Float32Array;
    const random = seededRandom(strike.seed);
    const angle = random() * Math.PI * 2;
    const horizontalLength = strike.cloudRadius * (0.55 + random() * 0.45);
    const stepLength = horizontalLength / CLOUD_SEGMENTS;
    const midY = THREE.MathUtils.lerp(strike.cloudBaseY, strike.cloudTopY, 0.38 + random() * 0.38);
    let x = strike.x - Math.cos(angle) * horizontalLength * 0.35;
    let y = midY;
    let z = strike.z - Math.sin(angle) * horizontalLength * 0.35;
    let cursor = 0;
    for (let i = 0; i < CLOUD_SEGMENTS; i += 1) {
      const branch = Math.sin(i * 1.73) * stepLength * 0.55;
      const nx = x + Math.cos(angle) * stepLength - Math.sin(angle) * branch + (random() - 0.5) * stepLength;
      const nz = z + Math.sin(angle) * stepLength + Math.cos(angle) * branch + (random() - 0.5) * stepLength;
      const ny = THREE.MathUtils.clamp(
        y + (random() - 0.5) * stepLength * 0.75,
        strike.cloudBaseY + 180,
        strike.cloudTopY - 180,
      );
      positions[cursor++] = x;
      positions[cursor++] = y;
      positions[cursor++] = z;
      positions[cursor++] = nx;
      positions[cursor++] = ny;
      positions[cursor++] = nz;
      x = nx;
      y = ny;
      z = nz;
    }
    this.cloudBolt.geometry.attributes.position.needsUpdate = true;
    this.cloudBoltLife = 1;
  }

  dispose(): void {
    for (const slot of this.flashes) this.scene.remove(slot.light);
    this.scene.remove(this.bolt);
    this.scene.remove(this.cloudBolt);
    this.bolt.geometry.dispose();
    (this.bolt.material as THREE.Material).dispose();
    this.cloudBolt.geometry.dispose();
    (this.cloudBolt.material as THREE.Material).dispose();
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
