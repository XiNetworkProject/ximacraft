import { WORLD_DAY_TICKS } from "../utils/Constants";
import { clamp } from "../utils/MathUtils";
import { WeatherSample, WeatherType } from "../weather/WeatherTypes";
import { World } from "../world/World";
import { BlockId } from "../world/BlockTypes";
import { SeasonState } from "./SeasonSystem";
import type { EnvironmentState } from "../environment/EnvironmentState";

type ChannelName = "forest" | "insects" | "water" | "cave" | "wind";

interface Channel {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
}

export class AmbientBiomeAudioSystem {
  private context: AudioContext | null = null;
  private unlocked = false;
  private channels = new Map<ChannelName, Channel>();
  private debugLabel = "silent";

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.createChannels();
    }
    if (this.context.state === "suspended") await this.context.resume();
    this.unlocked = true;
  }

  update(world: World, player: { x: number; y: number; z: number }, sample: WeatherSample, ticks: number, season: SeasonState, delta: number, environment?: EnvironmentState): void {
    if (!this.unlocked || !this.context) return;
    const biome = world.getBiomeAt(player.x, player.z).id;
    const time = ((ticks % WORLD_DAY_TICKS) + WORLD_DAY_TICKS) % WORLD_DAY_TICKS / WORLD_DAY_TICKS;
    const night = time < 0.2 || time > 0.8;
    const dawnDusk = Math.max(0, 1 - Math.min(Math.abs(time - 0.25), Math.abs(time - 0.75)) * 5);
    const water = this.waterPresence(world, player.x, player.z);
    const cave = player.y < world.getSurfaceHeight(player.x, player.z) - 5 ? 1 : 0;
    const fogMute = environment ? 1 - environment.fog.density * 0.28 : 1;
    const stormMute = (sample.weatherType === WeatherType.THUNDERSTORM ? 0.38 : sample.weatherType === WeatherType.SNOW && sample.windSpeed > 12 ? 0.24 : 1) * fogMute;
    const forest = biome === "forest" || biome === "snow" ? 0.75 : biome === "plains" || biome === "hills" ? 0.28 : 0.05;
    const insect = season.insectActivity * (night ? 0.85 : dawnDusk * 0.42) * (biome === "desert" || biome === "snow" ? 0.12 : 1);
    const wind = clamp((environment?.gustSpeed ?? sample.windSpeed) / 26, 0, 1);
    const wetGround = environment ? environment.surface.wetness : 0;

    this.setChannel("forest", forest * stormMute * (night ? 0.45 : 0.75 + dawnDusk * 0.25), 520, delta);
    this.setChannel("insects", insect * stormMute, night ? 2500 : 1900, delta);
    this.setChannel("water", water * (0.22 + sample.precipitation * 0.42 + wetGround * 0.12), 720, delta);
    this.setChannel("cave", cave * (0.34 + wind * 0.2), 180, delta);
    this.setChannel("wind", wind * (0.08 + sample.precipitation * 0.16 + cave * 0.18), 340 + wind * 700, delta);
    this.debugLabel = [
      forest > 0.45 ? "forest" : "",
      insect > 0.2 ? "insects" : "",
      water > 0.35 ? "water" : "",
      cave > 0 ? "cave" : "",
      wind > 0.35 ? "wind" : "",
      environment && environment.fog.density > 0.35 ? "fog" : "",
    ].filter(Boolean).join("+") || "quiet";
  }

  debug(): string {
    return `Ambience ${this.debugLabel}`;
  }

  dispose(): void {
    for (const channel of this.channels.values()) {
      channel.source.stop();
      channel.source.disconnect();
      channel.gain.disconnect();
      channel.filter.disconnect();
    }
    this.channels.clear();
    this.context?.close();
    this.context = null;
    this.unlocked = false;
  }

  private createChannels(): void {
    const context = this.context!;
    for (const name of ["forest", "insects", "water", "cave", "wind"] as ChannelName[]) {
      const source = context.createBufferSource();
      source.buffer = this.makeNoiseBuffer(name);
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = name === "cave" ? "lowpass" : name === "insects" ? "bandpass" : "highpass";
      filter.frequency.value = name === "cave" ? 180 : name === "insects" ? 2400 : 500;
      filter.Q.value = name === "insects" ? 7 : 0.8;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      source.start();
      this.channels.set(name, { source, gain, filter });
    }
  }

  private setChannel(name: ChannelName, target: number, frequency: number, delta: number): void {
    const channel = this.channels.get(name);
    if (!channel || !this.context) return;
    const gain = name === "insects" ? 0.028 : name === "water" ? 0.045 : name === "wind" ? 0.035 : 0.024;
    const now = this.context.currentTime;
    const smooth = Math.min(1, delta * 2.5);
    const current = channel.gain.gain.value;
    channel.gain.gain.setTargetAtTime(clamp(current + (target * gain - current) * smooth, 0, gain), now, 0.18);
    channel.filter.frequency.setTargetAtTime(frequency, now, 0.35);
  }

  private waterPresence(world: World, x: number, z: number): number {
    let hits = 0;
    let checks = 0;
    for (let dz = -10; dz <= 10; dz += 5) {
      for (let dx = -10; dx <= 10; dx += 5) {
        checks += 1;
        const wx = Math.floor(x + dx);
        const wz = Math.floor(z + dz);
        const y = world.getSurfaceHeight(wx, wz);
        if (world.getBlock(wx, y, wz) === BlockId.WATER || world.getBlock(wx, y + 1, wz) === BlockId.WATER) hits += 1;
      }
    }
    return checks > 0 ? hits / checks : 0;
  }

  private makeNoiseBuffer(name: ChannelName): AudioBuffer {
    const context = this.context!;
    const seconds = name === "water" ? 3 : 2;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * (name === "wind" || name === "cave" ? 0.985 : 0.82) + white * (name === "insects" ? 0.42 : 0.18);
      const chirp = name === "insects" && i % 1200 < 24 ? Math.sin(i * 0.45) * 0.65 : 0;
      const ripple = name === "water" ? Math.sin(i * 0.018 + Math.sin(i * 0.001) * 6) * 0.18 : 0;
      data[i] = clamp(last + chirp + ripple, -1, 1);
    }
    return buffer;
  }
}
