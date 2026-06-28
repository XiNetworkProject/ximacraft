import { WeatherSample } from "../WeatherTypes";

export class WindAudioSystem {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private gust = 0;

  unlock(): void {
    if (this.context) return;
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    this.context = new AudioContextCtor();
    const bufferSize = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i += 1) {
      last = last * 0.982 + (Math.random() * 2 - 1) * 0.018;
      data[i] = last;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 680;
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    source.connect(filter).connect(this.gain).connect(this.context.destination);
    source.start();
  }

  update(sample: WeatherSample, delta: number): void {
    if (!this.context || !this.gain) return;
    this.gust = Math.max(0, this.gust - delta * 0.35);
    if (Math.random() < delta * Math.min(0.55, sample.windSpeed / 40)) {
      this.gust = Math.max(this.gust, 0.15 + Math.random() * 0.55);
    }
    const stormBoost = sample.thunderRisk * 0.12 + sample.precipitation * 0.08;
    const target = Math.min(0.42, sample.windSpeed * 0.012 + stormBoost + this.gust * 0.12);
    this.gain.gain.setTargetAtTime(target, this.context.currentTime, 0.45);
  }

  dispose(): void {
    void this.context?.close();
  }
}
