import * as THREE from "three";
import { PLAYER_HEIGHT, PLAYER_RADIUS, WORLD_HEIGHT } from "../utils/Constants";
import { World } from "../world/World";

export class PlayerPhysics {
  onGround = false;

  move(position: THREE.Vector3, velocity: THREE.Vector3, delta: number, world: World): void {
    this.onGround = false;
    this.moveAxis(position, velocity, delta, world, "x");
    this.moveAxis(position, velocity, delta, world, "z");
    this.moveAxis(position, velocity, delta, world, "y");

    if (position.y < -20 || position.y > WORLD_HEIGHT + 80) {
      const spawn = world.getSpawnPosition();
      position.copy(spawn);
      velocity.set(0, 0, 0);
    }
  }

  intersectsWorld(position: THREE.Vector3, world: World): boolean {
    const minX = Math.floor(position.x - PLAYER_RADIUS);
    const maxX = Math.floor(position.x + PLAYER_RADIUS);
    const minY = Math.floor(position.y);
    const maxY = Math.floor(position.y + PLAYER_HEIGHT);
    const minZ = Math.floor(position.z - PLAYER_RADIUS);
    const maxZ = Math.floor(position.z + PLAYER_RADIUS);

    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const collisionHeight = world.getBlockCollisionHeight(x, y, z);
          if (
            collisionHeight > 0
            && position.y < y + collisionHeight
            && position.y + PLAYER_HEIGHT > y
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  blockIntersectsPlayer(position: THREE.Vector3, x: number, y: number, z: number): boolean {
    const playerMinX = position.x - PLAYER_RADIUS;
    const playerMaxX = position.x + PLAYER_RADIUS;
    const playerMinY = position.y;
    const playerMaxY = position.y + PLAYER_HEIGHT;
    const playerMinZ = position.z - PLAYER_RADIUS;
    const playerMaxZ = position.z + PLAYER_RADIUS;

    return (
      playerMinX < x + 1 &&
      playerMaxX > x &&
      playerMinY < y + 1 &&
      playerMaxY > y &&
      playerMinZ < z + 1 &&
      playerMaxZ > z
    );
  }

  private moveAxis(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    delta: number,
    world: World,
    axis: "x" | "y" | "z",
  ): void {
    const amount = velocity[axis] * delta;
    if (amount === 0) return;

    position[axis] += amount;
    if (!this.intersectsWorld(position, world)) {
      return;
    }

    position[axis] -= amount;
    if (axis === "y" && velocity.y < 0) {
      this.onGround = true;
    }
    velocity[axis] = 0;
  }
}
