import { clamp, hashString, makeRng } from "../utils/MathUtils";
import { EnvironmentFogState, FogBankKind } from "./EnvironmentState";
import { FogField, FogFieldState } from "./FogField";

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

export interface FogBankRenderSample {
  id: string;
  x: number;
  z: number;
  radius: number;
  density: number;
  kind: FogBankKind;
  mode?: FogFieldState["mode"];
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
  cloudCover?: number;
  waterNearby: number;
  valleyFactor: number;
  playerY?: number;
  surfaceY?: number;
}

export class FogBankSystem {
  private readonly banks = new Map<string, FogBank>();
  private readonly field = new FogField();
  private spawnTimer = 0;
  private lastField: FogFieldState | null = null;

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
    return this.sample(input);
  }

  debug(): string {
    const list = [...this.banks.values()]
      .sort((a, b) => b.density - a.density)
      .slice(0, 4)
      .map((b) => `${b.kind}@${Math.round(b.x)},${Math.round(b.z)} d=${b.density.toFixed(2)} r=${Math.round(b.radius)}`)
      .join(" | ");
    return `FogBanks count=${this.banks.size}${list ? ` ${list}` : ""}`;
  }

  renderSamples(observerX: number, observerZ: number, maxDistance = 2200): FogBankRenderSample[] {
    const maxDistanceSq = maxDistance * maxDistance;
    return [...this.banks.entries()]
      .filter(([, bank]) => bank.density > 0.04 && distanceSq(bank.x, bank.z, observerX, observerZ) <= maxDistanceSq)
      .sort(([, a], [, b]) => distanceSq(a.x, a.z, observerX, observerZ) - distanceSq(b.x, b.z, observerX, observerZ))
      .slice(0, 18)
      .map(([id, bank]) => ({
        id,
        x: bank.x,
        z: bank.z,
        radius: bank.radius,
        density: bank.density,
        kind: bank.kind,
        mode: this.lastField?.mode,
      }));
  }


  clear(): void {
    this.banks.clear();
  }

  private spawnBanks(input: FogBankUpdateInput): void {
    const saturation = clamp(input.humidity * 1.2 - Math.max(0, input.temperature - input.dewPoint) * 0.12, 0, 1);
    const nightBoost = 1 - input.dayFactor;
    const lowStratusChance = saturation * (input.cloudCover ?? 0) * clamp((7 - input.windSpeed) / 7, 0, 1);
    const rainMistChance = clamp(input.precipitation * 1.15 + Math.max(0, input.humidity - 0.78), 0, 1);
    const opportunity = clamp(
      saturation * (0.18 + input.waterNearby * 0.48 + input.valleyFactor * 0.34 + nightBoost * 0.3)
        + rainMistChance * 0.42
        + lowStratusChance * 0.32,
      0,
      1,
    );
    if (opportunity < 0.28 && input.precipitation < 0.16) return;

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
        const kind: FogBankKind =
          input.precipitation > 0.16 ? "rain_mist" :
          lowStratusChance > 0.48 ? "low_stratus" :
          input.temperature <= 0 ? "freezing" :
          input.waterNearby > 0.45 ? "river" :
          input.valleyFactor > 0.45 ? "valley" :
          nightBoost > 0.5 ? "radiation" :
          "advection";
        const broad = kind === "rain_mist" || kind === "low_stratus";
        this.banks.set(key, {
          id: key,
          x: cx * 360 + (rng() - 0.5) * 210,
          z: cz * 360 + (rng() - 0.5) * 210,
          radius: (broad ? 260 : 130) + rng() * (broad ? 420 : 260) + opportunity * (broad ? 260 : 180),
          density: clamp(0.18 + opportunity * 0.62 + input.precipitation * 0.3 + lowStratusChance * 0.16, 0, 0.92),
          age: 0,
          life: (broad ? 150 : 90) + rng() * (broad ? 300 : 220),
          kind,
        });
      }
    }
  }

  private sample(input: FogBankUpdateInput): EnvironmentFogState {
    let bankDensity = 0;
    let nearest = Number.POSITIVE_INFINITY;
    let kind: FogBankKind | "none" = "none";
    const x = input.playerX;
    const z = input.playerZ;
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
    const field = this.field.resolve({
      humidity: input.humidity,
      dewPoint: input.dewPoint,
      temperature: input.temperature,
      windSpeed: input.windSpeed,
      windX: input.windX,
      windZ: input.windZ,
      dayFactor: input.dayFactor,
      precipitation: input.precipitation,
      cloudCover: input.cloudCover ?? 0,
      waterNearby: input.waterNearby,
      valleyFactor: input.valleyFactor,
      playerY: input.playerY ?? 72,
      surfaceY: input.surfaceY ?? 64,
    }, bankDensity, kind);
    this.lastField = field;
    const density = field.density;
    const visibilityMeters = Math.round(clamp(2200 * field.horizonVisibility - density * 520, 80, 2600));
    return {
      density,
      visibilityMeters,
      bankDensity,
      nearestBankDistance: Number.isFinite(nearest) ? nearest : -1,
      kind,
      mode: field.mode,
      baseY: field.baseY,
      topY: field.topY,
      terrainInfluence: field.terrainInfluence,
      horizonVisibility: field.horizonVisibility,
      stratusFogBlend: field.lowStratusBlend,
      windX: field.windX,
      windZ: field.windZ,
      windSpeed: field.windSpeed,
      legacyRendererActive: false,
    };
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function distanceSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
