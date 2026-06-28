export class AltitudeWeatherModifier {
  temperatureAtAltitude(baseTemperature: number, altitude: number): number {
    return baseTemperature - Math.max(0, altitude - 64) * 0.085;
  }

  windMultiplierAtAltitude(altitude: number): number {
    return 1 + Math.max(0, altitude - 70) * 0.012;
  }

  snowBiasAtAltitude(altitude: number): number {
    return Math.max(0, Math.min(0.45, (altitude - 72) / 80));
  }
}
