import { clamp, hashString, makeRng } from "../utils/MathUtils";
import { EnvironmentFogState, FogBankKind } from "./EnvironmentState";

interface FogBank {
  id: string;
  x: number;
  z: number;
  radius: number;
  density: number;
  age: number;
  life: number;
  kind: FogBankKind;
}

export interface FogBankUpdateInput {
  seed: string;
  playerX: number;
  playerZ: number;
  humidity: number;
  dewPoint: number;
  temperature: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  dayFactor: number;
  precipitation: number;
  waterNearby: number;
  valleyFactor: number;
}

export class FogBankSystem {
  private readonly banks = new Map<string, FogBank>();
  private spawnTimer = 0;

  update(delta: number, input: FogBankUpdateInput): EnvironmentFogState {
    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.spawnBanks(input);
    }

    const driftScale = 0.55 + input.windSpeed * 0.018;
    for (const [key, bank] of this.banks) {
      bank.age += delta;
      bank.x += input.windX * driftScale * delta;
      bank.z += input.windZ * driftScale * delta;
      const sunBurn = input.dayFactor > 0.5 ? input.dayFactor * 0.8 : 0;
      const dryBurn = clamp(0.66 - input.humidity, 0, 1) * 1.2;
      bank.density = Math.max(0, bank.density - (sunBurn + dryBurn) * delta / bank.life);
      if (bank.age > bank.life || bank.density <= 0.03 || Math.hypot(bank.x - input.playerX, bank.z - input.playerZ) > 3600) {
        this.banks.delete(key);
      }
    }
    return this.sample(input.playerX, input.playerZ, input.humidity, input.precipitation);
  }

  debug(): string {
    const list = [...this.banks.values()]
      .sort((a, b) => b.density - a.density)
      .slice(0, 4)
      .map((b) => `${b.kind}@${Math.round(b.x)},${Math.round(b.z)} d=${b.density.toFixed(2)} r=${Math.round(b.radius)}`)
      .join(" | ");
    return `FogBanks count=${this.banks.size}${list ? ` ${list}` : ""}`;
  }

  clear(): void {
    this.banks.clear();
  }

  private spawnBanks(input: FogBankUpdateInput): void {
    const saturation = clamp(input.humidity * 1.2 - Math.max(0, input.temperature - input.dewPoint) * 0.12, 0, 1);
    const nightBoost = 1 - input.dayFactor;
    const opportunity = saturation * (0.18 + input.waterNearby * 0.48 + input.valleyFactor * 0.34 + nightBoost * 0.3);
    if (opportunity < 0.33 && input.precipitation < 0.22) return;

    const gridX = Math.floor(input.playerX / 360);
    const gridZ = Math.floor(input.playerZ / 360);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = gridX + dx;
        const cz = gridZ + dz;
        const key = `${cx},${cz}`;
        if (this.banks.has(key)) continue;
        const rng = makeRng((hashString(input.seed) ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0);
        if (rng() > opportunity * 0.38) continue;
        const kind: FogBankKind = input.temperature <= 0 ? "freezing" : input.waterNearby > 0.45 ? "river" : input.valleyFactor > 0.45 ? "valley" : nightBoost > 0.5 ? "radiation" : "advection";
        this.banks.set(key, {
          id: key,
          x: cx * 360 + (rng() - 0.5) * 210,
          z: cz * 360 + (rng() - 0.5) * 210,
          radius: 130 + rng() * 260 + opportunity * 180,
          density: clamp(0.18 + opportunity * 0.62 + input.precipitation * 0.22, 0, 0.92),
          age: 0,
          life: 90 + rng() * 220,
          kind,
        });
      }
    }
  }

  private sample(x: number, z: number, humidity: number, precipitation: number): EnvironmentFogState {
    let bankDensity = 0;
    let nearest = Number.POSITIVE_INFINITY;
    let kind: FogBankKind | "none" = "none";
    for (const bank of this.banks.values()) {
      const d = Math.hypot(bank.x - x, bank.z - z);
      nearest = Math.min(nearest, d);
      const inside = 1 - smoothstep(bank.radius * 0.15, bank.radius, d);
      const density = inside * bank.density;
      if (density > bankDensity) {
        bankDensity = density;
        kind = bank.kind;
      }
    }
    const weatherMist = clamp((humidity - 0.82) * 1.35 + precipitation * 0.32, 0, 0.42);
    const density = clamp(Math.max(bankDensity, weatherMist), 0, 1);
    const visibilityMeters = Math.round(1800 - density * 1650);
    return {
      density,
      visibilityMeters,
      bankDensity,
      nearestBankDistance: Number.isFinite(nearest) ? nearest : -1,
      kind,
    };
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
