import { WorldSummary } from "../../world/SaveManager";
import { button, focusPrimary, MenuPage } from "./MenuPage";
import { createXimaCraftLogo } from "./XimaCraftLogo";

const SCENE_LABELS = [
  "Brume matinale - foret ancienne",
  "Eclaircie d'ete - collines ouvertes",
  "Coucher de soleil - vallee humide",
  "Nuit claire - plateau etoile",
];

export class MainMenuHome implements MenuPage {
  readonly route = "home" as const;
  readonly element = document.createElement("section");
  private readonly continueButton: HTMLButtonElement;
  private readonly sceneLabel = document.createElement("span");
  private worlds: WorldSummary[] = [];

  constructor(
    callbacks: {
      continueWorld: (worldId: string) => void;
      openWorlds: () => void;
      openSettings: () => void;
      openCredits: () => void;
    },
  ) {
    this.element.className = "menu-home";
    this.element.appendChild(createXimaCraftLogo());
    const subtitle = document.createElement("p");
    subtitle.className = "menu-lead";
    subtitle.textContent = "Un monde voxel vivant, meteo regionale, saisons, exploration et construction.";
    const actions = document.createElement("div");
    actions.className = "main-menu-actions";
    this.continueButton = button("Continuer", () => {
      const recent = this.worlds[0];
      if (recent) callbacks.continueWorld(recent.id);
    }, "", true);
    actions.append(
      this.continueButton,
      button("Jouer", callbacks.openWorlds, "secondary", true),
      button("Parametres", callbacks.openSettings, "secondary"),
      button("Credits", callbacks.openCredits, "secondary"),
    );
    const meta = document.createElement("div");
    meta.className = "home-scene-label";
    this.sceneLabel.textContent = SCENE_LABELS[0];
    meta.append("Scene : ", this.sceneLabel);
    this.element.append(subtitle, actions, meta);
    window.setInterval(() => {
      const index = Math.floor(performance.now() / 16000) % SCENE_LABELS.length;
      this.sceneLabel.textContent = SCENE_LABELS[index];
    }, 3000);
  }

  setWorlds(worlds: WorldSummary[]): void {
    this.worlds = worlds;
    this.continueButton.disabled = worlds.length === 0;
    this.continueButton.title = worlds[0] ? `Charger ${worlds[0].name}` : "Aucun monde recent";
  }

  focusPrimary(): void {
    focusPrimary(this.element);
  }
}
