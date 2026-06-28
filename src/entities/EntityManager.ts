import * as THREE from "three";
import { Player } from "../player/Player";
import { BlockRegistry } from "../world/BlockRegistry";
import { BlockId } from "../world/BlockTypes";
import { Entity } from "./Entity";
import { ItemDrop } from "./ItemDrop";

export class EntityManager {
  private readonly entities: Entity[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly blockRegistry: BlockRegistry,
  ) {}

  spawnItem(blockId: BlockId, position: THREE.Vector3): void {
    const drop = new ItemDrop(blockId, position, this.blockRegistry);
    drop.velocity.set((Math.random() - 0.5) * 1.2, 2.5, (Math.random() - 0.5) * 1.2);
    this.entities.push(drop);
    if (drop.mesh) this.scene.add(drop.mesh);
  }

  update(delta: number, player: Player): void {
    for (const entity of this.entities) {
      entity.update(delta);
      if (entity instanceof ItemDrop && entity.position.distanceTo(player.position) < 1.4) {
        if (player.inventory.add(entity.blockId, 1)) {
          entity.alive = false;
        }
      }
    }

    for (let i = this.entities.length - 1; i >= 0; i -= 1) {
      const entity = this.entities[i];
      if (entity.alive) continue;
      if (entity.mesh) this.scene.remove(entity.mesh);
      entity.dispose();
      this.entities.splice(i, 1);
    }
  }

  dispose(): void {
    for (const entity of this.entities) {
      if (entity.mesh) this.scene.remove(entity.mesh);
      entity.dispose();
    }
    this.entities.length = 0;
  }
}
