import { BlockRegistry } from "../world/BlockRegistry";
import { BlockId } from "../world/BlockTypes";

type MaterialSound = {
  frequency: number;
  noise: number;
  decay: number;
  gain: number;
};

const MATERIALS: Record<string, MaterialSound> = {
  grass: { frequency: 180, noise: 0.65, decay: 0.09, gain: 0.13 },
  dirt: { frequency: 130, noise: 0.75, decay: 0.08, gain: 0.12 },
  sand: { frequency: 230, noise: 0.9, decay: 0.07, gain: 0.1 },
  stone: { frequency: 420, noise: 0.42, decay: 0.06, gain: 0.11 },
  wood: { frequency: 260, noise: 0.35, decay: 0.08, gain: 0.13 },
  leaves: { frequency: 520, noise: 0.85, decay: 0.045, gain: 0.07 },
  glass: { frequency: 900, noise: 0.24, decay: 0.05, gain: 0.08 },
  snow: { frequency: 300, noise: 0.92, decay: 0.055, gain: 0.075 },
  water: { frequency: 160, noise: 0.7, decay: 0.12, gain: 0.08 },
};

export class GameSoundSystem {
  private context: AudioContext | null = null;
  private unlocked = false;

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.unlocked = true;
  }

  playFootstep(blockId: BlockId, blocks: BlockRegistry, speed = 1): void {
    this.playBlockPulse(blockId, blocks, 0.55 + speed * 0.04, 0.75);
  }

  playPlace(blockId: BlockId, blocks: BlockRegistry): void {
    this.playBlockPulse(blockId, blocks, 0.82, 1.05);
  }

  playBreak(blockId: BlockId, blocks: BlockRegistry): void {
    this.playBlockPulse(blockId, blocks, 1.15, 1.35);
  }

  playJump(blockId: BlockId, blocks: BlockRegistry): void {
    this.playBlockPulse(blockId, blocks, 0.72, 0.9);
  }

  private playBlockPulse(blockId: BlockId, blocks: BlockRegistry, pitch = 1, strength = 1): void {
    if (!this.unlocked || !this.context) {
      return;
    }
    const material = this.materialFor(blockId, blocks);
    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = material.frequency * pitch;
    filter.Q.value = 0.9;
    gain.gain.setValueAtTime(material.gain * strength, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + material.decay * strength);

    const noise = this.createNoise(material.decay * 1.4);
    const source = this.context.createBufferSource();
    source.buffer = noise;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.context.destination);
    source.start(now);
    source.stop(now + material.decay * 1.5);

    const osc = this.context.createOscillator();
    const oscGain = this.context.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(material.frequency * pitch * 0.55, now);
    oscGain.gain.setValueAtTime(material.gain * (1 - material.noise) * 0.42 * strength, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + material.decay);
    osc.connect(oscGain);
    oscGain.connect(this.context.destination);
    osc.start(now);
    osc.stop(now + material.decay);
  }

  private createNoise(duration: number): AudioBuffer {
    const context = this.context!;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private materialFor(blockId: BlockId, blocks: BlockRegistry): MaterialSound {
    const key = blocks.get(blockId).key;
    if (blockId === BlockId.WATER) return MATERIALS.water;
    if (blockId === BlockId.GRASS) return MATERIALS.grass;
    if (blockId === BlockId.DIRT) return MATERIALS.dirt;
    if (blockId === BlockId.SAND || blockId === BlockId.RED_SAND) return MATERIALS.sand;
    if (blockId === BlockId.SNOW_BLOCK || blockId === BlockId.WHITE_WOOL) return MATERIALS.snow;
    if (key.includes("log") || key.includes("planks") || key.includes("crafting")) return MATERIALS.wood;
    if (key.includes("leaves")) return MATERIALS.leaves;
    if (key.includes("glass") || key.includes("ice")) return MATERIALS.glass;
    return MATERIALS.stone;
  }
}
