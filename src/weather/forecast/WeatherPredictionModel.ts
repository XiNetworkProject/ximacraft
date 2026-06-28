import { WeatherEvent } from "../events/WeatherEvent";
import { WeatherEventPhase } from "../events/WeatherEventPhase";
import { WeatherSample, WeatherType } from "../WeatherTypes";
import { clamp01 } from "../WeatherMath";
import { confidenceForLead } from "./ForecastConfidence";
import { ForecastRegion } from "./ForecastRegion";
import { ForecastSnapshot } from "./ForecastSnapshot";

export interface EventTiming {
  event?: WeatherEvent;
  etaSeconds?: number;
  departureSeconds?: number;
  volatility: number;
}

export class WeatherPredictionModel {
  snapshot(leadSeconds: number, region: ForecastRegion, sample: WeatherSample, timing: EventTiming): ForecastSnapshot {
    const rainRisk = this.rainRisk(sample);
    const snowRisk = this.snowRisk(sample);
    const thunderRisk = clamp01(Math.max(sample.thunderRisk, sample.instability * sample.precipitation));
    const hailRisk = clamp01(thunderRisk * sample.precipitation * (sample.temperature < 18 ? 0.75 : 0.35));
    const fogRisk = clamp01((sample.humidity - 0.72) * 2.4 + (1 - sample.windSpeed / 12) * 0.2);
    const volatility = Math.max(timing.volatility, thunderRisk, Math.abs(1013 - sample.pressure) / 28);

    return {
      leadSeconds,
      region,
      weatherType: sample.weatherType,
      temperature: sample.temperature,
      humidity: sample.humidity,
      pressure: sample.pressure,
      windX: sample.windX,
      windZ: sample.windZ,
      windSpeed: sample.windSpeed,
      rainRisk,
      thunderRisk,
      snowRisk,
      hailRisk,
      fogRisk,
      dominantEventId: timing.event?.id,
      etaSeconds: timing.etaSeconds,
      departureSeconds: timing.departureSeconds,
      confidence: confidenceForLead(leadSeconds, volatility),
    };
  }

  eventTiming(events: readonly WeatherEvent[], x: number, z: number): EventTiming {
    let best: WeatherEvent | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    let etaSeconds: number | undefined;
    let departureSeconds: number | undefined;
    let volatility = 0;

    for (const event of events) {
      const dx = x - event.x;
      const dz = z - event.z;
      const distance = Math.hypot(dx, dz);
      const edgeDistance = distance - event.radius;
      const approachingSpeed = -(dx * event.dirX + dz * event.dirZ) / Math.max(1, distance) * event.speed;
      const eventEta = edgeDistance <= 0 ? 0 : approachingSpeed > 0.1 ? edgeDistance / approachingSpeed : undefined;
      const score = eventEta !== undefined ? eventEta : distance / Math.max(1, event.radius);

      volatility = Math.max(volatility, event.intensity * (event.phase === WeatherEventPhase.MATURE ? 0.7 : 0.45));
      if (score < bestDistance) {
        bestDistance = score;
        best = event;
        etaSeconds = eventEta;
        departureSeconds = edgeDistance <= 0 && event.speed > 0 ? Math.max(30, (event.radius - distance) / event.speed) : undefined;
      }
    }

    return { event: best, etaSeconds, departureSeconds, volatility };
  }

  private rainRisk(sample: WeatherSample): number {
    if (sample.temperature <= 1) return 0;
    return clamp01(sample.precipitation * 0.85 + sample.cloudCover * sample.humidity * 0.25);
  }

  private snowRisk(sample: WeatherSample): number {
    const cold = clamp01((2 - sample.temperature) / 8);
    return clamp01(cold * (sample.precipitation * 0.9 + sample.cloudCover * sample.humidity * 0.25));
  }
}
