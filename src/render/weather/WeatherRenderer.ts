/**
 * Rendu météo TEMPORAIRE (v0.1).
 *
 * But : VÉRIFIER que le moteur fonctionne, pas faire du beau. Il échantillonne
 * la météo à la position de la caméra et applique trois effets simples :
 *   - teinte du ciel selon la couverture nuageuse (bleu ↔ gris) ;
 *   - brouillard qui se resserre quand c'est nuageux/pluvieux ;
 *   - pluie en particules basiques quand precipitation > 0.5.
 *
 * ⚠️ Ce renderer pilote scene.background et scene.fog. Le projet a déjà
 * SkySystem/WeatherSystem qui font de même : n'activez qu'UN seul des deux à la
 * fois (voir setEnabled + la doc d'intégration). La logique météo, elle, reste
 * 100 % dans src/weather — ici on ne fait que LIRE des échantillons.
 *
 * v0.2 : éclatera en SkyRenderer / CloudRenderer / RainRenderer / FogRenderer /
 * LightningRenderer / WindParticleRenderer (cf. structure de fichiers).
 */

import * as THREE from "three";
import { WeatherEngine } from "../../weather/WeatherEngine";
import { WeatherSample } from "../../weather/WeatherTypes";

const RAIN_COUNT = 1200;
const RAIN_BOX = 60; // demi-taille de la boîte de pluie autour de la caméra
const CLEAR_SKY = new THREE.Color(0x8ec5ff);
const OVERCAST_SKY = new THREE.Color(0x6b7785);

export class WeatherRenderer {
  enabled = false;

  private readonly rain: THREE.Points;
  private readonly rainPositions: Float32Array;
  private readonly rainSpeeds: Float32Array;
  private readonly skyColor = new THREE.Color();
  /** Dernier échantillon lu (exposé pour un overlay de debug éventuel). */
  lastSample: WeatherSample | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly engine: WeatherEngine,
  ) {
    this.rainPositions = new Float32Array(RAIN_COUNT * 3);
    this.rainSpeeds = new Float32Array(RAIN_COUNT);
    for (let i = 0; i < RAIN_COUNT; i += 1) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * RAIN_BOX * 2;
      this.rainPositions[i * 3 + 1] = Math.random() * RAIN_BOX * 2;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX * 2;
      this.rainSpeeds[i] = 28 + Math.random() * 24;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xa9c9e9,
      size: 0.12,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rain = new THREE.Points(geometry, material);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.rain.visible = enabled;
    if (!enabled) (this.rain.material as THREE.PointsMaterial).opacity = 0;
  }

  /** À appeler chaque frame APRÈS engine.update(). */
  update(dt: number): void {
    if (!this.enabled) return;
    const cam = this.camera.position;
    const sample = this.engine.sampleAt(cam.x, cam.z);
    this.lastSample = sample;

    this.updateSky(sample);
    this.updateRain(dt, sample, cam);
  }

  private updateSky(sample: WeatherSample): void {
    // Ciel : bleu clair → gris selon la couverture nuageuse.
    this.skyColor.copy(CLEAR_SKY).lerp(OVERCAST_SKY, sample.cloudCover);
    this.scene.background = this.skyColor;

    // Brouillard : plus dense si nuageux ou pluvieux.
    const murk = Math.max(sample.cloudCover * 0.6, sample.precipitation);
    const near = 70 - murk * 45; // 70 → 25
    const far = 260 - murk * 150; // 260 → 110
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.skyColor);
      this.scene.fog.near = near;
      this.scene.fog.far = far;
    } else {
      this.scene.fog = new THREE.Fog(this.skyColor.getHex(), near, far);
    }
  }

  private updateRain(dt: number, sample: WeatherSample, cam: THREE.Vector3): void {
    const material = this.rain.material as THREE.PointsMaterial;
    // Pluie seulement au-delà de 0.5 (la "pluie simple" demandée en v0.1).
    const wet = Math.max(0, sample.precipitation - 0.5) / 0.5; // 0..1
    material.opacity = wet * 0.6;
    this.rain.visible = wet > 0.01;
    if (!this.rain.visible) return;

    this.rain.position.set(cam.x, cam.y - RAIN_BOX, cam.z);
    const windLean = sample.windX * dt;
    for (let i = 0; i < RAIN_COUNT; i += 1) {
      const base = i * 3;
      this.rainPositions[base] += windLean;
      this.rainPositions[base + 1] -= this.rainSpeeds[i] * dt;
      if (this.rainPositions[base + 1] < 0) {
        this.rainPositions[base] = (Math.random() - 0.5) * RAIN_BOX * 2;
        this.rainPositions[base + 1] = RAIN_BOX * 2;
        this.rainPositions[base + 2] = (Math.random() - 0.5) * RAIN_BOX * 2;
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.rain);
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
  }
}
