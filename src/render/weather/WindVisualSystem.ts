import * as THREE from "three";
import { WeatherSample } from "../../weather/WeatherTypes";

const COUNT = 180;
const AREA = 88;

export class WindVisualSystem {
  private readonly points: THREE.Points;
  private readonly positions = new Float32Array(COUNT * 3);
  private readonly seeds = new Float32Array(COUNT);

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < COUNT; i += 1) {
      const base = i * 3;
      this.positions[base] = (Math.random() - 0.5) * AREA;
      this.positions[base + 1] = Math.random() * 34 - 8;
      this.positions[base + 2] = (Math.random() - 0.5) * AREA;
      this.seeds[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xd8ecff,
      size: 0.055,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setEnabled(enabled: boolean): void {
    this.points.visible = enabled && (this.points.material as THREE.PointsMaterial).opacity > 0.01;
  }

  update(delta: number, sample: WeatherSample, cameraPosition: THREE.Vector3): void {
    const material = this.points.material as THREE.PointsMaterial;
    const activity = Math.min(1, sample.windSpeed / 18 + sample.precipitation * 0.35 + sample.thunderRisk * 0.35);
    material.opacity = activity * 0.34;
    material.size = 0.045 + activity * 0.06;
    this.points.visible = material.opacity > 0.01;
    if (!this.points.visible) return;

    this.points.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    const windLength = Math.max(0.001, Math.hypot(sample.windX, sample.windZ));
    const wx = sample.windX / windLength;
    const wz = sample.windZ / windLength;
    const time = performance.now() * 0.001;

    for (let i = 0; i < COUNT; i += 1) {
      const base = i * 3;
      const seed = this.seeds[i];
      const gust = 4 + sample.windSpeed * 1.4 + Math.sin(time * 1.8 + seed) * 2.2;
      this.positions[base] += wx * gust * delta + Math.sin(time + seed) * delta * 0.7;
      this.positions[base + 1] += Math.sin(time * 0.7 + seed) * delta * 0.28;
      this.positions[base + 2] += wz * gust * delta + Math.cos(time * 0.9 + seed) * delta * 0.7;
      if (Math.abs(this.positions[base]) > AREA * 0.55 || Math.abs(this.positions[base + 2]) > AREA * 0.55) {
        this.positions[base] = -wx * AREA * 0.5 + (Math.random() - 0.5) * 16;
        this.positions[base + 1] = Math.random() * 34 - 8;
        this.positions[base + 2] = -wz * AREA * 0.5 + (Math.random() - 0.5) * 16;
      }
      if (this.positions[base + 1] > 28) this.positions[base + 1] = -8;
      if (this.positions[base + 1] < -10) this.positions[base + 1] = 27;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
