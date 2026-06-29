export interface DewInput {
  surfaceTemperature: number;
  dewPoint: number;
  humidity: number;
  windSpeed: number;
  dayFactor: number;
  precipitation: number;
}

export class DewSystem {
  resolve(input: DewInput): number {
    if (input.surfaceTemperature <= 0 || input.precipitation > 0.06) return 0;
    const saturation = Math.max(0, 1 - Math.max(0, input.surfaceTemperature - input.dewPoint) / 2.2);
    const calm = Math.max(0, 1 - input.windSpeed / 6);
    const morning = Math.max(0, 1 - input.dayFactor * 1.3);
    return Math.min(1, saturation * calm * morning * Math.max(0, input.humidity - 0.58) * 1.8);
  }
}
