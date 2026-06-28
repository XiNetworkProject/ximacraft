import { WeatherSystem } from "../world/WeatherSystem";

const WEATHER_SOUND_BASE = "/soundpacks/dynamic-surroundings/assets/minecraft/sounds/ambient/weather/";

export class SoundManager {
  private readonly rain = new Audio(`${WEATHER_SOUND_BASE}rain3.ogg`);
  private unlocked = false;
  private windContext: AudioContext | null = null;
  private windGain: GainNode | null = null;
  private nextRainSwap = 0;

  constructor() {
    this.rain.loop = true;
    this.rain.preload = "auto";
    this.rain.volume = 0;
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    this.unlocked = true;
    this.setupWind();
    try {
      this.rain.volume = 0;
      await this.rain.play();
    } catch {
      this.unlocked = false;
    }
  }

  update(weather: WeatherSystem, delta: number): void {
    if (!this.unlocked) return;

    const rainLike = weather.current === "rain" || weather.current === "storm" || weather.current === "thunderstorm";
    const snowLike = weather.current === "snow" || weather.current === "blizzard";
    const hailLike = weather.current === "hail";
    const targetRainVolume = rainLike ? Math.min(0.72, weather.intensity * (weather.current === "rain" ? 0.55 : 0.78)) : 0;
    this.rain.volume += (targetRainVolume - this.rain.volume) * Math.min(1, delta * 2.5);

    if (targetRainVolume > 0.02 && this.rain.paused) {
      void this.rain.play();
    } else if (targetRainVolume <= 0.01 && this.rain.volume < 0.01 && !this.rain.paused) {
      this.rain.pause();
    }

    this.nextRainSwap -= delta;
    if (rainLike && this.nextRainSwap <= 0) {
      this.nextRainSwap = 24 + Math.random() * 42;
      this.rain.src = `${WEATHER_SOUND_BASE}rain${1 + Math.floor(Math.random() * 8)}.ogg`;
      this.rain.loop = true;
      this.rain.volume = targetRainVolume;
      void this.rain.play();
    }

    if (this.windGain) {
      const windVolume = Math.min(0.3, weather.wind * 0.16 + (snowLike || hailLike ? weather.intensity * 0.1 : 0));
      this.windGain.gain.setTargetAtTime(windVolume, this.windContext!.currentTime, 0.6);
    }
  }

  playThunder(delaySeconds: number, power: number): void {
    if (!this.unlocked) return;
    window.setTimeout(() => {
      const thunder = new Audio(`${WEATHER_SOUND_BASE}thunder${1 + Math.floor(Math.random() * 6)}.ogg`);
      thunder.volume = Math.min(0.95, 0.35 + power * 0.55);
      void thunder.play();
    }, delaySeconds * 1000);
  }

  dispose(): void {
    this.rain.pause();
    void this.windContext?.close();
  }

  private setupWind(): void {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    this.windContext = new AudioContextCtor();
    const bufferSize = 2 * this.windContext.sampleRate;
    const buffer = this.windContext.createBuffer(1, bufferSize, this.windContext.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i += 1) {
      last = last * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[i] = last;
    }
    const source = this.windContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = this.windContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 560;
    this.windGain = this.windContext.createGain();
    this.windGain.gain.value = 0;
    source.connect(filter).connect(this.windGain).connect(this.windContext.destination);
    source.start();
  }
}
