export class AmbientWeatherAudio {
  protected unlocked = false;

  async unlock(): Promise<void> {
    this.unlocked = true;
  }

  protected approach(current: number, target: number, delta: number, speed: number): number {
    return current + (target - current) * Math.min(1, delta * speed);
  }
}
