import { focusPrimary, MenuPage } from "./MenuPage";
import { createXimaCraftLogo } from "./XimaCraftLogo";

export type LoadingStepId =
  | "textures"
  | "seed"
  | "terrain"
  | "climate"
  | "environment"
  | "chunks"
  | "weather"
  | "enter";

export type LoadingStepState = {
  id: LoadingStepId;
  label: string;
  done: boolean;
};

const DEFAULT_STEPS: LoadingStepState[] = [
  { id: "textures", label: "Chargement des textures", done: false },
  { id: "seed", label: "Preparation de la seed", done: false },
  { id: "terrain", label: "Generation du terrain", done: false },
  { id: "climate", label: "Planification du climat", done: false },
  { id: "environment", label: "Creation de l'environnement", done: false },
  { id: "chunks", label: "Chargement des chunks de depart", done: false },
  { id: "weather", label: "Preparation de la meteo", done: false },
  { id: "enter", label: "Entree dans le monde", done: false },
];

export class WorldLoadingPage implements MenuPage {
  readonly route = "loading" as const;
  readonly element = document.createElement("section");
  private readonly title = document.createElement("h2");
  private readonly seed = document.createElement("p");
  private readonly bar = document.createElement("i");
  private readonly stepList = document.createElement("ol");
  private readonly tip = document.createElement("p");
  private steps = DEFAULT_STEPS.map((step) => ({ ...step }));

  constructor() {
    this.element.className = "menu-loading-page";
    this.element.appendChild(createXimaCraftLogo(true));
    this.title.textContent = "Chargement";
    this.seed.className = "loading-seed";
    const progress = document.createElement("div");
    progress.className = "loading-progress";
    progress.appendChild(this.bar);
    this.stepList.className = "loading-steps";
    this.tip.className = "loading-tip";
    this.tip.textContent = "Astuce : observe les nuages au loin, les fronts se deplacent vraiment.";
    this.element.append(this.title, this.seed, progress, this.stepList, this.tip);
    this.reset("Monde", "auto");
  }

  reset(name: string, seed: string): void {
    this.steps = DEFAULT_STEPS.map((step) => ({ ...step }));
    this.title.textContent = `Chargement de ${name}`;
    this.seed.textContent = `Seed ${seed}`;
    this.setProgress("textures", 0);
  }

  setProgress(activeStep: LoadingStepId, progress: number): void {
    const activeIndex = this.steps.findIndex((step) => step.id === activeStep);
    this.steps = this.steps.map((step, index) => ({ ...step, done: activeIndex >= 0 && index < activeIndex }));
    const totalProgress = Math.max(0, Math.min(1, (Math.max(0, activeIndex) + progress) / this.steps.length));
    this.bar.style.width = `${Math.round(totalProgress * 100)}%`;
    this.renderSteps(activeStep);
  }

  complete(): void {
    this.steps = this.steps.map((step) => ({ ...step, done: true }));
    this.bar.style.width = "100%";
    this.renderSteps("enter");
  }

  fail(message: string): void {
    this.tip.textContent = message;
    this.element.classList.add("failed");
  }

  focusPrimary(): void {
    focusPrimary(this.element);
  }

  private renderSteps(activeStep: LoadingStepId): void {
    this.stepList.textContent = "";
    for (const step of this.steps) {
      const item = document.createElement("li");
      item.className = step.done ? "done" : step.id === activeStep ? "active" : "";
      item.textContent = step.label;
      this.stepList.appendChild(item);
    }
  }
}
