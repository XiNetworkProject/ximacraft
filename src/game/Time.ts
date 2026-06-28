import { DEFAULT_TIME_SPEED, WORLD_DAY_TICKS } from "../utils/Constants";

export class Time {
  ticks = 1000;
  speed = DEFAULT_TIME_SPEED;

  update(delta: number): void {
    this.ticks = (this.ticks + delta * this.speed) % WORLD_DAY_TICKS;
    if (this.ticks < 0) this.ticks += WORLD_DAY_TICKS;
  }

  /** Heure normalisée 0..1 où 0 = minuit, 0.5 = midi (pour la météo). */
  get timeOfDay(): number {
    return (this.ticks / WORLD_DAY_TICKS + 0.25) % 1;
  }

  setNamedTime(name: string): boolean {
    const named: Record<string, number> = {
      sunrise: 0,
      day: 1000,
      noon: 6000,
      sunset: 12000,
      night: 14000,
      midnight: 18000,
    };
    if (named[name] === undefined) return false;
    this.ticks = named[name];
    return true;
  }

  serialize() {
    return { ticks: this.ticks, speed: this.speed };
  }

  restore(data?: { ticks: number; speed: number }): void {
    if (!data) return;
    this.ticks = data.ticks;
    this.speed = data.speed;
  }
}
