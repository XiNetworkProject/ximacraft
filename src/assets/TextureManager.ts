import * as THREE from "three";
import { BlockRegistry } from "../world/BlockRegistry";
import { ResourcePackLoader, ResourcePackStats } from "./ResourcePackLoader";
import { TextureAtlas } from "./TextureAtlas";

export class TextureManager {
  readonly loader = new ResourcePackLoader();
  atlas!: TextureAtlas;
  opaqueMaterial!: THREE.MeshStandardMaterial;
  transparentMaterial!: THREE.MeshStandardMaterial;
  waterMaterial!: THREE.MeshPhysicalMaterial;
  stats: ResourcePackStats = { basePath: null, loadedCount: 0, missing: [], fallbacks: [] };

  async initialize(blockRegistry: BlockRegistry): Promise<void> {
    const textureNames = this.collectTextureNames(blockRegistry);
    const result = await this.loader.load(textureNames);
    this.stats = result.stats;
    this.atlas = TextureAtlas.create(result.textures);

    this.opaqueMaterial = new THREE.MeshStandardMaterial({
      map: this.atlas.texture,
      side: THREE.FrontSide,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
      emissive: 0xffffff,
      emissiveIntensity: 0.045,
      envMapIntensity: 0.32,
    });

    this.transparentMaterial = new THREE.MeshStandardMaterial({
      map: this.atlas.texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      alphaTest: 0.28,
      depthWrite: true,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      emissive: 0xffffff,
      emissiveIntensity: 0.055,
      envMapIntensity: 0.22,
    });

    this.waterMaterial = new THREE.MeshPhysicalMaterial({
      map: this.atlas.texture,
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.84,
      alphaTest: 0.02,
      depthWrite: false,
      vertexColors: true,
      roughness: 0.045,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.025,
      reflectivity: 0.82,
      ior: 1.333,
      thickness: 2.4,
      attenuationColor: new THREE.Color(0x1f7fa6),
      attenuationDistance: 18,
      envMapIntensity: 0.72,
    });
  }

  dispose(): void {
    this.atlas?.texture.dispose();
    this.opaqueMaterial?.dispose();
    this.transparentMaterial?.dispose();
    this.waterMaterial?.dispose();
  }

  private collectTextureNames(blockRegistry: BlockRegistry): string[] {
    const names = new Set<string>(["missing"]);
    for (const block of blockRegistry.all()) {
      if (block.texture) {
        names.add(block.texture);
      }
      if (block.textures) {
        Object.values(block.textures).forEach((name) => {
          if (name) names.add(name);
        });
      }
    }
    return [...names];
  }
}
