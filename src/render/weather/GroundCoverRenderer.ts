/**
 * Rendu de l'accumulation au sol (neige / grêle / glace / sol mouillé).
 *
 * Pose un petit quad horizontal "décalque" sur le dessus des blocs des colonnes
 * proches qui ont de l'accumulation. Progressif (opacité/épaisseur selon la
 * profondeur) → pas de bloc blanc qui apparaît/disparaît d'un coup.
 *
 * LOD : seules les colonnes proches du joueur ET non vides sont rendues
 * (la SurfaceWeatherState ne contient déjà que les colonnes simulées).
 */

import * as THREE from "three";
import { SurfaceWeatherState, SurfaceColumn } from "../../weather/ground/SurfaceWeatherState";

const MAX_INSTANCES = 640;
const VIEW_RADIUS = 30; // blocs autour de la caméra
const REBUILD_INTERVAL = 0.5; // s

export class GroundCoverRenderer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aOpacity: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private timer = 0;
  private snowEnabled = true;

  private readonly mat = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly flat = new THREE.Quaternion();

  constructor(scene: THREE.Scene, private readonly state: SurfaceWeatherState) {
    const colors = new Float32Array(MAX_INSTANCES * 3);
    const opacities = new Float32Array(MAX_INSTANCES);
    this.aColor = new THREE.InstancedBufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aOpacity = new THREE.InstancedBufferAttribute(opacities, 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;

    const geometry = new THREE.PlaneGeometry(1.04, 1.04);
    geometry.rotateX(-Math.PI / 2);
    geometry.setAttribute("aColor", this.aColor);
    geometry.setAttribute("aOpacity", this.aOpacity);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms: { uMap: { value: this.createTexture() } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aOpacity;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          vUv = uv;
          vColor = aColor;
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          float a = texture2D(uMap, vUv).a * vOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_INSTANCES);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(dt: number, cameraPosition: THREE.Vector3): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REBUILD_INTERVAL;

    const cx = cameraPosition.x;
    const cz = cameraPosition.z;
    const r2 = VIEW_RADIUS * VIEW_RADIUS;
    let n = 0;

    this.state.forEach((col) => {
      if (n >= MAX_INSTANCES) return;
      const dx = col.x + 0.5 - cx;
      const dz = col.z + 0.5 - cz;
      if (dx * dx + dz * dz > r2) return;
      const layer = this.layerOf(col);
      if (!layer) return;

      this.scl.set(1, 1, 1);
      this.pos.set(col.x + 0.5, col.surfaceY + 1.012, col.z + 0.5);
      this.mat.compose(this.pos, this.flat, this.scl);
      this.mesh.setMatrixAt(n, this.mat);
      const base = n * 3;
      (this.aColor.array as Float32Array)[base] = layer.r;
      (this.aColor.array as Float32Array)[base + 1] = layer.g;
      (this.aColor.array as Float32Array)[base + 2] = layer.b;
      (this.aOpacity.array as Float32Array)[n] = layer.opacity;
      n += 1;
    });

    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aOpacity.needsUpdate = true;
  }

  setSnowEnabled(enabled: boolean): void {
    this.snowEnabled = enabled;
  }

  /** Choisit la couche dominante d'une colonne (neige > grêle > glace > mouillé). */
  private layerOf(col: SurfaceColumn): { r: number; g: number; b: number; opacity: number } | null {
    if (this.snowEnabled && col.snowDepth > 0.01) {
      return {
        r: 0.72,
        g: 0.76,
        b: 0.79,
        opacity: Math.min(0.82, 0.28 + col.snowDepth * 1.25),
      };
    }
    if (col.hailDepth > 0.01) {
      return { r: 0.68, g: 0.72, b: 0.75, opacity: Math.min(0.74, 0.25 + col.hailDepth * 1.05) };
    }
    if (col.iceDepth > 0.01) {
      return { r: 0.55, g: 0.68, b: 0.75, opacity: Math.min(0.42, col.iceDepth / 0.45) };
    }
    if (col.wetness > 0.12) {
      return { r: 0.08, g: 0.09, b: 0.11, opacity: Math.min(0.3, col.wetness * 0.3) };
    }
    return null;
  }

  private createTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    // Carré doux : plein au centre, bords légèrement adoucis (blend entre blocs).
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const edge = Math.min(x, y, size - 1 - x, size - 1 - y) / 5;
        const fade = Math.max(0, Math.min(1, edge));
        const grain = 0.62 + Math.random() * 0.38;
        const i = (x + y * size) * 4;
        image.data[i] = 226;
        image.data[i + 1] = 232;
        image.data[i + 2] = 235;
        image.data[i + 3] = Math.round(255 * fade * grain);
      }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    (this.material.uniforms.uMap.value as THREE.Texture).dispose();
    this.mesh.dispose();
  }
}
