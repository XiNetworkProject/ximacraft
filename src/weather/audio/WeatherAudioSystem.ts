import { WeatherEvent } from "../events/WeatherEvent";
import { SurfaceWeatherState } from "../ground/SurfaceWeatherState";
import { WeatherSample } from "../WeatherTypes";
import { HailAudioSystem } from "./HailAudioSystem";
import { RainAudioSystem } from "./RainAudioSystem";
import { SnowAudioSystem } from "./SnowAudioSystem";
import { ThunderAudioSystem } from "./ThunderAudioSystem";
import { WindAudioSystem } from "./WindAudioSystem";

export interface WeatherAudioPlayerContext {
  x: number;
  y: number;
  z: number;
  sheltered: boolean;
}

export class WeatherAudioSystem {
  readonly thunder = new ThunderAudioSystem();
  private readonly rain = new RainAudioSystem();
  private readonly wind = new WindAudioSystem();
  private readonly snow = new SnowAudioSystem();
  private readonly hail = new HailAudioSystem();
  private unlocked = false;

  async unlock(): Promise<void> {
    this.unlocked = true;
    this.thunder.unlock();
    this.wind.unlock();
    await this.rain.unlock();
  }

  update(sample: WeatherSample, events: readonly WeatherEvent[], surface: SurfaceWeatherState, player: WeatherAudioPlayerContext, delta: number): void {
    if (!this.unlocked) return;
    const ground = surface.get(player.x, player.z);
    const sheltered = player.sheltered;
    this.rain.update(sample, sheltered, delta);
    this.wind.update(sample, delta);
    this.snow.update(sample, delta);
    this.hail.update(sample, delta);

    const nearbyStorm = events.find((event) => event.producesLightning && Math.hypot(event.x - player.x, event.z - player.z) < event.radius * 2.4);
    if (nearbyStorm && Math.random() < delta * nearbyStorm.intensity * 0.025) {
      const distance = Math.hypot(nearbyStorm.x - player.x, nearbyStorm.z - player.z);
      this.thunder.playThunder(distance / 180, nearbyStorm.intensity * 0.38, distance);
    }

    if (ground && ground.wetness > 0.75 && sample.precipitation > 0.05) {
      // Reserved hook: puddle drip/ripple one-shots can be layered here.
    }
  }

  playThunder(delaySeconds: number, power: number, distance?: number): void {
    this.thunder.playThunder(delaySeconds, power, distance);
  }

  dispose(): void {
    this.rain.dispose();
    this.wind.dispose();
  }
}
