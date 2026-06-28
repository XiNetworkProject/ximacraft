import * as THREE from "three";
import { DEFAULT_TIME_SPEED, PLAYER_EYE_HEIGHT } from "../utils/Constants";
import { BlockId } from "../world/BlockTypes";
import { World } from "../world/World";
import { CameraController } from "../game/CameraController";
import { Input } from "../game/Input";
import { GameMode } from "./GameMode";
import { PlayerInventory } from "./PlayerInventory";
import { PlayerPhysics } from "./PlayerPhysics";

export class Player {
  readonly position = new THREE.Vector3(0.5, 80, 0.5);
  readonly velocity = new THREE.Vector3();
  readonly inventory = new PlayerInventory();
  readonly physics = new PlayerPhysics();
  gameMode: GameMode = "creative";
  creativeFlying = false;
  health = 20;
  hunger = 20;
  private airJumpsRemaining = 1;
  private lastSpaceTapAt = -1000;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(delta: number, input: Input, cameraController: CameraController, world: World, controlsEnabled: boolean): void {
    if (!controlsEnabled) {
      this.updateCamera();
      return;
    }

    const isCreative = this.gameMode === "creative";
    const water = this.isInWater(world);
    const headInWater = this.isWaterAt(world, this.position.y + PLAYER_EYE_HEIGHT);
    const move = new THREE.Vector3();
    const forward = cameraController.getFlatForward();
    const right = cameraController.getRight();
    const arrowMove = new THREE.Vector3();

    if (input.isDown("KeyW") || input.isDown("KeyZ") || input.isDown("ArrowUp")) move.add(forward);
    if (input.isDown("KeyS") || input.isDown("ArrowDown")) move.sub(forward);
    if (input.isDown("KeyD") || input.isDown("ArrowRight")) move.add(right);
    if (input.isDown("KeyA") || input.isDown("KeyQ") || input.isDown("ArrowLeft")) move.sub(right);
    if (input.isDown("ArrowUp")) arrowMove.z -= 1;
    if (input.isDown("ArrowDown")) arrowMove.z += 1;
    if (input.isDown("ArrowRight")) arrowMove.x += 1;
    if (input.isDown("ArrowLeft")) arrowMove.x -= 1;

    if (arrowMove.lengthSq() > 0) {
      move.copy(arrowMove.normalize());
    }

    if (move.lengthSq() > 0) move.normalize();

    // Dans l'eau, Shift sert à PLONGER (pas à sprinter).
    const shiftDown = input.isDown("ShiftLeft") || input.isDown("ShiftRight");
    const sprinting = shiftDown && !water;
    const baseSpeed = isCreative && this.creativeFlying ? (sprinting ? 24 : 12) : sprinting ? 7.2 : 5.2;
    const waterScale = water ? (headInWater ? 0.68 : 0.56) : 1;
    const targetVX = move.x * baseSpeed * waterScale;
    const targetVZ = move.z * baseSpeed * waterScale;
    const accel = water ? 10 : this.physics.onGround || this.creativeFlying ? 16 : 5;
    this.velocity.x += (targetVX - this.velocity.x) * Math.min(1, accel * delta);
    this.velocity.z += (targetVZ - this.velocity.z) * Math.min(1, accel * delta);
    if (water) {
      const drag = Math.max(0, 1 - delta * 1.2);
      this.velocity.x *= drag;
      this.velocity.z *= drag;
    }

    if (input.wasPressed("Space")) {
      const now = performance.now();
      if (isCreative && now - this.lastSpaceTapAt < 320) {
        this.toggleFlight();
        this.lastSpaceTapAt = -1000;
      } else {
        this.lastSpaceTapAt = now;
      }
    }

    if (this.physics.onGround || water) {
      this.airJumpsRemaining = 1;
    }

    if (isCreative && this.creativeFlying) {
      this.velocity.y = 0;
      if (input.isDown("Space")) this.velocity.y += baseSpeed;
      if (input.isDown("ControlLeft") || input.isDown("ControlRight")) this.velocity.y -= baseSpeed;
    } else if (water) {
      const ctrlDown = input.isDown("ControlLeft") || input.isDown("ControlRight");
      const diveDown = shiftDown || ctrlDown;
      const swimUp = input.isDown("Space");
      const buoyancy = headInWater ? 3.8 : 1.4;
      this.velocity.y += (buoyancy - 6.2) * delta;
      if (swimUp) {
        this.velocity.y += 16 * delta;
      }
      if (diveDown) {
        this.velocity.y -= 12 * delta;
      }
      this.velocity.y *= Math.max(0, 1 - delta * 1.8);
      this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, diveDown ? -4.2 : -2.2, swimUp ? 4.2 : 1.4);
    } else {
      this.velocity.y -= 28 * delta;
      if (input.isDown("Space") && this.physics.onGround) {
        this.velocity.y = 8.5;
      } else if (input.wasPressed("Space") && this.airJumpsRemaining > 0) {
        this.velocity.y = 8.2;
        this.airJumpsRemaining -= 1;
      }
    }

    this.physics.move(this.position, this.velocity, delta, world);
    this.updateCamera();
  }

  setGameMode(mode: GameMode): void {
    this.gameMode = mode;
    if (mode === "survival") {
      this.creativeFlying = false;
    }
  }

  toggleFlight(): void {
    if (this.gameMode === "creative") {
      this.creativeFlying = !this.creativeFlying;
      this.velocity.y = 0;
    }
  }

  placeableBlockIntersects(x: number, y: number, z: number): boolean {
    return this.physics.blockIntersectsPlayer(this.position, x, y, z);
  }

  serialize() {
    return {
      position: this.position.toArray(),
      velocity: this.velocity.toArray(),
      gameMode: this.gameMode,
      creativeFlying: this.creativeFlying,
      health: this.health,
      hunger: this.hunger,
      inventory: this.inventory.serialize(),
      selectedHotbarIndex: this.inventory.selectedHotbarIndex,
      timeSpeedHint: DEFAULT_TIME_SPEED,
    };
  }

  restore(data: ReturnType<Player["serialize"]>): void {
    this.position.fromArray(data.position);
    this.velocity.fromArray(data.velocity);
    this.gameMode = data.gameMode;
    this.creativeFlying = data.creativeFlying;
    this.health = data.health;
    this.hunger = data.hunger;
    this.inventory.restore(data.inventory, data.selectedHotbarIndex);
    this.updateCamera();
  }

  private updateCamera(): void {
    this.camera.position.set(this.position.x, this.position.y + PLAYER_EYE_HEIGHT, this.position.z);
  }

  private isInWater(world: World): boolean {
    return (
      this.isWaterAt(world, this.position.y + 0.18) ||
      this.isWaterAt(world, this.position.y + 0.82) ||
      this.isWaterAt(world, this.position.y + 1.35)
    );
  }

  private isWaterAt(world: World, y: number): boolean {
    return world.getBlock(this.position.x, y, this.position.z) === BlockId.WATER;
  }
}
