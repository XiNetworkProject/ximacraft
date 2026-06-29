import { DEFAULT_RENDER_DISTANCE } from "../utils/Constants";

export type QualityPreset = "low" | "balanced" | "high";

export type GameSettingsSnapshot = {
  quality: QualityPreset;
  renderDistance: number;
  cloudQuality: QualityPreset;
  fogQuality: QualityPreset;
  waterQuality: QualityPreset;
  particles: QualityPreset;
  shadows: boolean;
  fov: number;
  fpsLimit: number;
  brightness: number;
  uiScale: number;
  masterVolume: number;
  uiVolume: number;
  ambienceVolume: number;
  weatherVolume: number;
  creaturesVolume: number;
  effectsVolume: number;
  musicVolume: number;
  thunderVolume: number;
  mouseSensitivity: number;
  invertY: boolean;
  keyboardLayout: "azerty" | "qwerty";
  sprintToggle: boolean;
  creativeFlight: boolean;
  textScale: number;
  contrast: "normal" | "high";
  reducedMotion: boolean;
  reducedLightning: boolean;
  cameraShake: boolean;
  subtitles: boolean;
  colorBlindMode: "none" | "deuteranopia" | "protanopia" | "tritanopia";
};

const SETTINGS_STORAGE_KEY = "ximacraft-settings-v2";

export const DEFAULT_GAME_SETTINGS: GameSettingsSnapshot = {
  quality: "balanced",
  renderDistance: DEFAULT_RENDER_DISTANCE,
  cloudQuality: "balanced",
  fogQuality: "balanced",
  waterQuality: "balanced",
  particles: "balanced",
  shadows: true,
  fov: 75,
  fpsLimit: 0,
  brightness: 1,
  uiScale: 1,
  masterVolume: 1,
  uiVolume: 0.8,
  ambienceVolume: 0.8,
  weatherVolume: 0.85,
  creaturesVolume: 0.75,
  effectsVolume: 0.85,
  musicVolume: 0,
  thunderVolume: 0.85,
  mouseSensitivity: 0.0023,
  invertY: false,
  keyboardLayout: "azerty",
  sprintToggle: false,
  creativeFlight: true,
  textScale: 1,
  contrast: "normal",
  reducedMotion: false,
  reducedLightning: false,
  cameraShake: true,
  subtitles: false,
  colorBlindMode: "none",
};

export const Settings = {
  renderDistance: DEFAULT_RENDER_DISTANCE,
  mouseSensitivity: 0.0023,
  maxPixelRatio: 1.15,
  initialFov: 75,
  brightness: 1,
  uiScale: 1,
  reducedMotion: false,
  reducedLightning: false,
};

export class GameSettingsStore {
  static load(): GameSettingsSnapshot {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GAME_SETTINGS };
    try {
      return normalizeSettings(JSON.parse(raw) as Partial<GameSettingsSnapshot>);
    } catch {
      return { ...DEFAULT_GAME_SETTINGS };
    }
  }

  static save(settings: GameSettingsSnapshot): void {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  }

  static applyToRuntime(settings: GameSettingsSnapshot): void {
    Settings.renderDistance = clampRound(settings.renderDistance, 2, 16);
    Settings.initialFov = clampRound(settings.fov, 55, 100);
    Settings.mouseSensitivity = clamp(settings.mouseSensitivity, 0.0008, 0.006);
    Settings.brightness = clamp(settings.brightness, 0.65, 1.45);
    Settings.uiScale = clamp(settings.uiScale, 0.85, 1.25);
    Settings.reducedMotion = settings.reducedMotion;
    Settings.reducedLightning = settings.reducedLightning;
    document.documentElement.style.setProperty("--ui-scale", Settings.uiScale.toFixed(2));
    document.documentElement.style.setProperty("--game-brightness", Settings.brightness.toFixed(2));
    document.documentElement.dataset.uiContrast = settings.contrast;
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
    document.documentElement.dataset.subtitles = String(settings.subtitles);
    document.documentElement.dataset.colorBlindMode = settings.colorBlindMode;
  }
}

export function normalizeSettings(input: Partial<GameSettingsSnapshot>): GameSettingsSnapshot {
  const base = { ...DEFAULT_GAME_SETTINGS, ...input };
  return {
    ...base,
    quality: normalizeQuality(base.quality),
    cloudQuality: normalizeQuality(base.cloudQuality),
    fogQuality: normalizeQuality(base.fogQuality),
    waterQuality: normalizeQuality(base.waterQuality),
    particles: normalizeQuality(base.particles),
    renderDistance: clampRound(base.renderDistance, 2, 16),
    fov: clampRound(base.fov, 55, 100),
    fpsLimit: clampRound(base.fpsLimit, 0, 240),
    brightness: clamp(base.brightness, 0.65, 1.45),
    uiScale: clamp(base.uiScale, 0.85, 1.25),
    masterVolume: clamp(base.masterVolume, 0, 1),
    uiVolume: clamp(base.uiVolume, 0, 1),
    ambienceVolume: clamp(base.ambienceVolume, 0, 1),
    weatherVolume: clamp(base.weatherVolume, 0, 1),
    creaturesVolume: clamp(base.creaturesVolume, 0, 1),
    effectsVolume: clamp(base.effectsVolume, 0, 1),
    musicVolume: clamp(base.musicVolume, 0, 1),
    thunderVolume: clamp(base.thunderVolume, 0, 1),
    mouseSensitivity: clamp(base.mouseSensitivity, 0.0008, 0.006),
    keyboardLayout: base.keyboardLayout === "qwerty" ? "qwerty" : "azerty",
    contrast: base.contrast === "high" ? "high" : "normal",
    colorBlindMode: ["deuteranopia", "protanopia", "tritanopia"].includes(base.colorBlindMode)
      ? base.colorBlindMode
      : "none",
  };
}

function normalizeQuality(value: unknown): QualityPreset {
  return value === "low" || value === "high" ? value : "balanced";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function clampRound(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
