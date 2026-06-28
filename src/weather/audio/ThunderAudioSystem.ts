const WEATHER_SOUND_BASE = "/soundpacks/dynamic-surroundings/assets/minecraft/sounds/ambient/weather/";

export class ThunderAudioSystem {
  private unlocked = false;

  unlock(): void {
    this.unlocked = true;
  }

  playThunder(delaySeconds: number, power: number, distance = 600): void {
    if (!this.unlocked) return;
    window.setTimeout(() => {
      const thunder = new Audio(`${WEATHER_SOUND_BASE}thunder${1 + Math.floor(Math.random() * 6)}.ogg`);
      const distanceScale = Math.max(0.08, 1 - distance / 5000);
      thunder.volume = Math.min(0.96, (0.28 + power * 0.7) * distanceScale);
      void thunder.play().catch(() => undefined);
    }, delaySeconds * 1000);
  }
}
