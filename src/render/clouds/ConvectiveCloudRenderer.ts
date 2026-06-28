import * as THREE from "three";
import { ConvectiveCloudSystem } from "../../clouds/ConvectiveCloudSystem";
import { CloudPuff } from "../../clouds/CloudPuff";
import { createCloudPuffMaterial } from "./CloudPuffMaterial";

const MAX_PUFF_INSTANCES = 2200;

/**
 * Rendu des nuages convectifs : UN InstancedMesh de quads "splat" (billboards),
 * un par puff de toutes les masses.
 *
 *  - Les puffs sont TRIÉS de l'arrière vers l'avant chaque frame → le mélange
 *    des transparences est correct (plus de cercles sombres qui passent devant).
 *  - Le shader reconstruit une normale de sphère + bord doux → ils fusionnent.
 *
 * Aucun sprite-texture, aucune image : la forme émerge des puffs simulés.
 */
export class ConvectiveCloudRenderer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aAlpha: THREE.InstancedBufferAttribute;

  private readonly mat = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly tmp = new THREE.Color();
  private readonly dark = new THREE.Color(0.2, 0.22, 0.28);

  /** Liste de puffs réutilisée pour le tri (zéro alloc par frame). */
  private readonly puffList: CloudPuff[] = [];

  constructor(scene: THREE.Scene, private readonly system: ConvectiveCloudSystem) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const colors = new Float32Array(MAX_PUFF_INSTANCES * 3);
    const alphas = new Float32Array(MAX_PUFF_INSTANCES);
    this.aColor = new THREE.InstancedBufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aAlpha = new THREE.InstancedBufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    geometry.setAttribute("aColor", this.aColor);
    geometry.setAttribute("aAlpha", this.aAlpha);

    this.material = createCloudPuffMaterial();
    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_PUFF_INSTANCES);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** À appeler chaque frame, après ConvectiveCloudSystem.update(). */
  update(dayFactor: number, sunDirection: THREE.Vector3, camera: THREE.Camera): void {
    const day = Math.max(0, Math.min(1, dayFactor));
    const u = this.material.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(sunDirection).normalize();
    u.uSun.value = 0.35 + 0.5 * day;
    u.uAmbient.value = 0.3 + 0.4 * day;

    // Base caméra (pour orienter les billboards + reconstruire la normale).
    const e = camera.matrixWorld.elements;
    (u.uCamRight.value as THREE.Vector3).set(e[0], e[1], e[2]);
    (u.uCamUp.value as THREE.Vector3).set(e[4], e[5], e[6]);
    (u.uCamForward.value as THREE.Vector3).set(-e[8], -e[9], -e[10]);
    const cx = e[12];
    const cy = e[13];
    const cz = e[14];

    // 1) Collecte des puffs visibles + distance² à la caméra.
    this.puffList.length = 0;
    for (const mass of this.system.masses) {
      for (const p of mass.puffs) {
        if (p.density < 0.02) continue;
        if (this.puffList.length >= MAX_PUFF_INSTANCES) break;
        p.sortDist = (p.position.x - cx) ** 2 + (p.position.y - cy) ** 2 + (p.position.z - cz) ** 2;
        this.puffList.push(p);
      }
      if (this.puffList.length >= MAX_PUFF_INSTANCES) break;
    }

    // 2) Tri arrière → avant (les plus loin d'abord) pour un blending correct.
    this.puffList.sort((a, b) => b.sortDist - a.sortDist);

    // 3) Écriture des instances.
    const colorArr = this.aColor.array as Float32Array;
    const alphaArr = this.aAlpha.array as Float32Array;
    for (let n = 0; n < this.puffList.length; n += 1) {
      const p = this.puffList[n];
      this.pos.copy(p.position);
      const d = p.radius * 2.4; // diamètre du quad (le bord doux réduit le rayon visible)
      this.scl.set(d, d * p.flatten, 1);
      this.mat.compose(this.pos, this.quat, this.scl);
      this.mesh.setMatrixAt(n, this.mat);

      const lvl = p.brightness;
      this.tmp.setRGB(lvl, lvl, lvl * 1.02);
      this.tmp.lerp(this.dark, Math.min(1, p.darkness));
      const base = n * 3;
      colorArr[base] = this.tmp.r;
      colorArr[base + 1] = this.tmp.g;
      colorArr[base + 2] = this.tmp.b;
      alphaArr[n] = Math.min(0.85, p.density);
    }

    this.mesh.count = this.puffList.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
