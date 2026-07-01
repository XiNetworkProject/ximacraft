import * as THREE from "three";
import { WildlifeSpecies } from "./LivingWorldTypes";
import { EntityModelLoader, geometryFromDefinition, WildlifeModelDefinition } from "./EntityModelLoader";

export interface WildlifeAsset {
  species: WildlifeSpecies;
  definition: WildlifeModelDefinition;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  profile: string;
}

const COLORS: Record<WildlifeSpecies, { base: number; emissive?: number; emissiveIntensity?: number }> = {
  bird: { base: 0x465767 },
  butterfly: { base: 0xf1bd45 },
  dragonfly: { base: 0x63c9cf },
  firefly: { base: 0x554d26, emissive: 0xf5e86a, emissiveIntensity: 1.9 },
  rabbit: { base: 0xb79a78 },
  deer: { base: 0x8b5d35 },
  fish: { base: 0x58a5c6 },
  frog: { base: 0x4b9a45 },
  bat: { base: 0x202530 },
};

export class EntityAssetManager {
  private readonly loader = new EntityModelLoader();
  private readonly assets = new Map<WildlifeSpecies, WildlifeAsset>();

  assetFor(species: WildlifeSpecies): WildlifeAsset {
    let asset = this.assets.get(species);
    if (!asset) {
      const definition = this.loader.definitionFor(species);
      const color = COLORS[species];
      const material = new THREE.MeshStandardMaterial({
        color: color.base,
        roughness: species === "fish" || species === "dragonfly" ? 0.42 : 0.78,
        metalness: 0,
        transparent: species === "firefly",
        opacity: species === "firefly" ? 0.86 : 1,
        emissive: new THREE.Color(color.emissive ?? 0x000000),
        emissiveIntensity: color.emissiveIntensity ?? 0,
      });
      asset = {
        species,
        definition,
        geometry: geometryFromDefinition(definition),
        material,
        profile: `${definition.displayName} procedural:${definition.parts.length}parts`,
      };
      this.assets.set(species, asset);
    }
    return asset;
  }

  debugProfile(): string {
    return [...this.assets.values()].map((asset) => `${asset.species}:${asset.definition.parts.length}p`).join(" ") || "assets pending";
  }

  dispose(): void {
    for (const asset of this.assets.values()) {
      asset.geometry.dispose();
      asset.material.dispose();
    }
    this.assets.clear();
  }
}
