import { WeatherEngine } from "../WeatherEngine";
import { WeatherWorldState } from "../WeatherWorldState";
import { ForecastRegion, regionAt } from "./ForecastRegion";
import { ForecastSnapshot } from "./ForecastSnapshot";
import { FORECAST_HORIZONS, ForecastTimeline } from "./ForecastTimeline";
import { WeatherPredictionModel } from "./WeatherPredictionModel";

export class ForecastSystem {
  private readonly model = new WeatherPredictionModel();
  private timelineCache: { key: string; timeline: ForecastTimeline } | null = null;

  constructor(private readonly engine: WeatherEngine) {}

  forecastAt(leadSeconds: number, x?: number, z?: number): ForecastSnapshot {
    const o = this.engine.getObserver();
    const region = regionAt(x ?? o.x, z ?? o.z);
    const future = this.simulateFuture(leadSeconds);
    return this.snapshotFromState(future, leadSeconds, region);
  }

  forecastTimeline(x?: number, z?: number, horizons = FORECAST_HORIZONS): ForecastTimeline {
    const generatedAt = this.engine.state.time;
    const o = this.engine.getObserver();
    const region = regionAt(x ?? o.x, z ?? o.z);
    const timeBucket = Math.floor(generatedAt / 2);
    const key = `${region.id}:${timeBucket}:${this.engine.activeEventCount}:${horizons.join(",")}`;
    if (this.timelineCache?.key === key) {
      return this.timelineCache.timeline;
    }
    const snapshots: ForecastSnapshot[] = [];
    const future = this.engine.state.clone();
    let elapsed = 0;

    for (const leadSeconds of horizons) {
      this.advanceState(future, leadSeconds - elapsed);
      elapsed = leadSeconds;
      snapshots.push(this.snapshotFromState(future, leadSeconds, region));
    }

    const timeline = { generatedAt, snapshots };
    this.timelineCache = { key, timeline };
    return timeline;
  }

  forecastSeries(count = 4, intervalSeconds = 300): ForecastSnapshot[] {
    const horizons = Array.from({ length: count }, (_, i) => i * intervalSeconds);
    return this.forecastTimeline(undefined, undefined, horizons).snapshots;
  }

  private simulateFuture(leadSeconds: number): WeatherWorldState {
    const future = this.engine.state.clone();
    this.advanceState(future, leadSeconds);
    return future;
  }

  private advanceState(state: WeatherWorldState, seconds: number): void {
    let remaining = Math.max(0, seconds);
    while (remaining > 0) {
      const step = remaining > 6 * 60 * 60 ? 60 : remaining > 60 * 60 ? 30 : remaining > 15 * 60 ? 15 : 5;
      const dt = Math.min(step, remaining);
      state.update(dt);
      remaining -= dt;
    }
  }

  private snapshotFromState(state: WeatherWorldState, leadSeconds: number, region: ForecastRegion): ForecastSnapshot {
    const sample = state.sampleAt(region.x, region.z);
    const timing = this.model.eventTiming(state.events, region.x, region.z);
    return this.model.snapshot(leadSeconds, region, sample, timing);
  }
}
