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

  emit(event: SpatialAudioEvent): void {
    this.events.push(event);
    if (this.events.length > 64) this.events.shift();
  }

  consume(): SpatialAudioEvent[] {
    const copy = this.events.slice();
    this.events.length = 0;
    return copy;
  }
}
