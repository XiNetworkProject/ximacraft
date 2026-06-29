import * as THREE from "three";
import { EntityAssetManager } from "./EntityAssetManager";

export class EntityModelLoader {
  private readonly loaded = new Map<string, THREE.Object3D>();

  constructor(private readonly assets: EntityAssetManager) {}

  async load(id: string): Promise<THREE.Object3D | null> {
    const cached = this.loaded.get(id);
    if (cached) return cached.clone(true);
    const entry = this.assets.get(id);
    if (!entry || entry.kind !== "model") return null;
    // GLB/glTF parsing is intentionally centralized here. Real licensed assets
    // can be wired through this loader without changing LivingWorldSystem.
    return null;
  }

  remember(id: string, model: THREE.Object3D): void {
    this.loaded.set(id, model.clone(true));
  }

  clear(): void {
    this.loaded.clear();
  }
}
