import { Noise } from "../../utils/Noise";
import type { SettlementPlan } from "../RegionPlanner";

export type SettlementLink = {
  dx: number;
  dz: number;
  importance: number;
};

export class SettlementGraph {
  constructor(private readonly noise: Noise) {}

  linksFor(cellX: number, cellZ: number, plan: SettlementPlan): SettlementLink[] {
    const links: SettlementLink[] = [];
    const candidates: Array<[number, number, number]> = [
      [1, 0, 0.88],
      [0, 1, 0.88],
      [-1, 0, 0.54],
      [0, -1, 0.54],
      [1, 1, 0.32],
      [-1, 1, 0.24],
    ];

    for (const [dx, dz, base] of candidates) {
      const roll = this.noise.random2D(cellX * 593 + dx * 41 + 17, cellZ * 593 + dz * 47 - 29);
      const chance = base + (plan.kind === "village" ? 0.2 : 0);
      if (roll < chance) {
        links.push({ dx, dz, importance: plan.kind === "village" ? 0.78 : 0.48 });
      }
    }
    return links;
  }

  importance(a: SettlementPlan, b: SettlementPlan, seed = 0): number {
    const base = a.kind === "village" && b.kind === "village" ? 0.95 : a.kind === "village" || b.kind === "village" ? 0.72 : 0.42;
    const noise = this.noise.random2D(a.centerX * 0.031 + b.centerX * 0.047 + seed, a.centerZ * 0.031 - b.centerZ * 0.047 - seed);
    return Math.min(1, base + noise * 0.18);
  }
}
