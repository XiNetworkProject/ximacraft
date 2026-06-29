import { EnvironmentState } from "../environment/EnvironmentState";
import { WeatherType } from "../weather/WeatherTypes";

export class BiomeAmbienceDirector {
  resolve(environment: EnvironmentState): string {
    if (environment.weatherType === WeatherType.THUNDERSTORM) return "storm-muted-wildlife";
    if (environment.surface.snowDepth > 0.12 || environment.season.season === "winter") return "snow-silence-wind";
    if (environment.fog.density > 0.35) return "fog-dampened";
    if (environment.riverLevel > 0.62) return "riverbank-active";
    if (environment.fauna.insects > environment.fauna.birds) return "insects-warm";
    if (environment.fauna.birds > 0.45) return "morning-birds";
    return "quiet-biome";
  }
}
