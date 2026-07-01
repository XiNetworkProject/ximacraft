import { EnvironmentState } from "../environment/EnvironmentState";
import { SpatialAudioMixer } from "../assets/SpatialAudioMixer";

export class WildlifeAudioSystem {
  private chirpCooldown = 0;
  private rareCooldown = 5;

  constructor(private readonly mixer: SpatialAudioMixer) {}

  update(delta: number, environment: EnvironmentState, listener: { x: number; y: number; z: number }): void {
    this.mixer.setListener(listener);
    this.chirpCooldown -= delta;
    this.rareCooldown -= delta;
    const fauna = environment.fauna;
    if (fauna.activity < 0.22 || fauna.sheltering > 0.65) {
      this.chirpCooldown = 4;
      return;
    }
    if (this.rareCooldown <= 0) {
      this.emitRareCue(environment, listener);
      this.rareCooldown = 7 + (1 - fauna.activity) * 10;
    }
    if (this.chirpCooldown > 0) return;
    const birdChance = fauna.birds * (environment.timeOfDay > 0.2 && environment.timeOfDay < 0.8 ? 1 : 0.25);
    const insectChance = fauna.insects * (environment.timeOfDay > 0.7 || environment.timeOfDay < 0.25 ? 0.9 : 0.35);
    const amphibianChance = fauna.amphibians * (environment.surface.wetness > 0.2 || environment.precipitation > 0.05 ? 1 : 0.25);
    const id = amphibianChance > Math.max(birdChance, insectChance)
      ? "wildlife.frog.wet"
      : birdChance >= insectChance
        ? "wildlife.bird.distant"
        : "wildlife.insects.near";
    this.mixer.emit({
      id,
      x: listener.x + 16 + Math.sin(environment.hour) * 12,
      y: listener.y + (id.includes("bird") ? 8 : 1.5),
      z: listener.z - 22 + Math.cos(environment.hour * 0.7) * 12,
      volume: Math.max(birdChance, insectChance, amphibianChance) * 0.2,
      radius: id.includes("frog") ? 54 : 78,
    });
    this.chirpCooldown = 2.5 + (1 - fauna.activity) * 5;
  }

  private emitRareCue(environment: EnvironmentState, listener: { x: number; y: number; z: number }): void {
    const night = environment.timeOfDay < 0.2 || environment.timeOfDay > 0.8;
    const damp = environment.surface.wetness > 0.18 || environment.fog.density > 0.2;
    const id =
      night && environment.fauna.birds > 0.18 ? "wildlife.bat.pass" :
      damp && environment.fauna.amphibians > 0.2 ? "wildlife.frog.bank" :
      environment.fauna.fish > 0.35 ? "wildlife.fish.ripple" :
      environment.fauna.activity > 0.55 && environment.timeOfDay > 0.2 && environment.timeOfDay < 0.78 ? "wildlife.deer.snap" :
      "wildlife.bird.soft";
    this.mixer.emit({
      id,
      x: listener.x - 28 + Math.sin(environment.windDirectionDegrees) * 20,
      y: listener.y + (id.includes("bat") ? 7 : 1),
      z: listener.z + 26 + Math.cos(environment.windDirectionDegrees) * 20,
      volume: id.includes("deer") ? 0.12 : 0.16,
      radius: id.includes("fish") ? 46 : 92,
    });
  }
}
