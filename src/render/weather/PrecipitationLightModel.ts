import * as THREE from "three";

export type PrecipitationVisualKind = "rain" | "snow" | "hail";

export interface PrecipitationLighting {
  dayFactor: number;
  lightning: number;
}

const NIGHT_COLORS: Record<PrecipitationVisualKind, THREE.Color> = {
  rain: new THREE.Color(0x1f2c38),
  snow: new THREE.Color(0x4f5d68),
  hail: new THREE.Color(0x566673),
};

const DAY_COLORS: Record<PrecipitationVisualKind, THREE.Color> = {
  rain: new THREE.Color(0x8ea4b2),
  snow: new THREE.Color(0xaebbc4),
  hail: new THREE.Color(0xa8b5bf),
};

const FLASH_COLOR = new THREE.Color(0xdce9f7);

export function precipitationColor(
  kind: PrecipitationVisualKind,
  lighting: PrecipitationLighting,
  target: THREE.Color,
): THREE.Color {
  const day = THREE.MathUtils.clamp(lighting.dayFactor, 0, 1);
  const flash = THREE.MathUtils.clamp(lighting.lightning, 0, 1);
  target.lerpColors(NIGHT_COLORS[kind], DAY_COLORS[kind], 0.16 + day * 0.84);
  return target.lerp(FLASH_COLOR, flash * 0.72);
}

export function precipitationOpacity(
  kind: PrecipitationVisualKind,
  intensity: number,
  lighting: PrecipitationLighting,
): number {
  const base = kind === "rain"
    ? 0.07 + intensity * 0.32
    : kind === "snow"
      ? 0.11 + intensity * 0.24
      : 0.14 + intensity * 0.3;
  const nightAttenuation = THREE.MathUtils.lerp(0.62, 1, THREE.MathUtils.clamp(lighting.dayFactor, 0, 1));
  return base * nightAttenuation + THREE.MathUtils.clamp(lighting.lightning, 0, 1) * 0.16;
}
