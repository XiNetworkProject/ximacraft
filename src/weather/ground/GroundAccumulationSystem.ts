/**
 * Accumulation et fonte au sol : neige, grêle, humidité, glace.
 *
 * (Regroupe ce que le cahier des charges éclate en SnowAccumulationSystem /
 * SnowMeltSystem / HailAccumulationSystem / GroundWetnessSystem / IcePatchSystem
 * — même logique, un seul orchestrateur cohérent ; on pourra le redécouper.)
 *
 * Principe :
 *  - on échantillonne la météo au-dessus du joueur (précip uniforme à l'échelle
 *    de quelques dizaines de blocs, donc 1 échantillon suffit) ;
 *  - si précipitation : on ACCUMULE sur les colonnes proches ;
 *  - sinon (ou si chaud) : on FAIT FONDRE / SÉCHER les colonnes existantes ;
 *  - la grêle et la neige fondues deviennent de l'humidité (puis flaques) ;
 *  - en dessous de 0 °C l'humidité gèle en glace.
 *
 * `forcePrecip` permet aux commandes (blizzard, snow_squall, hailstorm) de
 * garantir une précipitation pendant une durée, indépendamment de la physique
 * de température (qui ne modélise pas encore les masses d'air froides).
 */

import { SurfaceWeatherState } from "./SurfaceWeatherState";
import { WeatherSample, PrecipKind } from "../WeatherTypes";
import { clamp01 } from "../WeatherMath";
import { PrecipitationKind, PrecipitationState } from "../scene/WeatherScene";

const GROUND_RADIUS = 10; // rayon (blocs) de simulation/visuel au sol autour du joueur
const PRUNE_RADIUS = 72; // au-delà : colonnes vides oubliées
const TICK = 0.5; // pas d'accumulation (s) — throttle

// Taux (par seconde, à intensité 1).
const RATES = {
  snowGain: 0.032,
  hailGain: 0.06,
  wetGain: 0.4,
  snowMeltPerDeg: 0.00012, // La neige tient plusieurs minutes, même par temps doux.
  hailMelt: 0.02, // fonte régulière de la grêle
  wetDry: 0.03,
  freeze: 0.06,
  iceMeltPerDeg: 0.01,
};

interface PrecipOverride {
  kind: PrecipKind;
  intensity: number;
  secondsLeft: number;
}

export class GroundAccumulationSystem {
  private accumulator = 0;
  private override: PrecipOverride | null = null;

  constructor(readonly state: SurfaceWeatherState) {}

  /** Force une précipitation (commandes). */
  forcePrecip(kind: PrecipKind, intensity: number, seconds: number): void {
    this.override = { kind, intensity: clamp01(intensity), secondsLeft: seconds };
  }

  clearOverride(): void {
    this.override = null;
    this.accumulator = 0;
  }

  get forcedPrecipitation(): Readonly<{ kind: PrecipKind; intensity: number }> | null {
    return this.override;
  }

  /**
   * @param meltBoost 0..1 — accélère la fonte le jour (soleil). Optionnel.
   */
  update(
    dt: number,
    sample: WeatherSample,
    ox: number,
    oz: number,
    meltBoost = 0.5,
    scenePrecip: Readonly<PrecipitationState> | null = null,
    sceneTemperature?: number,
  ): void {
    this.accumulator += dt;
    if (this.accumulator < TICK) return;
    const step = this.accumulator;
    this.accumulator = 0;

    if (this.override) {
      this.override.secondsLeft -= step;
      if (this.override.secondsLeft <= 0) this.override = null;
    }

    const kind = this.precipKind(sample, scenePrecip);
    const sceneReachesGround = scenePrecip?.reachesGround === true;
    const intensity = this.override
      ? this.override.intensity
      : Math.max(sample.precipitation, sceneReachesGround ? scenePrecip.intensity : 0);
    const temperature = sceneTemperature ?? sample.temperature;
    const freezingRain = !this.override && sceneReachesGround && scenePrecip?.kind === PrecipitationKind.FREEZING_RAIN;
    const now = performance.now() / 1000;

    // 1) Évolution (fonte/séchage/gel) de TOUTES les colonnes mémorisées.
    this.state.forEach((col) => this.evolve(col, temperature, kind, meltBoost, step));

    // 2) Accumulation sur les colonnes proches s'il précipite.
    if (kind !== "none" && intensity > 0.02) {
      for (let dx = -GROUND_RADIUS; dx <= GROUND_RADIUS; dx += 1) {
        for (let dz = -GROUND_RADIUS; dz <= GROUND_RADIUS; dz += 1) {
          if (dx * dx + dz * dz > GROUND_RADIUS * GROUND_RADIUS) continue;
          const col = this.state.ensure(ox + dx, oz + dz, now);
          this.accumulate(col, kind, intensity, step);
          if (freezingRain) {
            const freeze = Math.min(0.05, intensity * 0.018 * step);
            col.iceDepth = Math.min(1, col.iceDepth + freeze);
            col.wetness = Math.min(1, col.wetness + intensity * 0.08 * step);
          }
          col.lastTouched = now;
        }
      }
    }

    this.state.prune(ox | 0, oz | 0, PRUNE_RADIUS);
  }

  /** Détermine le type de précipitation actif (override prioritaire). */
  private precipKind(sample: WeatherSample, scenePrecip: Readonly<PrecipitationState> | null): PrecipKind {
    if (this.override) return this.override.kind;
    if (scenePrecip?.reachesGround && scenePrecip.intensity > 0.01) {
      switch (scenePrecip.kind) {
        case PrecipitationKind.SNOW_FLURRIES:
        case PrecipitationKind.LIGHT_SNOW:
        case PrecipitationKind.STEADY_SNOW:
        case PrecipitationKind.SNOW_SHOWER:
        case PrecipitationKind.SNOW_SQUALL:
        case PrecipitationKind.BLOWING_SNOW:
          return "snow";
        case PrecipitationKind.HAIL:
        case PrecipitationKind.GRAUPEL:
          return "hail";
        case PrecipitationKind.NONE:
        case PrecipitationKind.DUST:
        case PrecipitationKind.SAND:
          return "none";
        default:
          return "rain";
      }
    }
    if (sample.precipitation < 0.05) return "none";
    if (sample.temperature <= 1) return "snow";
    if (sample.thunderRisk > 0.6 && sample.precipitation > 0.55 && sample.temperature < 18) return "hail";
    return "rain";
  }

  private accumulate(col: { snowDepth: number; hailDepth: number; wetness: number }, kind: PrecipKind, intensity: number, dt: number): void {
    switch (kind) {
      case "snow":
        col.snowDepth = Math.min(1.5, col.snowDepth + RATES.snowGain * intensity * dt);
        break;
      case "hail":
        col.hailDepth = Math.min(0.8, col.hailDepth + RATES.hailGain * intensity * dt);
        col.wetness = Math.min(1, col.wetness + RATES.wetGain * 0.3 * intensity * dt);
        break;
      case "rain":
        col.wetness = Math.min(1, col.wetness + RATES.wetGain * intensity * dt);
        break;
      case "none":
        break;
    }
  }

  /** Fonte / séchage / gel d'une colonne. */
  private evolve(
    col: { snowDepth: number; hailDepth: number; wetness: number; iceDepth: number },
    temperature: number,
    activeKind: PrecipKind,
    meltBoost: number,
    dt: number,
  ): void {
    const warmth = Math.max(0, temperature);
    const sun = 1 + meltBoost; // le soleil accélère la fonte

    // Neige : fond si > 0 °C (sauf s'il neige activement) → devient humidité.
    if (col.snowDepth > 0 && temperature > 0 && activeKind !== "snow") {
      const melt = Math.min(col.snowDepth, RATES.snowMeltPerDeg * warmth * sun * dt);
      col.snowDepth -= melt;
      col.wetness = Math.min(1, col.wetness + melt * 0.6);
    }

    // Grêle : fond régulièrement dès qu'il ne gèle pas → eau.
    if (col.hailDepth > 0 && temperature > -1 && activeKind !== "hail") {
      const melt = Math.min(col.hailDepth, RATES.hailMelt * (0.5 + warmth * 0.1) * sun * dt);
      col.hailDepth -= melt;
      col.wetness = Math.min(1, col.wetness + melt * 0.8);
    }

    // Humidité : gèle en glace si froid, sinon sèche lentement à la chaleur.
    if (temperature < 0 && col.wetness > 0.15) {
      const f = Math.min(col.wetness, RATES.freeze * dt);
      col.wetness -= f;
      col.iceDepth = Math.min(1, col.iceDepth + f);
    } else if (col.wetness > 0 && activeKind === "none" && temperature > 4) {
      col.wetness = Math.max(0, col.wetness - RATES.wetDry * dt);
    }

    // Glace : fond si > 0 °C → humidité.
    if (col.iceDepth > 0 && temperature > 0) {
      const melt = Math.min(col.iceDepth, RATES.iceMeltPerDeg * warmth * sun * dt);
      col.iceDepth -= melt;
      col.wetness = Math.min(1, col.wetness + melt);
    }
  }

  // --- Commandes /weather ground -------------------------------------------

  /** Pose une couche sur les colonnes d'un disque (set_snow/set_hail). */
  setLayer(kind: "snow" | "hail" | "ice", depth: number, cx: number, cz: number, radius: number): number {
    return this.forEachInDisk(cx, cz, radius, (col) => {
      if (kind === "snow") col.snowDepth = depth;
      else if (kind === "hail") col.hailDepth = depth;
      else col.iceDepth = depth;
    });
  }

  /** Mouille / assèche un disque. */
  setWetness(value: number, cx: number, cz: number, radius: number): number {
    return this.forEachInDisk(cx, cz, radius, (col) => (col.wetness = value));
  }

  /** Fait fondre la neige d'un disque (→ humidité). */
  meltSnow(cx: number, cz: number, radius: number): number {
    return this.forEachInDisk(cx, cz, radius, (col) => {
      col.wetness = Math.min(1, col.wetness + col.snowDepth * 0.5);
      col.snowDepth = 0;
    });
  }

  private forEachInDisk(cx: number, cz: number, radius: number, fn: (col: ReturnType<SurfaceWeatherState["ensure"]>) => void): number {
    const now = performance.now() / 1000;
    const r = Math.min(radius, GROUND_RADIUS * 2); // borne visuelle utile
    let n = 0;
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        if (dx * dx + dz * dz > r * r) continue;
        fn(this.state.ensure(cx + dx, cz + dz, now));
        n += 1;
      }
    }
    return n;
  }
}
