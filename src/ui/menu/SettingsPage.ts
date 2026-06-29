import { GameSettingsSnapshot, normalizeSettings, QualityPreset } from "../../game/Settings";
import { button, focusPrimary, MenuPage } from "./MenuPage";

type SettingsTab = "video" | "audio" | "controls" | "accessibility";

export class SettingsPage implements MenuPage {
  readonly route = "settings" as const;
  readonly element = document.createElement("section");
  private readonly tabs = document.createElement("div");
  private readonly body = document.createElement("div");
  private activeTab: SettingsTab = "video";
  private settings: GameSettingsSnapshot;

  constructor(
    initial: GameSettingsSnapshot,
    private readonly callbacks: {
      back: () => void;
      apply: (settings: GameSettingsSnapshot) => void;
      reset: () => GameSettingsSnapshot;
    },
  ) {
    this.settings = normalizeSettings(initial);
    this.element.className = "menu-settings-page";
    const header = document.createElement("header");
    header.className = "menu-page-header";
    header.innerHTML = `<div><span>Options</span><h2>Parametres</h2></div>`;
    header.appendChild(button("Retour", callbacks.back, "secondary"));
    this.tabs.className = "settings-tabs";
    this.body.className = "settings-body";
    this.element.append(header, this.tabs, this.body);
    this.render();
  }

  setSettings(settings: GameSettingsSnapshot): void {
    this.settings = normalizeSettings(settings);
    this.render();
  }

  focusPrimary(): void {
    focusPrimary(this.element);
  }

  private render(): void {
    this.renderTabs();
    this.body.textContent = "";
    if (this.activeTab === "video") this.video();
    if (this.activeTab === "audio") this.audio();
    if (this.activeTab === "controls") this.controls();
    if (this.activeTab === "accessibility") this.accessibility();
    const actions = document.createElement("div");
    actions.className = "settings-actions";
    actions.append(
      button("Reinitialiser", () => {
        this.settings = this.callbacks.reset();
        this.commit();
        this.render();
      }, "secondary"),
      button("Appliquer", () => this.commit(), "", true),
    );
    this.body.appendChild(actions);
  }

  private renderTabs(): void {
    this.tabs.textContent = "";
    const tabs: Array<[SettingsTab, string]> = [
      ["video", "Video"],
      ["audio", "Audio"],
      ["controls", "Controles"],
      ["accessibility", "Accessibilite"],
    ];
    for (const [tab, label] of tabs) {
      const tabButton = document.createElement("button");
      tabButton.type = "button";
      tabButton.textContent = label;
      tabButton.className = tab === this.activeTab ? "active" : "";
      tabButton.addEventListener("click", () => {
        this.activeTab = tab;
        this.render();
      });
      this.tabs.appendChild(tabButton);
    }
  }

  private video(): void {
    this.body.append(
      range("Distance de rendu", this.settings.renderDistance, 2, 16, 1, (v) => { this.settings.renderDistance = v; this.commit(); }),
      choice("Qualite generale", this.settings.quality, qualityOptions(), (v) => { this.settings.quality = v; this.commit(); }),
      choice("Nuages", this.settings.cloudQuality, qualityOptions(), (v) => { this.settings.cloudQuality = v; this.commit(); }),
      choice("Brouillard", this.settings.fogQuality, qualityOptions(), (v) => { this.settings.fogQuality = v; this.commit(); }),
      choice("Eau", this.settings.waterQuality, qualityOptions(), (v) => { this.settings.waterQuality = v; this.commit(); }),
      choice("Particules", this.settings.particles, qualityOptions(), (v) => { this.settings.particles = v; this.commit(); }),
      toggle("Ombres", this.settings.shadows, (v) => { this.settings.shadows = v; this.commit(); }),
      range("FOV", this.settings.fov, 55, 100, 1, (v) => { this.settings.fov = v; this.commit(); }),
      range("Limite FPS (0 = auto)", this.settings.fpsLimit, 0, 240, 15, (v) => { this.settings.fpsLimit = v; this.commit(); }),
      range("Luminosite", this.settings.brightness, 0.65, 1.45, 0.05, (v) => { this.settings.brightness = v; this.commit(); }),
      range("Echelle interface", this.settings.uiScale, 0.85, 1.25, 0.05, (v) => { this.settings.uiScale = v; this.commit(); }),
    );
  }

  private audio(): void {
    this.body.append(
      range("General", this.settings.masterVolume, 0, 1, 0.05, (v) => { this.settings.masterVolume = v; this.commit(); }),
      range("Interface", this.settings.uiVolume, 0, 1, 0.05, (v) => { this.settings.uiVolume = v; this.commit(); }),
      range("Ambiance", this.settings.ambienceVolume, 0, 1, 0.05, (v) => { this.settings.ambienceVolume = v; this.commit(); }),
      range("Meteo", this.settings.weatherVolume, 0, 1, 0.05, (v) => { this.settings.weatherVolume = v; this.commit(); }),
      range("Creatures", this.settings.creaturesVolume, 0, 1, 0.05, (v) => { this.settings.creaturesVolume = v; this.commit(); }),
      range("Effets", this.settings.effectsVolume, 0, 1, 0.05, (v) => { this.settings.effectsVolume = v; this.commit(); }),
      range("Musique", this.settings.musicVolume, 0, 1, 0.05, (v) => { this.settings.musicVolume = v; this.commit(); }),
      range("Tonnerre", this.settings.thunderVolume, 0, 1, 0.05, (v) => { this.settings.thunderVolume = v; this.commit(); }),
    );
  }

  private controls(): void {
    this.body.append(
      range("Sensibilite souris", this.settings.mouseSensitivity, 0.0008, 0.006, 0.0001, (v) => { this.settings.mouseSensitivity = v; this.commit(); }),
      toggle("Inverser axe Y", this.settings.invertY, (v) => { this.settings.invertY = v; this.commit(); }),
      choice("Clavier", this.settings.keyboardLayout, [
        ["azerty", "AZERTY"],
        ["qwerty", "QWERTY"],
      ], (v) => { this.settings.keyboardLayout = v; this.commit(); }),
      toggle("Sprint toggle", this.settings.sprintToggle, (v) => { this.settings.sprintToggle = v; this.commit(); }),
      toggle("Vol creatif", this.settings.creativeFlight, (v) => { this.settings.creativeFlight = v; this.commit(); }),
    );
  }

  private accessibility(): void {
    this.body.append(
      range("Taille du texte", this.settings.textScale, 0.9, 1.3, 0.05, (v) => { this.settings.textScale = v; this.commit(); }),
      choice("Contraste", this.settings.contrast, [
        ["normal", "Normal"],
        ["high", "Eleve"],
      ], (v) => { this.settings.contrast = v; this.commit(); }),
      toggle("Reduire animations", this.settings.reducedMotion, (v) => { this.settings.reducedMotion = v; this.commit(); }),
      toggle("Reduire flashs de foudre", this.settings.reducedLightning, (v) => { this.settings.reducedLightning = v; this.commit(); }),
      toggle("Secousses camera", this.settings.cameraShake, (v) => { this.settings.cameraShake = v; this.commit(); }),
      toggle("Sous-titres", this.settings.subtitles, (v) => { this.settings.subtitles = v; this.commit(); }),
      choice("Daltonisme", this.settings.colorBlindMode, [
        ["none", "Aucun"],
        ["deuteranopia", "Deuteranopie"],
        ["protanopia", "Protanopie"],
        ["tritanopia", "Tritanopie"],
      ], (v) => { this.settings.colorBlindMode = v; this.commit(); }),
    );
  }

  private commit(): void {
    this.settings = normalizeSettings(this.settings);
    this.callbacks.apply(this.settings);
  }
}

function qualityOptions(): Array<[QualityPreset, string]> {
  return [["low", "Legere"], ["balanced", "Equilibree"], ["high", "Elevee"]];
}

function range(label: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "setting-row";
  const top = document.createElement("span");
  const valueLabel = document.createElement("b");
  valueLabel.textContent = Number(value).toFixed(step < 1 ? 2 : 0);
  top.append(label, valueLabel);
  const input = document.createElement("input");
  input.type = "range";
  input.min = `${min}`;
  input.max = `${max}`;
  input.step = `${step}`;
  input.value = `${value}`;
  input.addEventListener("input", () => {
    const next = Number(input.value);
    valueLabel.textContent = next.toFixed(step < 1 ? 2 : 0);
    onChange(next);
  });
  wrapper.append(top, input);
  return wrapper;
}

function toggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "setting-row switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.append(document.createTextNode(label), input);
  return wrapper;
}

function choice<T extends string>(label: string, value: T, options: Array<[T, string]>, onChange: (value: T) => void): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "setting-row";
  const select = document.createElement("select");
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value as T));
  wrapper.append(label, select);
  return wrapper;
}
