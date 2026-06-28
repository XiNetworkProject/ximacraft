export type WeatherRegime =
  | "CLEAR"
  | "MOISTURE_RETURN"
  | "WARM_FRONT"
  | "STRATIFORM_RAIN"
  | "CONVECTIVE_OUTBREAK"
  | "COLD_FRONT"
  | "WINTER_STORM"
  | "CLEARING";

export type WeatherTransitionPlanId =
  | "FAIR_WEATHER"
  | "WARM_FRONT_PASSAGE"
  | "COLD_FRONT_PASSAGE"
  | "ISOLATED_CONVECTION"
  | "WINTER_STORM_PASSAGE";

export interface WeatherTransitionStep {
  regime: WeatherRegime;
  milestone: string;
  durationSeconds: readonly [number, number];
}

export interface WeatherTransitionPlan {
  id: WeatherTransitionPlanId;
  label: string;
  steps: readonly WeatherTransitionStep[];
}

export const WEATHER_TRANSITION_PLANS: Record<WeatherTransitionPlanId, WeatherTransitionPlan> = {
  FAIR_WEATHER: {
    id: "FAIR_WEATHER",
    label: "Fair weather cycle",
    steps: [
      { regime: "CLEAR", milestone: "dry-stable-air", durationSeconds: [140, 260] },
      { regime: "MOISTURE_RETURN", milestone: "scattered-cumulus", durationSeconds: [120, 220] },
      { regime: "CLEARING", milestone: "cumulus-dissipation", durationSeconds: [100, 190] },
    ],
  },
  WARM_FRONT_PASSAGE: {
    id: "WARM_FRONT_PASSAGE",
    label: "Warm front passage",
    steps: [
      { regime: "MOISTURE_RETURN", milestone: "high-cloud-arrival", durationSeconds: [100, 180] },
      { regime: "WARM_FRONT", milestone: "layer-thickening", durationSeconds: [220, 360] },
      { regime: "STRATIFORM_RAIN", milestone: "steady-rain", durationSeconds: [240, 420] },
      { regime: "CLEARING", milestone: "warm-sector-breaks", durationSeconds: [140, 240] },
    ],
  },
  COLD_FRONT_PASSAGE: {
    id: "COLD_FRONT_PASSAGE",
    label: "Cold front passage",
    steps: [
      { regime: "MOISTURE_RETURN", milestone: "prefrontal-haze", durationSeconds: [100, 170] },
      { regime: "CONVECTIVE_OUTBREAK", milestone: "prefrontal-convection", durationSeconds: [180, 300] },
      { regime: "COLD_FRONT", milestone: "frontal-line", durationSeconds: [180, 300] },
      { regime: "CLEARING", milestone: "cold-air-cumulus", durationSeconds: [150, 260] },
    ],
  },
  ISOLATED_CONVECTION: {
    id: "ISOLATED_CONVECTION",
    label: "Isolated convection",
    steps: [
      { regime: "CLEAR", milestone: "morning-stability", durationSeconds: [100, 180] },
      { regime: "MOISTURE_RETURN", milestone: "cumulus-field", durationSeconds: [100, 170] },
      { regime: "CONVECTIVE_OUTBREAK", milestone: "isolated-cell", durationSeconds: [220, 360] },
      { regime: "CLEARING", milestone: "outflow-and-clearing", durationSeconds: [130, 240] },
    ],
  },
  WINTER_STORM_PASSAGE: {
    id: "WINTER_STORM_PASSAGE",
    label: "Winter storm passage",
    steps: [
      { regime: "MOISTURE_RETURN", milestone: "cold-moisture-return", durationSeconds: [130, 220] },
      { regime: "WARM_FRONT", milestone: "snow-shield-arrival", durationSeconds: [180, 300] },
      { regime: "WINTER_STORM", milestone: "snow-and-wind-core", durationSeconds: [320, 520] },
      { regime: "CLEARING", milestone: "snow-showers-ending", durationSeconds: [170, 280] },
    ],
  },
};
