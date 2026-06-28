export type WeatherType =
  | "clear"
  | "cloudy"
  | "overcast"
  | "rain"
  | "storm"
  | "thunderstorm"
  | "snow"
  | "blizzard"
  | "hail"
  | "fog"
  | "rainbow"
  | "mist";

export type MoonPhase = "new" | "quarter" | "full";

export type WeatherSaveData = {
  current: WeatherType;
  target: WeatherType;
  intensity: number;
  targetIntensity: number;
  durationRemaining: number;
  cloudDensity: number;
  wind: number;
  visibility: number;
  moonPhase: MoonPhase;
  automatic: boolean;
};
