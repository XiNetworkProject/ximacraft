import { WeatherSample } from "../WeatherTypes";
import { AmbientWeatherAudio } from "./AmbientWeatherAudio";

const WEATHER_SOUND_BASE = "/soundpacks/dynamic-surroundings/assets/minecraft/sounds/ambient/weather/";

export class RainAudioSystem extends AmbientWeatherAudio {
  private readonly rain = new Audio(`${WEATHER_SOUND_BASE}rain3.ogg`);
  private nextSwap = 0;

  constructor() {
    super();
    this.rain.loop = true;
    this.rain.volume = 0;
    this.rain.preload = "auto";
  }

  override async unlock(): Promise<void> {
    await super.unlock();
    try {
      await this.rain.play();
    } catch {
      this.unlocked = false;
    }
  }

  update(sample: WeatherSample, sheltered: boolean, delta: number): void {
    if (!this.unlocked) return;
    const rainAmount = sample.temperature > 1 ? sample.precipitation : 0;
    const shelterScale = sheltered ? 0.32 : 1;
    const target = Math.min(0.82, rainAmount * (sample.thunderRisk > 0.4 ? 0.82 : 0.58) * shelterScale);
    this.rain.volume = this.approach(this.rain.volume, target, delta, 2.8);
    if (target > 0.02 && this.rain.paused) void this.rain.play();
    if (target <= 0.01 && this.rain.volume < 0.01 && !this.rain.paused) this.rain.pause();

    this.nextSwap -= delta;
    if (rainAmount > 0.08 && this.nextSwap <= 0) {
      this.nextSwap = 24 + Math.random() * 40;
      this.rain.src = `${WEATHER_SOUND_BASE}rain${1 + Math.floor(Math.random() * 8)}.ogg`;
      this.rain.loop = true;
      this.rain.volume = target;
      void this.rain.play();
    }
  }

  dispose(): void {
    this.rain.pause();
  }
}
