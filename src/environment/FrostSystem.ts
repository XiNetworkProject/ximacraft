export interface FrostInput {
  surfaceTemperature: number;
  dewPoint: number;
  humidity: number;
  windSpeed: number;
  dayFactor: number;
  snowDepth: number;
  iceDepth: number;
}

export class FrostSystem {
  resolve(input: FrostInput): number {
    const saturation = input.dewPoint > input.surfaceTemperature - 0.8 ? 1 : 0;
    const calm = Math.max(0, 1 - input.windSpeed / 7);
    const cold = Math.max(0, -input.surfaceTemperature / 9);
    const night = 1 - input.dayFactor;
    return Math.min(1, input.iceDepth * 0.65 + input.snowDepth * 0.2 + saturation * cold * calm * (0.45 + night * 0.55) * input.humidity);
  }
}
