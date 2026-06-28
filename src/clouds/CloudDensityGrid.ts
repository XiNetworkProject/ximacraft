import * as THREE from "three";
import { CloudMass } from "./CloudMass";

/**
 * Champ de densité volumétrique d'un nuage.
 *
 * Les puffs (invisibles) sont "splattés" dans une grille 3D de densité par
 * gaussiennes anisotropes : les sphères individuelles fusionnent en un volume
 * continu. La grille est empaquetée dans une texture 2D en ATLAS de tranches Z
 * (robuste WebGL1/2, pas de sampler3D), échantillonnée par le raymarcher.
 *
 * On ne dessine JAMAIS les puffs : ils ne servent qu'à remplir cette grille.
 */
const RES = 48; // résolution de la grille par axe (index space)
const TILES = 7; // tuiles par côté de l'atlas (TILES² >= RES)
const ATLAS = RES * TILES; // 336 px

export class CloudDensityGrid {
  readonly texture: THREE.DataTexture;
  /** Coin min monde et taille monde de la box (pour le raymarcher). */
  readonly boundsMin = new THREE.Vector3();
  readonly boundsSize = new THREE.Vector3(1, 1, 1);
  readonly center = new THREE.Vector3();

  static readonly RESOLUTION = RES;
  static readonly TILES = TILES;
  static readonly ATLAS_SIZE = ATLAS;

  private readonly accum = new Float32Array(RES * RES * RES);
  private readonly pixels = new Uint8Array(ATLAS * ATLAS);

  constructor() {
    this.texture = new THREE.DataTexture(this.pixels, ATLAS, ATLAS, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** Re-calcule la densité depuis les puffs de la masse. Renvoie false si vide. */
  bake(mass: CloudMass): boolean {
    const puffs = mass.puffs;
    if (puffs.length === 0) return false;

    // The simulated mass owns the atmospheric dimensions. The density atlas
    // and raymarch box consume this exact same world-space box.
    this.boundsMin.copy(mass.volumeBoundsMin);
    this.boundsSize.set(
      Math.max(1, mass.volumeBoundsSize.x),
      Math.max(1, mass.volumeBoundsSize.y),
      Math.max(1, mass.volumeBoundsSize.z),
    );
    this.center.copy(this.boundsMin).addScaledVector(this.boundsSize, 0.5);
    const minX = this.boundsMin.x;
    const minY = this.boundsMin.y;
    const minZ = this.boundsMin.z;

    // 2) Splat gaussien anisotrope de chaque puff dans la grille.
    this.accum.fill(0);
    const sx = (RES - 1) / this.boundsSize.x;
    const sy = (RES - 1) / this.boundsSize.y;
    const sz = (RES - 1) / this.boundsSize.z;
    for (const p of puffs) {
      const cgx = (p.position.x - minX) * sx;
      const cgy = (p.position.y - minY) * sy;
      const cgz = (p.position.z - minZ) * sz;
      const rgx = Math.max(0.7, p.radius * sx);
      const rgy = Math.max(0.7, p.radius * p.flatten * sy);
      const rgz = Math.max(0.7, p.radius * sz);
      const ex = Math.ceil(rgx * 1.6), ey = Math.ceil(rgy * 1.6), ez = Math.ceil(rgz * 1.6);
      const x0 = Math.max(0, Math.floor(cgx - ex)), x1 = Math.min(RES - 1, Math.ceil(cgx + ex));
      const y0 = Math.max(0, Math.floor(cgy - ey)), y1 = Math.min(RES - 1, Math.ceil(cgy + ey));
      const z0 = Math.max(0, Math.floor(cgz - ez)), z1 = Math.min(RES - 1, Math.ceil(cgz + ez));
      const dens = p.density;
      for (let z = z0; z <= z1; z += 1) {
        const dz = (z - cgz) / rgz;
        for (let y = y0; y <= y1; y += 1) {
          const dy = (y - cgy) / rgy;
          const rowBase = (z * RES + y) * RES;
          for (let x = x0; x <= x1; x += 1) {
            const dx = (x - cgx) / rgx;
            const q = dx * dx + dy * dy + dz * dz;
            if (q > 4) continue;
            this.accum[rowBase + x] += Math.exp(-q * 2.5) * dens;
          }
        }
      }
    }

    // 3) Grille → atlas de tranches Z (densité 0..1 → 0..255).
    this.pixels.fill(0);
    for (let z = 0; z < RES; z += 1) {
      const tileX = (z % TILES) * RES;
      const tileY = Math.floor(z / TILES) * RES;
      for (let y = 0; y < RES; y += 1) {
        const accRow = (z * RES + y) * RES;
        const atlasRow = (tileY + y) * ATLAS + tileX;
        for (let x = 0; x < RES; x += 1) {
          const v = this.accum[accRow + x];
          this.pixels[atlasRow + x] = v >= 1 ? 255 : (v * 255) | 0;
        }
      }
    }
    this.texture.needsUpdate = true;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
