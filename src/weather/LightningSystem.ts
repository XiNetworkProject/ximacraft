/**
 * Logique des éclairs (sans rendu) — avec ZONES DE CHARGE localisées.
 *
 * Un orage ne déclenche PAS des éclairs partout dans tout son volume à la même
 * frame. Chaque cellule orageuse possède 1 à 3 {@link LightningChargeZone}
 * actives qui dérivent doucement avec le nuage. Une zone se charge dans le temps
 * puis décharge UN éclair localisé (intra-nuage, nuage-nuage, nuage-sol ou noyé
 * dans le rideau de pluie), avec un temps de recharge. Le tonnerre suit avec un
 * délai/volume fonction de la distance.
 *
 * Types (cf. cahier des charges) :
 *  - INTRA_CLOUD     : flash dans le nuage (le plus fréquent, visible de loin) ;
 *  - CLOUD_TO_CLOUD  : éclair entre zones nuageuses ;
 *  - CLOUD_TO_GROUND : trait jusqu'au sol, flash global plus fort ;
 *  - EMBEDDED_IN_RAIN: lueur diffuse noyée dans le rideau de pluie ;
 *  - DISTANT         : flash à l'horizon, tonnerre faible/très retardé ou absent.
 */

import * as THREE from "three";
import { WeatherEvent } from "./events/WeatherEvent";
import { LightningChargeZone } from "./scene/WeatherScene";

export enum LightningType {
  INTRA_CLOUD = "INTRA_CLOUD",
  CLOUD_TO_CLOUD = "CLOUD_TO_CLOUD",
  CLOUD_TO_GROUND = "CLOUD_TO_GROUND",
  EMBEDDED_IN_RAIN = "EMBEDDED_IN_RAIN",
  DISTANT = "DISTANT",
}

export interface LightningStrike {
  eventId: number;
  type: LightningType;
  x: number;
  z: number;
  cloudBaseY: number;
  cloudTopY: number;
  cloudRadius: number;
  /** Force du flash 0..1. */
  intensity: number;
  /** Distance à l'observateur (blocs). */
  distance: number;
  /** Masquage par la pluie 0..1 (1 = très diffus). */
  embedded: number;
  seed: number;
  /** Position de la décharge relativement au centre de l'événement. */
  localOffset: THREE.Vector3;
  flashRadius: number;
  startTime: number;
  duration: number;
  branchCount: number;
}

/** État interne d'une zone : offset relatif au centre de l'événement. */
interface ChargeZoneRuntime extends LightningChargeZone {
  offsetX: number;
  offsetZ: number;
  /** Hauteur (au-dessus de la base) de la zone. */
  localY: number;
}

/** Vitesse du son en blocs/seconde (réglée pour le ressenti de jeu). */
const SOUND_SPEED = 180;
const MAX_AUDIBLE = 5000;

export class LightningSystem {
  private time = 0;
  /** Zones de charge actives par événement. */
  private readonly zones = new Map<number, ChargeZoneRuntime[]>();
  /** Tonnerre : (delaiSecondes, puissance0..1). Branché sur le SoundManager. */
  onThunder: ((delaySeconds: number, power: number) => void) | null = null;

  /**
   * Avance la simulation et renvoie les éclairs déclenchés pendant ce pas.
   */
  update(dt: number, events: readonly WeatherEvent[], ox: number, oz: number): LightningStrike[] {
    this.time += dt;
    const strikes: LightningStrike[] = [];
    const live = new Set<number>();

    for (const event of events) {
      if (!event.producesLightning) continue;
      live.add(event.id);
      const zones = this.ensureZones(event);

      for (const zone of zones) {
        zone.cooldown = Math.max(0, zone.cooldown - dt);
        // Charge ∝ intensité (proxy de thunderRisk), répartie sur les zones.
        const rate = event.intensity * (event.precip === "snow" ? 0.16 : 0.26);
        zone.charge += rate * dt;
        if (zone.charge >= 1 && zone.cooldown <= 0) {
          zone.charge = 0;
          zone.cooldown = 0.6 + Math.random() * 1.8;
          const strike = this.makeStrike(event, zone, ox, oz);
          strikes.push(strike);
          this.scheduleThunder(strike);
        }
      }
    }

    // Purge des zones d'événements disparus.
    for (const id of [...this.zones.keys()]) if (!live.has(id)) this.zones.delete(id);

    return strikes;
  }

  /** Zones de charge actives (debug). */
  getChargeZones(): LightningChargeZone[] {
    const all: LightningChargeZone[] = [];
    for (const zones of this.zones.values()) all.push(...zones);
    return all;
  }

  debugSummary(ox: number, oz: number): string {
    let zoneCount = 0;
    let cells = 0;
    for (const zones of this.zones.values()) {
      cells += 1;
      zoneCount += zones.length;
    }
    if (cells === 0) return "Lightning: no active charge zones.";
    let nearest = Number.POSITIVE_INFINITY;
    for (const zones of this.zones.values()) {
      for (const z of zones) nearest = Math.min(nearest, Math.hypot(z.x - ox, z.z - oz));
    }
    return `Lightning: ${cells} active cell(s), ${zoneCount} charge zones, nearest=${Math.round(nearest)} blk.`;
  }

  reset(): void {
    this.zones.clear();
    this.time = 0;
  }

  /** Crée/positionne 1..3 zones par cellule orageuse et les fait dériver. */
  private ensureZones(event: WeatherEvent): ChargeZoneRuntime[] {
    let zones = this.zones.get(event.id);
    const cloudTopY = event.cloudBaseY + Math.max(4500, Math.min(12000, event.radius * 5));
    if (!zones) {
      const count = Math.max(1, Math.min(3, 1 + Math.floor(event.intensity * 2.2)));
      zones = [];
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const spread = event.radius * (0.15 + Math.random() * 0.35);
        const type = i === 0 && event.intensity > 0.8
          ? "CLOUD_TO_GROUND"
          : event.precip !== "none" && Math.random() < 0.4
            ? "EMBEDDED_RAIN"
            : Math.random() < 0.3 ? "CLOUD_TO_CLOUD" : "INTRA_CLOUD";
        zones.push({
          id: `lz-${event.id}-${i}`,
          x: event.x,
          z: event.z,
          y: THREE.MathUtils.lerp(event.cloudBaseY, cloudTopY, 0.3 + Math.random() * 0.5),
          radius: event.radius * (0.18 + Math.random() * 0.18),
          charge: Math.random() * 0.5,
          type,
          cooldown: Math.random() * 1.5,
          offsetX: Math.cos(angle) * spread,
          offsetZ: Math.sin(angle) * spread,
          localY: THREE.MathUtils.lerp(event.cloudBaseY, cloudTopY, 0.3 + Math.random() * 0.5),
        });
      }
      this.zones.set(event.id, zones);
    }
    // Les zones suivent le nuage (qui dérive avec le vent).
    for (const zone of zones) {
      zone.x = event.x + zone.offsetX;
      zone.z = event.z + zone.offsetZ;
    }
    return zones;
  }

  private makeStrike(event: WeatherEvent, zone: ChargeZoneRuntime, ox: number, oz: number): LightningStrike {
    const x = zone.x;
    const z = zone.z;
    const distance = Math.hypot(x - ox, z - oz);
    const cloudRadius = Math.max(3000, Math.min(10000, event.radius * 4.2));
    const cloudTopY = event.cloudBaseY + Math.max(4500, Math.min(12000, event.radius * 5));

    // Le type vient de la zone ; on rétrograde vers DISTANT si très loin.
    let type: LightningType;
    let embedded = 0;
    switch (zone.type) {
      case "CLOUD_TO_GROUND":
        type = distance < 2200 ? LightningType.CLOUD_TO_GROUND : LightningType.INTRA_CLOUD;
        break;
      case "EMBEDDED_RAIN":
        type = LightningType.EMBEDDED_IN_RAIN;
        embedded = 0.5 + Math.random() * 0.4;
        break;
      case "CLOUD_TO_CLOUD":
        type = LightningType.CLOUD_TO_CLOUD;
        break;
      default:
        type = distance > 9000 ? LightningType.DISTANT : LightningType.INTRA_CLOUD;
    }

    const intensity = (type === LightningType.CLOUD_TO_GROUND ? 1 : 0.6 + Math.random() * 0.3) * event.intensity;
    const localY = type === LightningType.CLOUD_TO_GROUND ? event.cloudBaseY + 80 : zone.localY;
    const flashRadius = THREE.MathUtils.clamp(
      zone.radius * (type === LightningType.INTRA_CLOUD ? 2 : type === LightningType.EMBEDDED_IN_RAIN ? 2.4 : 1.6),
      480,
      2600,
    );
    const duration = type === LightningType.EMBEDDED_IN_RAIN ? 0.32 + Math.random() * 0.24 : 0.12 + Math.random() * 0.2;
    const branchCount = type === LightningType.CLOUD_TO_GROUND
      ? 4 + Math.floor(Math.random() * 4)
      : type === LightningType.CLOUD_TO_CLOUD
        ? 2 + Math.floor(Math.random() * 4)
        : 0;
    return {
      eventId: event.id,
      type,
      x,
      z,
      cloudBaseY: event.cloudBaseY,
      cloudTopY,
      cloudRadius,
      intensity,
      distance,
      embedded,
      seed: Math.floor(Math.random() * 0x7fffffff),
      localOffset: new THREE.Vector3(zone.offsetX, localY - event.cloudBaseY, zone.offsetZ),
      flashRadius,
      startTime: this.time,
      duration,
      branchCount,
    };
  }

  private scheduleThunder(strike: LightningStrike): void {
    if (!this.onThunder || strike.distance > MAX_AUDIBLE) return;
    // Très loin : flash souvent silencieux.
    if (strike.type === LightningType.DISTANT && Math.random() < 0.5) return;
    const delay = strike.distance / SOUND_SPEED;
    const power = Math.max(0, strike.intensity * (1 - strike.distance / MAX_AUDIBLE));
    this.onThunder(delay, power);
  }
}
