import * as THREE from "three";
import { SEA_LEVEL } from "../../utils/Constants";
import { EnvironmentDirector } from "../../environment/EnvironmentDirector";
import { FogBankRenderSample } from "../../environment/FogBankSystem";

type Quality = "low" | "balanced" | "high";

export class FogBankRenderer {
  private readonly group = new THREE.Group();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  private readonly pool: THREE.Mesh[] = [];
  private readonly texture: THREE.CanvasTexture;

  constructor(private readonly scene: THREE.Scene) {
    this.texture = new THREE.CanvasTexture(createFogTexture());
    this.texture.needsUpdate = true;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: 0xdce5ec,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.group.name = "FogBankRenderer";
    this.scene.add(this.group);
  }

  update(delta: number, director: EnvironmentDirector, camera: THREE.Vector3, quality: Quality): void {
    const max = quality === "high" ? 14 : quality === "balanced" ? 9 : 5;
    const samples = director.fogRenderSamples(camera.x, camera.z, quality === "high" ? 2400 : 1600).slice(0, max);
    this.ensurePool(samples.length);
    for (let i = 0; i < this.pool.length; i += 1) {
      const mesh = this.pool[i];
      const sample = samples[i];
      if (!sample) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      this.placeMesh(mesh, sample, i, delta, camera);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  private ensurePool(count: number): void {
    while (this.pool.length < count) {
      const mesh = new THREE.Mesh(this.geometry, this.material.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = -10;
      mesh.frustumCulled = false;
      this.pool.push(mesh);
      this.group.add(mesh);
    }
  }

  private placeMesh(mesh: THREE.Mesh, sample: FogBankRenderSample, index: number, delta: number, camera: THREE.Vector3): void {
    const material = mesh.material as THREE.MeshBasicMaterial;
    const pulse = 0.92 + Math.sin(perfTime() * 0.00035 + index * 1.7) * 0.08;
    const radius = sample.radius * (sample.kind === "valley" ? 1.35 : sample.kind === "river" ? 1.12 : 1) * pulse;
    mesh.position.set(sample.x, Math.max(SEA_LEVEL + 1.5, Math.min(camera.y - 5, SEA_LEVEL + 18)), sample.z);
    mesh.scale.set(radius * 2.2, radius * 1.15, 1);
    mesh.rotation.z += delta * 0.012 * (index % 2 === 0 ? 1 : -1);
    material.opacity = Math.min(0.56, sample.density * 0.68);
    material.color.setHex(sample.kind === "freezing" ? 0xe8f2ff : sample.kind === "river" ? 0xd8e4ea : 0xd6dce1);
  }
}

function createFogTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.72)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.34)");
  gradient.addColorStop(0.82, "rgba(255,255,255,0.10)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 42; i += 1) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const r = 8 + Math.random() * 24;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.13)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return canvas;
}

function perfTime(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
