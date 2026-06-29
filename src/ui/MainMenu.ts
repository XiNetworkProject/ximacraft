import type { GameSettingsSnapshot, QualityPreset } from "../game/Settings";
import { WorldSummary } from "../world/SaveManager";
import { MainMenuBackground } from "./MainMenuBackground";
import { CreditsPage } from "./menu/CreditsPage";
import { MainMenuHome } from "./menu/MainMenuHome";
import { MenuRouter } from "./menu/MenuRouter";
import { MainMenuNewWorldOptions, WorldCreationPage } from "./menu/WorldCreationPage";
import { LoadingStepId, WorldLoadingPage } from "./menu/WorldLoadingPage";
import { SettingsPage } from "./menu/SettingsPage";
import { WorldSelectPage } from "./menu/WorldSelectPage";

export type { MainMenuNewWorldOptions } from "./menu/WorldCreationPage";

const MENU_TIPS = [
  "Astuce - T ou / ouvre la console de commandes.",
  "Astuce - la meteo est regionale : observe ce qui arrive au loin.",
  "Astuce - M ouvre la carte radar meteo.",
  "Astuce - les routes et villages sont determines par la seed.",
  "Astuce - apres la pluie, le sol garde une memoire humide.",
  "Astuce - Escape revient a la page precedente dans les menus.",
];

export class MainMenu {
  readonly root: HTMLDivElement;
  private readonly background = new MainMenuBackground();
  private readonly router = new MenuRouter();
  private readonly content = document.createElement("div");
  private readonly home: MainMenuHome;
  private readonly worldsPage: WorldSelectPage;
  private readonly createPage: WorldCreationPage;
  private readonly loadingPage = new WorldLoadingPage();
  private readonly settingsPage: SettingsPage;
  private readonly creditsPage: CreditsPage;
  private readonly tipElement = document.createElement("p");
  private worlds: WorldSummary[] = [];
  private tipTimer = 0;
  private tipIndex = 0;
  private pauseReturn = false;
  private settings: GameSettingsSnapshot;

  constructor(
    overlay: HTMLElement,
    private readonly callbacks: {
      newGame: (options: MainMenuNewWorldOptions) => void;
      loadWorld: (worldId: string) => void;
      deleteWorld: (worldId: string) => void;
      renameWorld: (worldId: string, name: string) => void;
      duplicateWorld: (worldId: string) => void;
      save: () => void;
      openCommands: () => void;
      refreshWorlds: () => void;
      setQuality: (quality: QualityPreset) => void;
      setRenderDistance: (distance: number) => void;
      applySettings: (settings: GameSettingsSnapshot) => GameSettingsSnapshot;
      resetSettings: () => GameSettingsSnapshot;
      showPause: () => void;
    },
    initialSettings: GameSettingsSnapshot,
  ) {
    this.settings = initialSettings;
    this.root = document.createElement("div");
    this.root.className = "main-menu-shell";
    this.content.className = "menu-route-stack";

    this.home = new MainMenuHome({
      continueWorld: (worldId) => this.openLoadingForWorld(worldId),
      openWorlds: () => this.router.navigate("worlds"),
      openSettings: () => this.router.navigate("settings"),
      openCredits: () => this.router.navigate("credits"),
    });
    this.worldsPage = new WorldSelectPage({
      back: () => this.back(),
      createWorld: () => this.router.navigate("create"),
      play: (worldId) => this.openLoadingForWorld(worldId),
      rename: (worldId, name) => this.callbacks.renameWorld(worldId, name),
      duplicate: (worldId) => this.callbacks.duplicateWorld(worldId),
      delete: (worldId) => this.callbacks.deleteWorld(worldId),
      refresh: () => this.callbacks.refreshWorlds(),
    });
    this.createPage = new WorldCreationPage({
      back: () => this.back(),
      create: (options) => {
        this.showLoading(options.name, options.seed ?? "auto");
        this.callbacks.newGame(options);
      },
    });
    this.settingsPage = new SettingsPage(this.settings, {
      back: () => this.back(),
      apply: (settings) => {
        this.settings = this.callbacks.applySettings(settings);
      },
      reset: () => this.callbacks.resetSettings(),
    });
    this.creditsPage = new CreditsPage({ back: () => this.back() });

    for (const page of [this.home, this.worldsPage, this.createPage, this.loadingPage, this.settingsPage, this.creditsPage]) {
      this.router.register(page);
      this.content.appendChild(page.element);
    }

    this.background.canvas.classList.add("main-menu-bg");
    this.root.append(this.background.canvas, this.content, this.footer());
    overlay.appendChild(this.root);
    this.root.addEventListener("keydown", this.onKeyDown, true);
    this.router.navigate("home", true);
    this.background.start();
    this.startTips();
  }

  show(): void {
    this.pauseReturn = false;
    this.root.classList.remove("hidden");
    this.background.start();
    this.startTips();
    this.router.clearHistory();
    this.router.navigate("home", true);
    this.router.focusPrimary();
  }

  showSettingsFromPause(): void {
    this.pauseReturn = true;
    this.root.classList.remove("hidden");
    this.background.start();
    this.startTips();
    this.router.clearHistory();
    this.router.navigate("settings", true);
  }

  showWorldsFromPause(): void {
    this.pauseReturn = false;
    this.root.classList.remove("hidden");
    this.background.start();
    this.startTips();
    this.router.clearHistory();
    this.router.navigate("worlds", true);
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.background.stop();
    this.stopTips();
  }

  isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  renderWorlds(worlds: WorldSummary[]): void {
    this.worlds = worlds;
    this.home.setWorlds(worlds);
    this.worldsPage.setWorlds(worlds);
  }

  setSettings(quality: QualityPreset, renderDistance: number): void {
    this.settings = { ...this.settings, quality, renderDistance };
    this.settingsPage.setSettings(this.settings);
  }

  setSettingsSnapshot(settings: GameSettingsSnapshot): void {
    this.settings = settings;
    this.settingsPage.setSettings(settings);
  }

  showLoading(worldName: string, seed: string): void {
    this.root.classList.remove("hidden");
    this.background.start();
    this.loadingPage.reset(worldName, seed);
    this.router.navigate("loading", true);
  }

  setLoadingProgress(step: LoadingStepId, progress: number): void {
    this.loadingPage.setProgress(step, progress);
  }

  completeLoading(): void {
    this.loadingPage.complete();
  }

  failLoading(message: string): void {
    this.loadingPage.fail(message);
  }

  private openLoadingForWorld(worldId: string): void {
    const world = this.worlds.find((item) => item.id === worldId);
    this.showLoading(world?.name ?? "Monde", world?.seed ?? "seed inconnue");
    this.callbacks.loadWorld(worldId);
  }

  private back(): void {
    if (this.router.current === "loading") return;
    if (this.pauseReturn && this.router.current === "settings") {
      this.pauseReturn = false;
      this.hide();
      this.callbacks.showPause();
      return;
    }
    this.router.back("home");
  }

  private footer(): HTMLElement {
    const footer = document.createElement("footer");
    footer.className = "main-menu-footer";
    const version = document.createElement("span");
    version.className = "menu-version";
    version.textContent = "XimaCraft - v0.1";
    this.tipElement.className = "menu-tip";
    this.tipElement.textContent = MENU_TIPS[0];
    footer.append(version, this.tipElement);
    return footer;
  }

  private startTips(): void {
    this.stopTips();
    this.tipTimer = window.setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % MENU_TIPS.length;
      this.tipElement.classList.add("fading");
      window.setTimeout(() => {
        this.tipElement.textContent = MENU_TIPS[this.tipIndex];
        this.tipElement.classList.remove("fading");
      }, 220);
    }, 6500);
  }

  private stopTips(): void {
    if (!this.tipTimer) return;
    clearInterval(this.tipTimer);
    this.tipTimer = 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.root.classList.contains("hidden")) return;
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.back();
      return;
    }
    if (event.code === "Enter" && event.target === this.root) {
      const primary = this.root.querySelector<HTMLButtonElement>(".menu-page.active [data-primary='true']:not(:disabled)");
      primary?.click();
    }
  };
}
