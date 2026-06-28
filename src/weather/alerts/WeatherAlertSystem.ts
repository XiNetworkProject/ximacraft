import { ForecastSnapshot } from "../forecast/ForecastSnapshot";
import { ForecastTimeline } from "../forecast/ForecastTimeline";
import { WeatherEventType } from "../WeatherTypes";
import { WeatherEngine } from "../WeatherEngine";
import { WeatherAlert, WeatherAlertType } from "./WeatherAlert";
import { WeatherAlertLevel, strongerAlertLevel } from "./WeatherAlertLevel";

type AlertDraft = Omit<WeatherAlert, "id">;

export class WeatherAlertSystem {
  private readonly manualAlerts = new Map<string, WeatherAlert>();
  private currentAlerts: WeatherAlert[] = [];

  update(timeline: ForecastTimeline, engine?: WeatherEngine): WeatherAlert[] {
    const generated: WeatherAlert[] = [];
    for (const snapshot of timeline.snapshots) {
      this.evaluateSnapshot(snapshot).forEach((draft) => generated.push(this.withId(draft)));
    }

    if (engine) {
      for (const event of engine.getActiveEvents()) {
        if (event.type === WeatherEventType.SQUALL_LINE) {
          generated.push(
            this.withId({
              type: "squall_line",
              level: event.intensity > 0.9 ? "RED" : "ORANGE",
              region: { id: `event-${event.id}`, name: "Ligne d'orage", x: event.x, z: event.z, radius: event.radius },
              startsAt: engine.state.time,
              endsAt: engine.state.time + Math.max(30, event.maxAge - event.age),
              probability: event.intensity,
              description: "Une ligne d'orages organisee traverse la zone.",
              advice: "Surveille les rafales, la foudre et les rideaux de pluie.",
              linkedEventId: event.id,
            }),
          );
        }
      }
    }

    const merged = new Map<string, WeatherAlert>();
    for (const alert of [...generated, ...this.manualAlerts.values()]) {
      const key = `${alert.type}:${alert.region.id}:${alert.linkedEventId ?? "manual"}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, alert);
        continue;
      }
      merged.set(key, {
        ...existing,
        level: strongerAlertLevel(existing.level, alert.level),
        startsAt: Math.min(existing.startsAt, alert.startsAt),
        endsAt: Math.max(existing.endsAt, alert.endsAt),
        probability: Math.max(existing.probability, alert.probability),
      });
    }

    this.currentAlerts = [...merged.values()].sort((a, b) => this.levelRank(b.level) - this.levelRank(a.level));
    return this.currentAlerts;
  }

  list(): WeatherAlert[] {
    return this.currentAlerts;
  }

  createManual(type: WeatherAlertType, level: WeatherAlertLevel, x: number, z: number, radius: number): WeatherAlert {
    const alert = this.withId({
      type,
      level,
      region: { id: `manual-${Math.round(x)}-${Math.round(z)}-${radius}`, name: "Zone manuelle", x, z, radius },
      startsAt: performance.now() / 1000,
      endsAt: performance.now() / 1000 + 30 * 60,
      probability: 1,
      description: `Alerte manuelle ${type}.`,
      advice: "Observation creee pour test/cinematique.",
    });
    this.manualAlerts.set(alert.id, alert);
    return alert;
  }

  private evaluateSnapshot(snapshot: ForecastSnapshot): AlertDraft[] {
    const out: AlertDraft[] = [];
    const baseTime = snapshot.leadSeconds;
    this.pushRisk(out, snapshot, "heavy_rain", snapshot.rainRisk, "Pluie forte possible.", "Evite les zones basses et surveille les flaques.", baseTime);
    this.pushRisk(out, snapshot, "storm", snapshot.thunderRisk, "Orage en approche ou actif.", "Cherche un abri et surveille les eclairs.", baseTime);
    this.pushRisk(out, snapshot, "lightning", snapshot.thunderRisk * 0.9, "Risque de foudre.", "Reste loin des points hauts.", baseTime);
    this.pushRisk(out, snapshot, "hail", snapshot.hailRisk, "Grele possible.", "Attention au sol blanchi et glissant.", baseTime);
    this.pushRisk(out, snapshot, "snow", snapshot.snowRisk, "Neige probable.", "La neige peut tenir au sol si le froid persiste.", baseTime);
    this.pushRisk(out, snapshot, "dense_fog", snapshot.fogRisk, "Brouillard dense possible.", "La visibilite peut chuter rapidement.", baseTime);
    if (snapshot.windSpeed > 18) {
      this.pushRisk(out, snapshot, "high_wind", Math.min(1, snapshot.windSpeed / 30), "Vent violent attendu.", "Les rafales peuvent pousser pluie, neige et grele.", baseTime);
    }
    if (snapshot.temperature < -3 && snapshot.rainRisk > 0.3) {
      this.pushRisk(out, snapshot, "ice", Math.min(1, snapshot.rainRisk + 0.25), "Risque de verglas.", "Le sol humide peut geler.", baseTime);
    }
    return out;
  }

  private pushRisk(
    out: AlertDraft[],
    snapshot: ForecastSnapshot,
    type: WeatherAlertType,
    probability: number,
    description: string,
    advice: string,
    leadSeconds: number,
  ): void {
    const level = this.levelForProbability(probability);
    if (!level) return;
    out.push({
      type,
      level,
      region: snapshot.region,
      startsAt: leadSeconds,
      endsAt: leadSeconds + 45 * 60,
      probability,
      description,
      advice,
      linkedEventId: snapshot.dominantEventId,
    });
  }

  private levelForProbability(value: number): WeatherAlertLevel | null {
    if (value >= 0.92) return "RED";
    if (value >= 0.72) return "ORANGE";
    if (value >= 0.46) return "YELLOW";
    if (value >= 0.28) return "INFO";
    return null;
  }

  private withId(alert: AlertDraft): WeatherAlert {
    const id = `${alert.type}:${alert.region.id}:${alert.linkedEventId ?? "none"}:${Math.round(alert.startsAt / 60)}`;
    return { id, ...alert };
  }

  private levelRank(level: WeatherAlertLevel): number {
    return ["INFO", "YELLOW", "ORANGE", "RED", "EXTREME"].indexOf(level);
  }
}
