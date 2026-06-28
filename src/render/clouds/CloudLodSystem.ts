export type CloudVolumeLod = "NEAR" | "MEDIUM" | "FAR" | "HORIZON";
export type CloudRenderQuality = "low" | "balanced" | "high";

const TARGET_STEPS: Record<CloudVolumeLod, number> = {
  NEAR: 56,
  MEDIUM: 34,
  FAR: 24,
  HORIZON: 18,
};

/** Stable cloud LOD selection with distance hysteresis and gradual quality changes. */
export class CloudLodSystem {
  resolveLod(distance: number, current: CloudVolumeLod): CloudVolumeLod {
    switch (current) {
      case "NEAR":
        return distance > 3000 ? "MEDIUM" : "NEAR";
      case "MEDIUM":
        if (distance < 2100) return "NEAR";
        if (distance > 10_500) return "FAR";
        return "MEDIUM";
      case "FAR":
        if (distance < 7800) return "MEDIUM";
        if (distance > 23_000) return "HORIZON";
        return "FAR";
      case "HORIZON":
        return distance < 17_500 ? "FAR" : "HORIZON";
    }
  }

  targetSteps(lod: CloudVolumeLod, quality: CloudRenderQuality, profilePenalty: number): number {
    const qualityOffset = quality === "high" ? 12 : quality === "low" ? -5 : 0;
    return Math.max(18, Math.min(84, TARGET_STEPS[lod] + qualityOffset + profilePenalty));
  }

  smoothSteps(current: number, target: number, dt: number): number {
    const maxChange = Math.max(0.25, dt * 11);
    if (current < target) return Math.min(target, current + maxChange);
    return Math.max(target, current - maxChange);
  }

  densityBakeInterval(lod: CloudVolumeLod, stormy: boolean, quality: CloudRenderQuality): number {
    const qualityFactor = quality === "high" ? 0.78 : quality === "low" ? 1.42 : 1;
    const base = lod === "NEAR" ? 0.34 : lod === "MEDIUM" ? 0.68 : lod === "FAR" ? 1.25 : 2.1;
    return base * qualityFactor * (stormy ? 0.72 : 1);
  }
}
