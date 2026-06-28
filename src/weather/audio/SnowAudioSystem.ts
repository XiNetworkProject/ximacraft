import { WeatherSample } from "../WeatherTypes";

export class SnowAudioSystem {
  update(_sample: WeatherSample, _delta: number): void {
    // Snow is intentionally quiet for now; blizzard presence is carried by WindAudioSystem.
  }
}
