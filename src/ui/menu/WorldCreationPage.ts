import type { GameMode } from "../../player/GameMode";
import type { SeasonId } from "../../living/SeasonSystem";
import type { QualityPreset } from "../../game/Settings";
import { button, field, focusPrimary, MenuPage, selectInput, textInput } from "./MenuPage";

export type MainMenuNewWorldOptions = {
  name: string;
  seed?: string;
  gameMode: GameMode;
  difficulty: "peaceful" | "normal" | "hard";
  startSeason: SeasonId | "auto";
  startWeather: "clear" | "cloudy" | "rain" | "snow" | "fog";
  startTime: "sunrise" | "day" | "noon" | "sunset" | "night";
  dynamicWeather: boolean;
  dynamicSeasons: boolean;
  renderDistance: number;
  quality: QualityPreset;
  worldQuality: "standard" | "large" | "wild";
};

export class WorldCreationPage implements MenuPage {
  readonly route = "create" as const;
  readonly element = document.createElement("section");
  private step = 0;
  private readonly body = document.createElement("div");
  private readonly progress = document.createElement("div");
  private readonly nameInput = textInput("world-name-input", "Mon monde", 48);
  private readonly seedInput = textInput("world-seed-input", "auto", 96);
  private readonly modeSelect = selectInput<GameMode>("world-mode-select", [
    { value: "creative", label: "Creatif" },
    { value: "survival", label: "Survie" },
  ]);
  private readonly difficultySelect = selectInput<"peaceful" | "normal" | "hard">("world-difficulty-select", [
    { value: "peaceful", label: "Paisible" },
    { value: "normal", label: "Normale" },
    { value: "hard", label: "Difficile" },
  ]);
  private readonly seasonSelect = selectInput<SeasonId | "auto">("world-season-select", [
    { value: "auto", label: "Auto" },
    { value: "spring", label: "Printemps" },
    { value: "summer", label: "Ete" },
    { value: "autumn", label: "Automne" },
    { value: "winter", label: "Hiver" },
  ]);
  private readonly weatherSelect = selectInput<MainMenuNewWorldOptions["startWeather"]>("world-weather-select", [
    { value: "clear", label: "Clair" },
    { value: "cloudy", label: "Nuageux" },
    { value: "rain", label: "Pluie" },
    { value: "snow", label: "Neige" },
    { value: "fog", label: "Brouillard" },
  ]);
  private readonly timeSelect = selectInput<MainMenuNewWorldOptions["startTime"]>("world-time-select", [
    { value: "sunrise", label: "Lever du soleil" },
    { value: "day", label: "Matin" },
    { value: "noon", label: "Midi" },
    { value: "sunset", label: "Coucher" },
    { value: "night", label: "Nuit" },
  ]);
  private readonly qualitySelect = selectInput<QualityPreset>("world-quality-preset", [
    { value: "balanced", label: "Equilibree" },
    { value: "high", label: "Elevee" },
    { value: "low", label: "Legere" },
  ]);
  private readonly worldQualitySelect = selectInput<MainMenuNewWorldOptions["worldQuality"]>("world-quality-select", [
    { value: "standard", label: "Standard" },
    { value: "large", label: "Grandes regions" },
    { value: "wild", label: "Sauvage" },
  ]);
  private readonly renderDistance = document.createElement("input");
  private readonly dynamicWeather = document.createElement("input");
  private readonly dynamicSeasons = document.createElement("input");
  private readonly error = document.createElement("p");

  constructor(private readonly callbacks: { back: () => void; create: (options: MainMenuNewWorldOptions) => void }) {
    this.element.className = "menu-create-page";
    const header = document.createElement("header");
    header.className = "menu-page-header";
    header.innerHTML = `<div><span>Nouveau monde</span><h2>Creation</h2></div>`;
    header.appendChild(button("Retour", callbacks.back, "secondary"));
    this.progress.className = "creation-progress";
    this.body.className = "creation-step-body";
    this.error.className = "form-error";
    this.renderDistance.type = "range";
    this.renderDistance.min = "2";
    this.renderDistance.max = "16";
    this.renderDistance.value = "6";
    this.dynamicWeather.type = "checkbox";
    this.dynamicWeather.checked = true;
    this.dynamicSeasons.type = "checkbox";
    this.dynamicSeasons.checked = true;
    this.element.append(header, this.progress, this.body, this.error);
    this.renderStep();
  }

  focusPrimary(): void {
    focusPrimary(this.element);
  }

  private renderStep(): void {
    this.progress.innerHTML = ["Identite", "Regles", "Confirmation"].map((label, index) =>
      `<span class="${index === this.step ? "active" : index < this.step ? "done" : ""}">${index + 1}. ${label}</span>`
    ).join("");
    this.body.textContent = "";
    this.error.textContent = "";
    if (this.step === 0) this.renderIdentity();
    if (this.step === 1) this.renderRules();
    if (this.step === 2) this.renderConfirm();
  }

  private renderIdentity(): void {
    const randomSeed = button("Seed aleatoire", () => {
      this.seedInput.value = `xima-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)}`;
    }, "secondary");
    const copySeed = button("Copier seed", () => {
      void navigator.clipboard?.writeText(this.seedInput.value.trim() || "auto");
    }, "secondary");
    const row = document.createElement("div");
    row.className = "form-row";
    row.append(randomSeed, copySeed);
    const actions = this.stepButtons(false);
    this.body.append(field("Nom du monde", this.nameInput), field("Seed", this.seedInput), row, actions);
  }

  private renderRules(): void {
    const toggles = document.createElement("div");
    toggles.className = "toggle-grid";
    toggles.append(
      checkboxLabel("Meteo dynamique", this.dynamicWeather),
      checkboxLabel("Saisons dynamiques", this.dynamicSeasons),
    );
    const distanceLabel = document.createElement("label");
    const distanceValue = document.createElement("span");
    distanceValue.textContent = this.renderDistance.value;
    this.renderDistance.addEventListener("input", () => { distanceValue.textContent = this.renderDistance.value; });
    distanceLabel.append("Distance de rendu recommandee ", distanceValue, this.renderDistance);
    const grid = document.createElement("div");
    grid.className = "form-grid";
    grid.append(
      field("Mode", this.modeSelect),
      field("Difficulte", this.difficultySelect),
      field("Saison de depart", this.seasonSelect),
      field("Meteo de depart", this.weatherSelect),
      field("Heure", this.timeSelect),
      field("Qualite visuelle", this.qualitySelect),
      field("Qualite monde", this.worldQualitySelect),
      distanceLabel,
    );
    this.body.append(grid, toggles, this.stepButtons(true));
  }

  private renderConfirm(): void {
    const options = this.options();
    const summary = document.createElement("div");
    summary.className = "creation-summary";
    summary.innerHTML = `
      <h3>${escapeText(options.name)}</h3>
      <p>Seed ${escapeText(options.seed || "auto")}</p>
      <dl>
        <div><dt>Mode</dt><dd>${options.gameMode}</dd></div>
        <div><dt>Saison</dt><dd>${options.startSeason}</dd></div>
        <div><dt>Meteo</dt><dd>${options.startWeather}</dd></div>
        <div><dt>Heure</dt><dd>${options.startTime}</dd></div>
        <div><dt>Qualite</dt><dd>${options.quality} / ${options.renderDistance} chunks</dd></div>
      </dl>
    `;
    const actions = document.createElement("div");
    actions.className = "form-actions";
    actions.append(
      button("Retour", () => { this.step = 1; this.renderStep(); }, "secondary"),
      button("Creer et jouer", () => this.submit(), "", true),
    );
    this.body.append(summary, actions);
  }

  private stepButtons(showBack: boolean): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "form-actions";
    if (showBack) {
      actions.appendChild(button("Retour", () => { this.step -= 1; this.renderStep(); }, "secondary"));
    }
    actions.appendChild(button("Suivant", () => this.next(), "", true));
    return actions;
  }

  private next(): void {
    if (this.step === 0 && !this.nameInput.value.trim()) {
      this.error.textContent = "Donne un nom a ton monde.";
      this.nameInput.focus();
      return;
    }
    this.step = Math.min(2, this.step + 1);
    this.renderStep();
  }

  private submit(): void {
    this.callbacks.create(this.options());
  }

  private options(): MainMenuNewWorldOptions {
    return {
      name: this.nameInput.value.trim() || "Nouveau monde",
      seed: this.seedInput.value.trim() || undefined,
      gameMode: this.modeSelect.value as GameMode,
      difficulty: this.difficultySelect.value as MainMenuNewWorldOptions["difficulty"],
      startSeason: this.seasonSelect.value as MainMenuNewWorldOptions["startSeason"],
      startWeather: this.weatherSelect.value as MainMenuNewWorldOptions["startWeather"],
      startTime: this.timeSelect.value as MainMenuNewWorldOptions["startTime"],
      dynamicWeather: this.dynamicWeather.checked,
      dynamicSeasons: this.dynamicSeasons.checked,
      renderDistance: Number(this.renderDistance.value),
      quality: this.qualitySelect.value as QualityPreset,
      worldQuality: this.worldQualitySelect.value as MainMenuNewWorldOptions["worldQuality"],
    };
  }
}

function checkboxLabel(label: string, input: HTMLInputElement): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = "toggle-label";
  wrapper.append(input, document.createTextNode(label));
  return wrapper;
}

function escapeText(value: string): string {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
