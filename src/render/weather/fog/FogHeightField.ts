import { SEA_LEVEL } from "../../../utils/Constants";
import type { EnvironmentState } from "../../../environment/EnvironmentState";
import type { FogBankRenderSample } from "../../../environment/FogBankSystem";

export interface FogHeightProfile {
  groundY: number;
  baseY: number;
  topY: number;
  reliefCeilingY: number;
  valleyFactor: number;
}

export class FogHeightField {
  profileFor(
    sample: FogBankRenderSample,
    getHeight: (x: number, z: number) => number,
    environment: EnvironmentState | null,
  ): FogHeightProfile {
    const groundY = getHeight(sample.x, sample.z);
    const probe = Math.max(48, Math.min(sample.radius * 0.55, 220));
    const ring = [
      getHeight(sample.x + probe, sample.z),
      getHeight(sample.x - probe, sample.z),
      getHeight(sample.x, sample.z + probe),
      getHeight(sample.x, sample.z - probe),
      getHeight(sample.x + probe * 0.7, sample.z + probe * 0.7),
      getHeight(sample.x - probe * 0.7, sample.z - probe * 0.7),
    ];
    const ridgeLift = ring.reduce((sum, h) => sum + Math.max(0, h - groundY), 0) / ring.length;
    const valleyFactor = Math.min(1, ridgeLift / 34);
    const sunBurn = environment ? environment.sunExposure * (0.18 + environment.dayFactor * 0.26) : 0.15;
    const freezingBoost = sample.kind === "freezing" ? 0.22 : 0;
    const waterBoost = sample.kind === "river" ? 0.26 : 0;
    const rainBoost = sample.kind === "rain_mist" ? 0.42 : 0;
    const stratusBoost = sample.kind === "low_stratus" ? 0.82 : 0;
    const baseOffset =
      sample.kind === "low_stratus" ? 1.2 :
      sample.kind === "rain_mist" ? 2.4 :
      sample.kind === "advection" ? 5.5 :
      sample.kind === "river" ? 1.5 :
      sample.kind === "freezing" ? 0.7 :
      0.35;
    const depth = Math.max(
      3.5,
      5 + sample.density * 18 + valleyFactor * 20 + waterBoost * 14 + freezingBoost * 10 + rainBoost * 22 + stratusBoost * 58 - sunBurn * 8,
    );
    const reliefCeilingY = valleyFactor > 0.2
      ? Math.max(groundY + 5, Math.min(Math.min(...ring) - 2, groundY + 12 + ridgeLift * 0.68))
      : groundY + depth + 12;
    const baseY = Math.max(SEA_LEVEL + 0.35, groundY + baseOffset);
    const lowCloudCeiling = sample.kind === "low_stratus" ? groundY + depth : reliefCeilingY;
    const topY = Math.max(baseY + 2.4, Math.min(baseY + depth, lowCloudCeiling));
    return { groundY, baseY, topY, reliefCeilingY, valleyFactor };
  }
}
