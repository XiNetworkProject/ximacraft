import * as THREE from "three";

export enum ConvectiveVisualPhase {
  FAIR_CUMULUS = "FAIR_CUMULUS",
  BUILDING_CUMULUS = "BUILDING_CUMULUS",
  TOWERING_CUMULUS = "TOWERING_CUMULUS",
  CB_CALVUS = "CB_CALVUS",
  CB_MATURE = "CB_MATURE",
  PRECIPITATING = "PRECIPITATING",
  DECAYING = "DECAYING",
  ANVIL_REMAINS = "ANVIL_REMAINS",
}

/** Invisible control cell used to shape one broad convective tower. */
export interface ConvectiveUpdraft {
  readonly center: THREE.Vector2;
  readonly anchor: THREE.Vector2;
  strength: number;
  radius: number;
  onset: number;
}

export interface ConvectiveShapeState {
  phase: ConvectiveVisualPhase;
  /** Continuous 0..1 morphology value; never jumps when the phase label changes. */
  development: number;
  anvilGrowth: number;
  dryAirErosion: number;
  readonly precipitationCore: THREE.Vector2;
  readonly updrafts: ConvectiveUpdraft[];
}

export function createConvectiveShapeState(seed: number): ConvectiveShapeState {
  const updrafts: ConvectiveUpdraft[] = [];
  for (let index = 0; index < 5; index += 1) {
    const angle = seed * 0.017 + index * 2.399963229728653;
    const radial = index === 0 ? 0.11 : 0.2 + hash01(seed, index * 17 + 3) * 0.3;
    const anchor = new THREE.Vector2(Math.cos(angle) * radial, Math.sin(angle) * radial);
    updrafts.push({
      center: anchor.clone(),
      anchor,
      strength: 0,
      radius: 0.19,
      onset: index === 0 ? 0 : 0.07 + index * 0.075 + hash01(seed, index * 31) * 0.045,
    });
  }
  return {
    phase: ConvectiveVisualPhase.FAIR_CUMULUS,
    development: 0,
    anvilGrowth: 0,
    dryAirErosion: 0,
    precipitationCore: new THREE.Vector2(),
    updrafts,
  };
}

function hash01(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
