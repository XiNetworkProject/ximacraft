import { WeatherSample } from "../WeatherTypes";

export class HailAudioSystem {
  private accumulator = 0;

  update(sample: WeatherSample, delta: number): void {
    this.accumulator += delta * sample.precipitation * sample.thunderRisk;
    if (sample.temperature > 18 || this.accumulator < 1.3) return;
    this.accumulator = 0;
    const context = new AudioContext();
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "triangle";
    osc.frequency.value = 380 + Math.random() * 420;
    gain.gain.value = 0.025;
    osc.connect(gain).connect(context.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
    osc.stop(context.currentTime + 0.09);
    window.setTimeout(() => void context.close(), 180);
  }
}
