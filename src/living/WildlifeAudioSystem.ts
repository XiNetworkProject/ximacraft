import { EnvironmentState } from "../environment/EnvironmentState";
import { SpatialAudioMixer } from "../assets/SpatialAudioMixer";

export class WildlifeAudioSystem {
  private chirpCooldown = 0;

  constructor(private readonly mixer: SpatialAudioMixer) {}

  update(delta: number, environment: EnvironmentState, listener: { x: number; y: number; z: number }): void {
    this.chirpCooldown -= delta;
    if (this.chirpCooldown > 0) return;
    const fauna = environment.fauna;
    if (fauna.activity < 0.22 || fauna.sheltering > 0.65) {
      this.chirpCooldown = 4;
      return;
    }
    const birdChance = fauna.birds * (environment.timeOfDay > 0.2 && environment.timeOfDay < 0.8 ? 1 : 0.25);
    const insectChance = fauna.insects * (environment.timeOfDay > 0.7 || environment.timeOfDay < 0.25 ? 0.9 : 0.35);
    const id = birdChance >= insectChance ? "wildlife.bird.distant" : "wildlife.insects.near";
    this.mixer.emit({
      id,
      x: listener.x + 18,
      y: listener.y + 6,
      z: listener.z - 24,
      volume: Math.max(birdChance, insectChance) * 0.18,
      radius: 72,
    });
    this.chirpCooldown = 2.5 + (1 - fauna.activity) * 5;
  }
}
