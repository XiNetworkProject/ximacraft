export interface SpatialAudioEvent {
  id: string;
  x: number;
  y: number;
  z: number;
  volume: number;
  radius: number;
}

export class SpatialAudioMixer {
  private readonly events: SpatialAudioEvent[] = [];
  private context: AudioContext | null = null;
  private unlocked = false;
  private listener = { x: 0, y: 0, z: 0 };

  async unlock(): Promise<void> {
    if (typeof AudioContext === "undefined") return;
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
    this.unlocked = true;
  }

  setListener(position: { x: number; y: number; z: number }): void {
    this.listener.x = position.x;
    this.listener.y = position.y;
    this.listener.z = position.z;
  }

  emit(event: SpatialAudioEvent): void {
    this.events.push(event);
    if (this.events.length > 64) this.events.shift();
    if (this.unlocked && this.context) this.play(event);
  }

  consume(): SpatialAudioEvent[] {
    const copy = this.events.slice();
    this.events.length = 0;
    return copy;
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.unlocked = false;
    this.events.length = 0;
  }

  private play(event: SpatialAudioEvent): void {
    const context = this.context!;
    const dx = event.x - this.listener.x;
    const dy = event.y - this.listener.y;
    const dz = event.z - this.listener.z;
    const distance = Math.hypot(dx, dy, dz);
    const attenuation = Math.max(0, 1 - distance / Math.max(1, event.radius));
    const volume = Math.min(0.34, event.volume * attenuation);
    if (volume <= 0.002) return;

    const now = context.currentTime;
    const profile = profileFor(event.id);
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    const filter = context.createBiquadFilter();
    filter.type = profile.filter;
    filter.frequency.value = profile.frequency;
    filter.Q.value = profile.q;
    pan.pan.value = Math.max(-1, Math.min(1, dx / Math.max(8, Math.abs(dx) + Math.abs(dz))));
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);

    if (profile.noise > 0) {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(profile.duration, profile.noise, profile.chirp);
      source.connect(filter);
      filter.connect(pan);
      pan.connect(gain);
      gain.connect(context.destination);
      source.start(now);
      source.stop(now + profile.duration);
    } else {
      const osc = context.createOscillator();
      osc.type = profile.oscillator;
      osc.frequency.setValueAtTime(profile.frequency, now);
      osc.frequency.exponentialRampToValueAtTime(profile.frequency * profile.endRatio, now + profile.duration);
      osc.connect(filter);
      filter.connect(pan);
      pan.connect(gain);
      gain.connect(context.destination);
      osc.start(now);
      osc.stop(now + profile.duration);
    }
  }

  private noiseBuffer(duration: number, noise: number, chirp: number): AudioBuffer {
    const context = this.context!;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / context.sampleRate;
      const white = Math.random() * 2 - 1;
      last = last * (1 - noise * 0.04) + white * noise * 0.22;
      const tone = chirp > 0 ? Math.sin(t * Math.PI * 2 * (chirp + Math.sin(t * 20) * chirp * 0.12)) * 0.4 : 0;
      data[i] = Math.max(-1, Math.min(1, last + tone));
    }
    return buffer;
  }
}

type AudioProfile = {
  duration: number;
  frequency: number;
  endRatio: number;
  oscillator: OscillatorType;
  filter: BiquadFilterType;
  q: number;
  noise: number;
  chirp: number;
};

function profileFor(id: string): AudioProfile {
  if (id.includes("frog")) return { duration: 0.42, frequency: 150, endRatio: 0.72, oscillator: "sawtooth", filter: "lowpass", q: 1.2, noise: 0.12, chirp: 120 };
  if (id.includes("bat")) return { duration: 0.18, frequency: 4200, endRatio: 1.3, oscillator: "sine", filter: "highpass", q: 4, noise: 0.05, chirp: 4200 };
  if (id.includes("deer")) return { duration: 0.32, frequency: 310, endRatio: 0.58, oscillator: "triangle", filter: "bandpass", q: 1.1, noise: 0.08, chirp: 260 };
  if (id.includes("fish") || id.includes("water")) return { duration: 0.5, frequency: 280, endRatio: 0.8, oscillator: "sine", filter: "lowpass", q: 0.8, noise: 0.38, chirp: 0 };
  if (id.includes("insect") || id.includes("firefly")) return { duration: 0.16, frequency: 2600, endRatio: 1.08, oscillator: "sine", filter: "bandpass", q: 7, noise: 0.18, chirp: 2400 };
  return { duration: 0.24, frequency: 1700, endRatio: 1.45, oscillator: "triangle", filter: "bandpass", q: 3.2, noise: 0.12, chirp: 1500 };
}
