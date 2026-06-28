export interface TerrainInfluence {
  orographicLift: number;
  rainShadow: number;
  ridgeWindBoost: number;
  valleyFogBias: number;
}

export type HeightSampler = (x: number, z: number) => number;

export class TerrainWeatherInfluence {
  sample(x: number, z: number, windX: number, windZ: number, heightAt: HeightSampler): TerrainInfluence {
    const h = heightAt(x, z);
    const upwindX = x - windX * 12;
    const upwindZ = z - windZ * 12;
    const downwindX = x + windX * 12;
    const downwindZ = z + windZ * 12;
    const upwindSlope = h - heightAt(upwindX, upwindZ);
    const downwindSlope = heightAt(downwindX, downwindZ) - h;
    return {
      orographicLift: Math.max(0, Math.min(1, upwindSlope / 18)),
      rainShadow: Math.max(0, Math.min(1, -downwindSlope / 18)),
      ridgeWindBoost: Math.max(0, Math.min(0.45, (h - 72) / 90)),
      valleyFogBias: Math.max(0, Math.min(0.38, (70 - h) / 40)),
    };
  }
}
