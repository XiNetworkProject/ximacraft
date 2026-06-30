import * as THREE from "three";
import { GameSoundSystem } from "../assets/GameSoundSystem";
import { TextureManager } from "../assets/TextureManager";
import { CraftingSystem } from "../items/CraftingSystem";
import { ItemRegistry } from "../items/ItemRegistry";
import { SmeltingSystem } from "../items/SmeltingSystem";
import { EntityManager } from "../entities/EntityManager";
import { Player } from "../player/Player";
import { GameMode } from "../player/GameMode";
import { DEFAULT_SEED, PLAYER_EYE_HEIGHT, WORLD_DAY_TICKS } from "../utils/Constants";
import { worldToChunk } from "../utils/MathUtils";
import { BlockRegistry } from "../world/BlockRegistry";
import { BlockId } from "../world/BlockTypes";
import { ChunkManager } from "../world/ChunkManager";
import { CommandSystem } from "../world/CommandSystem";
import { SaveData, SaveManager, WorldSummary } from "../world/SaveManager";
import { SkySystem } from "../world/SkySystem";
import { WeatherSystem } from "../world/WeatherSystem";
import { World } from "../world/World";
import { WeatherEngine } from "../weather/WeatherEngine";
import { WeatherDirector } from "../weather/WeatherDirector";
import { ForecastSystem } from "../weather/forecast/ForecastSystem";
import type { ForecastTimeline } from "../weather/forecast/ForecastTimeline";
import { WeatherAlertSystem } from "../weather/alerts/WeatherAlertSystem";
import { WeatherMapDataBuilder } from "../weather/map/WeatherMapData";
import { BiomeWeatherModifier } from "../weather/biome/BiomeWeatherModifier";
import { WeatherAudioSystem } from "../weather/audio/WeatherAudioSystem";
import { WeatherRenderer } from "../render/weather/WeatherRenderer";
import { FogBankRenderer } from "../render/weather/FogBankRenderer";
import { CloudShadowSystem } from "../render/weather/CloudShadowSystem";
import { WaterWaves } from "../render/weather/WaterWaves";
import { VegetationWind } from "../render/world/VegetationWind";
import { AmbientLifeSystem } from "../render/world/AmbientLifeSystem";
import { AerialPerspective } from "../render/AerialPerspective";
import { CloudSystem } from "../weather/clouds/CloudSystem";
import { SurfaceWeatherState } from "../weather/ground/SurfaceWeatherState";
import { GroundAccumulationSystem } from "../weather/ground/GroundAccumulationSystem";
import { WorldSnowSystem } from "../weather/ground/WorldSnowSystem";
import { GroundCoverRenderer } from "../render/weather/GroundCoverRenderer";
import { PrecipitationRenderer } from "../render/weather/PrecipitationRenderer";
import { RainCurtainRenderer } from "../render/weather/RainCurtainRenderer";
import { LightningSystem } from "../weather/LightningSystem";
import { LightningRenderer } from "../render/weather/LightningRenderer";
import { ConvectiveCloudSystem } from "../clouds/ConvectiveCloudSystem";
import { CloudVolumeRenderer } from "../render/clouds/CloudVolumeRenderer";
import { SkyCloudPopulationRenderer } from "../render/clouds/SkyCloudPopulationRenderer";
import { CloudMass } from "../clouds/CloudMass";
import { RegionalCloudController } from "../clouds/RegionalCloudController";
import { WeatherEventType, CELL_SIZE } from "../weather/WeatherTypes";
import { WeatherEventPhase } from "../weather/events/WeatherEventPhase";
import { WindVisualSystem } from "../render/weather/WindVisualSystem";
import { LocalWeatherFieldTexture } from "../render/weather/LocalWeatherFieldTexture";
import { SeasonSystem } from "../living/SeasonSystem";
import { LivingWorldSystem } from "../living/LivingWorldSystem";
import { AmbientBiomeAudioSystem } from "../living/AmbientBiomeAudioSystem";
import { WorldMemorySystem } from "../living/WorldMemorySystem";
import { EnvironmentDirector } from "../environment/EnvironmentDirector";
import type { EnvironmentState } from "../environment/EnvironmentState";
import { WeatherMapUI } from "../ui/weather/WeatherMapUI";
import { DebugOverlay } from "../ui/DebugOverlay";
import { HotbarUI } from "../ui/HotbarUI";
import { HUD } from "../ui/HUD";
import { InventoryUI } from "../ui/InventoryUI";
import { MainMenu, MainMenuNewWorldOptions } from "../ui/MainMenu";
import type { LoadingStepId } from "../ui/menu/WorldLoadingPage";
import { PauseMenu } from "../ui/PauseMenu";
import { QuickAccessUI } from "../ui/QuickAccessUI";
import { CameraController } from "./CameraController";
import { Input } from "./Input";
import { Renderer } from "./Renderer";
import { DEFAULT_GAME_SETTINGS, GameSettingsSnapshot, GameSettingsStore, normalizeSettings, QualityPreset, Settings } from "./Settings";
import { Time } from "./Time";

type RaycastHit = {
  x: number;
  y: number;
  z: number;
  normal: THREE.Vector3;
};

type StormCloudGroup = { core: CloudMass; feeders: CloudMass[] };
const ALERT_FORECAST_HORIZONS = [0, 5 * 60, 15 * 60, 30 * 60];
const STORM_PHASE_DEVELOPMENT: Record<WeatherEventPhase, number> = {
  [WeatherEventPhase.FORMING]: 0.16,
  [WeatherEventPhase.DEVELOPING]: 0.5,
  [WeatherEventPhase.MATURE]: 0.78,
  [WeatherEventPhase.APPROACHING]: 0.88,
  [WeatherEventPhase.IMPACTING]: 1,
  [WeatherEventPhase.PASSING]: 0.9,
  [WeatherEventPhase.DISSIPATING]: 0.72,
};

export class Game {
  private readonly renderer: Renderer;
  private readonly overlay: HTMLDivElement;
  private readonly input: Input;
  private readonly cameraController: CameraController;
  private readonly blockRegistry = new BlockRegistry();
  private readonly textureManager = new TextureManager();
  private readonly gameAudio = new GameSoundSystem();
  private readonly weatherAudio = new WeatherAudioSystem();
  private readonly saveManager = new SaveManager();
  private readonly time = new Time();
  private readonly player: Player;
  private readonly crafting = new CraftingSystem();
  private readonly smelting = new SmeltingSystem();
  private readonly itemRegistry: ItemRegistry;
  private readonly weather: WeatherSystem;
  private readonly biomeWeather = new BiomeWeatherModifier();
  private readonly weatherEngine = new WeatherEngine({
    baselineProvider: (cellX, cellZ) => this.biomeWeather.baselineForCell(cellX, cellZ, this.world),
  });
  private readonly forecastSystem = new ForecastSystem(this.weatherEngine);
  private readonly weatherDirector = new WeatherDirector(this.weatherEngine);
  private readonly seasonSystem = new SeasonSystem();
  private readonly environmentDirector = new EnvironmentDirector(this.weatherEngine, this.seasonSystem, () => this.currentSeed);
  private readonly alertSystem = new WeatherAlertSystem();
  private readonly weatherMapData = new WeatherMapDataBuilder(this.weatherEngine, this.forecastSystem);
  private readonly weatherRenderer: WeatherRenderer;
  private readonly fogBankRenderer: FogBankRenderer;
  // Ombres de nuages projetées au sol (terrain/feuillage/eau).
  private readonly cloudShadows = new CloudShadowSystem();
  // Vagues d'eau animées.
  private readonly waterWaves = new WaterWaves();
  // Oscillation légère des herbes, fleurs et feuillages.
  private readonly vegetationWind = new VegetationWind();
  private readonly ambientLife: AmbientLifeSystem;
  private readonly livingWorld: LivingWorldSystem;
  private readonly biomeAmbience = new AmbientBiomeAudioSystem();
  private readonly worldMemory = new WorldMemorySystem();
  // Perspective aérienne (profondeur atmosphérique).
  private readonly aerialPerspective = new AerialPerspective();
  private readonly aerialSunColor = new THREE.Color(0xffe9c8);
  private readonly localWeatherField = new LocalWeatherFieldTexture();
  private readonly cloudSystem = new CloudSystem(this.weatherEngine);
  // Météo au sol (neige/grêle/eau persistantes par colonne) + visuels distants.
  private readonly surfaceState = new SurfaceWeatherState((x, z) => (this.world ? this.world.getSurfaceHeight(x, z) : 64));
  private readonly groundSystem = new GroundAccumulationSystem(this.surfaceState);
  private worldSnow: WorldSnowSystem | null = null;
  private readonly groundRenderer: GroundCoverRenderer;
  private readonly precipitation: PrecipitationRenderer;
  private readonly rainCurtains: RainCurtainRenderer;
  private readonly windVisuals: WindVisualSystem;
  private readonly lightning = new LightningSystem();
  private readonly lightningRenderer: LightningRenderer;
  // Nuages convectifs procéduraux (puffs simulés).
  private readonly convectiveClouds = new ConvectiveCloudSystem();
  private readonly regionalClouds = new RegionalCloudController(this.weatherEngine, this.convectiveClouds);
  private readonly cloudVolumeRenderer: CloudVolumeRenderer;
  private readonly skyCloudPopulation: SkyCloudPopulationRenderer;
  private readonly sunDirScratch = new THREE.Vector3(0.4, 0.8, 0.2);
  /** Lien événement orageux → cumulonimbus convectif (auto-généré). */
  private readonly stormCloudMasses = new Map<number, StormCloudGroup>();
  private readonly sky: SkySystem;
  private readonly mainMenu: MainMenu;
  private readonly pauseMenu: PauseMenu;
  private readonly quickAccess: QuickAccessUI;
  private readonly hud: HUD;
  private readonly hotbar: HotbarUI;
  private readonly inventory: InventoryUI;
  private readonly debug: DebugOverlay;
  private readonly command: CommandSystem;
  private readonly weatherMapUI: WeatherMapUI;
  private readonly outline: THREE.LineSegments;

  private world: World | null = null;
  private chunks: ChunkManager | null = null;
  private entities: EntityManager | null = null;
  private started = false;
  private currentSeed = DEFAULT_SEED;
  private currentWorldId = "default";
  private currentWorldName = "Monde local";
  private currentWorldOptions: SaveData["worldOptions"] = {};
  private knownWorlds: WorldSummary[] = [];
  private menuSettings: GameSettingsSnapshot = GameSettingsStore.load();
  private lastTime = performance.now();
  private currentHit: RaycastHit | null = null;
  private assetsReady: Promise<void> | null = null;
  private stepDistance = 0;
  private forecastRefreshTimer = 0;
  private cachedForecast: ForecastTimeline | null = null;
  private cloudVisualTimer = 0;
  private cloudVisualDelta = 0;
  private weatherVisualTimer = 0;
  private weatherVisualDelta = 0;
  private shelterRefreshTimer = 0;
  private cachedSheltered = false;
  private qualityPreset: QualityPreset = "balanced";
  private weatherDebugProbeTimer = 0;
  private lastEnvironmentVisualKey = "";

  constructor(container: HTMLElement) {
    this.menuSettings = normalizeSettings(this.menuSettings);
    GameSettingsStore.applyToRuntime(this.menuSettings);
    this.renderer = new Renderer(container);
    this.overlay = document.createElement("div");
    this.overlay.className = "overlay";
    this.renderer.root.appendChild(this.overlay);
    this.input = new Input(this.renderer.renderer.domElement);
    this.cameraController = new CameraController(this.renderer.camera);
    this.cameraController.sensitivity = Settings.mouseSensitivity;
    this.player = new Player(this.renderer.camera);
    this.itemRegistry = new ItemRegistry(this.blockRegistry);
    this.weather = new WeatherSystem(this.renderer.scene);
    this.weather.onThunder = (delay, power) => this.weatherAudio.playThunder(delay, power);
    // Moteur météo régional (v0.1). Le rendu reste désactivé par défaut pour ne
    // pas entrer en conflit avec SkySystem ; on l'active via `/weather render on`.
    this.weatherRenderer = new WeatherRenderer(this.renderer.scene, this.renderer.camera, this.weatherEngine);
    this.fogBankRenderer = new FogBankRenderer(this.renderer.scene);
    // Nuages discrets (v0.3) : naissent/grossissent/s'assombrissent/se dissipent.
    // Couche météo riche (v0.4) : sol, rideaux de pluie distants, éclairs.
    this.groundRenderer = new GroundCoverRenderer(this.renderer.scene, this.surfaceState);
    this.precipitation = new PrecipitationRenderer(this.renderer.scene);
    this.rainCurtains = new RainCurtainRenderer(this.renderer.scene);
    // Volumétrique désactivé (rendu "soucoupe" blob) : les orages passent par
    // CloudMassRenderer (billboards tour + enclume), cohérent avec le style voxel.
    this.windVisuals = new WindVisualSystem(this.renderer.scene);
    this.ambientLife = new AmbientLifeSystem(this.renderer.scene);
    this.livingWorld = new LivingWorldSystem(this.renderer.scene);
    this.lightningRenderer = new LightningRenderer(this.renderer.scene);
    this.lightning.onThunder = (delay, power) => this.weatherAudio.playThunder(delay, power);
    this.cloudVolumeRenderer = new CloudVolumeRenderer(this.renderer.scene, this.convectiveClouds);
    this.skyCloudPopulation = new SkyCloudPopulationRenderer(this.renderer.scene);
    this.renderer.setFrameCompositor(this.cloudVolumeRenderer);
    this.sky = new SkySystem(this.renderer);

    this.hud = new HUD(this.overlay);
    this.hotbar = new HotbarUI(this.overlay, this.player.inventory, this.blockRegistry, this.textureManager);
    this.inventory = new InventoryUI(this.overlay, this.player.inventory, this.blockRegistry, this.textureManager, this.crafting, this.smelting, () => {
      this.hotbar.render();
    });
    this.debug = new DebugOverlay(this.overlay);
    this.command = new CommandSystem(this.overlay);
    this.weatherMapUI = new WeatherMapUI(
      this.overlay,
      (timeOffsetSeconds, center, radius) =>
        this.weatherMapData.build({
          centerX: center?.x ?? this.player.position.x,
          centerZ: center?.z ?? this.player.position.z,
          radius,
          timeOffsetSeconds,
          alerts: this.alertSystem.list(),
          surface: this.surfaceState,
          regionalSnow: this.worldSnow ?? undefined,
          world: this.world ?? undefined,
        }),
      (center) => this.forecastSystem.forecastTimeline(center?.x, center?.z),
      () => this.alertSystem.list(),
    );
    this.mainMenu = new MainMenu(this.overlay, {
      newGame: (options) => void this.startNewGame(options),
      loadWorld: (worldId) => void this.loadGame(worldId),
      deleteWorld: (worldId) => void this.deleteWorld(worldId),
      renameWorld: (worldId, name) => void this.renameWorld(worldId, name),
      duplicateWorld: (worldId) => void this.duplicateWorld(worldId),
      save: () => void this.saveGame(),
      openCommands: () => this.command.openCommandTable(),
      refreshWorlds: () => void this.refreshWorldList(),
      setQuality: (quality) => this.setQualityPreset(quality),
      setRenderDistance: (distance) => this.setRenderDistance(distance),
      applySettings: (settings) => this.applyGameSettings(settings, false),
      resetSettings: () => this.resetGameSettings(),
      showPause: () => this.pauseMenu.show(),
    }, this.menuSettings);
    this.pauseMenu = new PauseMenu(this.overlay, {
      resume: () => this.resume(),
      save: () => void this.saveGame(),
      openMap: () => this.openWeatherMap(),
      openInventory: () => this.openInventory(),
      openCommands: () => this.command.openCommandTable(),
      openWorlds: () => this.openWorldsFromPause(),
      openSettings: () => this.openSettingsFromPause(),
      mainMenu: () => this.showMainMenu(),
    });
    this.quickAccess = new QuickAccessUI(this.overlay, {
      openMap: () => this.openWeatherMap(),
      openInventory: () => this.openInventory(),
      openCommands: () => this.command.openWithPrefix("/"),
      openCommandTable: () => this.command.openCommandTable(),
      cycleQuality: () => this.cycleQualityPreset(),
      changeRenderDistance: (delta) => this.setRenderDistance((this.chunks?.renderDistance ?? Settings.renderDistance) + delta),
    });
    this.quickAccess.setState(this.qualityPreset, Settings.renderDistance);

    const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    this.outline = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color: 0xfacc15 }));
    this.outline.visible = false;
    this.renderer.scene.add(this.outline);

    this.renderer.renderer.domElement.addEventListener("click", () => {
      void this.gameAudio.unlock();
      void this.weatherAudio.unlock();
      void this.biomeAmbience.unlock();
      if (this.started && !this.isUiBlocking()) {
        this.input.requestPointerLock();
      }
    });
  }

  async initialize(): Promise<void> {
    this.assetsReady = this.textureManager.initialize(this.blockRegistry);
    await this.assetsReady;
    // Injecte (chaînés) vagues d'eau, perspective aérienne PUIS ombres de nuages
    // dans les matériaux du monde — une seule fois. Chaque apply chaîne le
    // onBeforeCompile précédent.
    this.waterWaves.apply(this.textureManager.waterMaterial);
    this.vegetationWind.apply(this.textureManager.transparentMaterial);
    for (const material of [
      this.textureManager.opaqueMaterial,
      this.textureManager.transparentMaterial,
      this.textureManager.waterMaterial,
    ]) {
      this.aerialPerspective.apply(material);
      this.cloudShadows.apply(material);
    }
    this.hotbar.render(true);
    this.inventory.render();
    this.hud.message(
      this.textureManager.stats.basePath
        ? `Resource pack loaded from ${this.textureManager.stats.basePath}`
        : "Resource pack not found, fallback textures used.",
    );
    await this.refreshWorldList();
    this.mainMenu.setSettings(this.qualityPreset, Settings.renderDistance);
    this.applyGameSettings(this.menuSettings);
    this.loop();
  }

  private async startNewGame(options: MainMenuNewWorldOptions = {
    name: "Monde local",
    gameMode: "creative",
    difficulty: "normal",
    startSeason: "auto",
    startWeather: "clear",
    startTime: "day",
    dynamicWeather: true,
    dynamicSeasons: true,
    renderDistance: Settings.renderDistance,
    quality: this.qualityPreset,
    worldQuality: "standard",
  }): Promise<void> {
    const seed = options.seed?.trim() || `${DEFAULT_SEED}-${Date.now().toString(36)}`;
    this.mainMenu.showLoading(options.name, seed);
    try {
      this.loading("textures", 0.15);
      await this.waitForAssets();
      void this.gameAudio.unlock();
      void this.weatherAudio.unlock();
      this.loading("seed", 0.45);
      this.currentWorldId = this.createWorldId(options.name);
      this.currentWorldName = options.name.trim() || "Nouveau monde";
      this.currentWorldOptions = {
        difficulty: options.difficulty,
        startSeason: options.startSeason,
        dynamicWeather: options.dynamicWeather,
        dynamicSeasons: options.dynamicSeasons,
        worldQuality: options.worldQuality,
      };
      this.setQualityPreset(options.quality, false);
      this.setRenderDistance(options.renderDistance, false);
      await this.saveManager.registerWorld(this.currentWorldId, this.currentWorldName, seed);
      this.loading("terrain", 0.2);
      await this.setupWorld(seed, undefined, options);
      this.loading("chunks", 0.05);
      await this.warmInitialChunks((progress) => this.loading("chunks", progress));
      this.loading("weather", 0.75);
      await this.saveGame(false);
      await this.refreshWorldList();
      this.enterWorldFromMenu("Monde pret. Clique pour capturer la souris.");
    } catch (error) {
      this.mainMenu.failLoading(error instanceof Error ? error.message : "Le chargement du monde a echoue.");
      this.hud.message("Creation du monde impossible.");
    }
  }

  private async loadGame(worldId = this.currentWorldId): Promise<void> {
    const summary = this.knownWorlds.find((world) => world.id === worldId);
    this.mainMenu.showLoading(summary?.name ?? "Monde", summary?.seed ?? "seed inconnue");
    try {
      this.loading("textures", 0.15);
      await this.waitForAssets();
      void this.gameAudio.unlock();
      void this.weatherAudio.unlock();
      this.loading("seed", 0.35);
      const data = await this.saveManager.load(worldId);
      if (!data) {
        this.mainMenu.failLoading("Aucun monde sauvegarde trouve.");
        this.hud.message("Aucun monde sauvegarde trouve.");
        return;
      }
      this.currentWorldId = worldId;
      this.currentWorldName = summary?.name ?? "Monde local";
      this.currentWorldOptions = data.worldOptions ?? {};
      this.loading("terrain", 0.25);
      await this.setupWorld(data.seed, data);
      this.loading("chunks", 0.05);
      await this.warmInitialChunks((progress) => this.loading("chunks", progress));
      this.loading("weather", 0.85);
      await this.saveManager.markPlayed(worldId);
      await this.refreshWorldList();
      this.enterWorldFromMenu("Monde charge.");
    } catch (error) {
      this.mainMenu.failLoading(error instanceof Error ? error.message : "Le chargement du monde a echoue.");
      this.hud.message("Chargement impossible.");
    }
  }

  private async waitForAssets(): Promise<void> {
    if (this.assetsReady) {
      await this.assetsReady;
      return;
    }
    this.assetsReady = this.textureManager.initialize(this.blockRegistry);
    await this.assetsReady;
  }

  private loading(step: LoadingStepId, progress: number): void {
    this.mainMenu.setLoadingProgress(step, progress);
  }

  private async warmInitialChunks(onProgress: (progress: number) => void): Promise<void> {
    if (!this.chunks || !this.world) return;
    const previousGenerations = this.chunks.maxChunkGenerationsPerFrame;
    const previousRebuilds = this.chunks.maxChunkRebuildsPerFrame;
    this.chunks.maxChunkGenerationsPerFrame = Math.max(previousGenerations, 4);
    this.chunks.maxChunkRebuildsPerFrame = Math.max(previousRebuilds, 4);
    const passes = 10;
    for (let i = 0; i < passes; i += 1) {
      this.chunks.update(this.player.position);
      onProgress((i + 1) / passes);
      await nextFrame();
    }
    this.chunks.maxChunkGenerationsPerFrame = previousGenerations;
    this.chunks.maxChunkRebuildsPerFrame = previousRebuilds;
  }

  private enterWorldFromMenu(message: string): void {
    this.loading("enter", 1);
    this.mainMenu.completeLoading();
    this.mainMenu.hide();
    this.pauseMenu.hide();
    this.started = true;
    this.quickAccess.setVisible(true);
    this.hud.message(message);
  }

  private async setupWorld(seed: string, saveData?: SaveData, newWorldOptions?: MainMenuNewWorldOptions): Promise<void> {
    this.disposeWorld();
    this.weatherEngine.reset();
    this.convectiveClouds.clear();
    this.stormCloudMasses.clear();
    this.loading("climate", 0.2);
    this.currentSeed = seed;
    this.world = new World(seed, this.blockRegistry, saveData?.blockChanges);
    this.livingWorld.setSeed(seed);
    this.worldSnow = new WorldSnowSystem(this.weatherEngine, this.world);
    this.worldSnow.restore(saveData?.regionalSnow);
    this.loading("climate", 0.65);
    this.world.ensureChunk(0, 0);
    this.chunks = new ChunkManager(this.renderer.scene, this.world, this.blockRegistry, this.textureManager);
    this.chunks.renderDistance = Settings.renderDistance;
    this.chunks.unloadDistance = Settings.renderDistance + 4;
    this.configureChunkBudgets();
    this.entities = new EntityManager(this.renderer.scene, this.blockRegistry);
    this.livingWorld.clear();
    this.groundRenderer.setSnowEnabled(false);
    this.weather.setRegionalMode(true);
    this.weatherDirector.reset();
    this.regionalClouds.reset();
    // Le scénario garantit l'accumulation au sol pour la neige soufflée / poudrerie.
    this.weatherDirector.scenarios.onForcePrecip = (kind, intensity, seconds) =>
      this.groundSystem.forcePrecip(kind, intensity, seconds);
    this.lastEnvironmentVisualKey = "";

    if (saveData) {
      this.player.restore(saveData.player as ReturnType<Player["serialize"]>);
      this.time.restore(saveData.time);
      this.weather.restore(saveData.weather);
      this.surfaceState.restore(saveData.surfaceWeather);
    } else {
      this.surfaceState.clear();
      this.player.position.copy(this.world.getSpawnPosition());
      this.player.velocity.set(0, 0, 0);
      this.player.setGameMode(newWorldOptions?.gameMode ?? "creative");
      this.time.setNamedTime(newWorldOptions?.startTime ?? "day");
      this.weather.setWeather(newWorldOptions?.startWeather ?? "clear", 80, newWorldOptions?.startWeather === "clear" ? 0 : 0.55, false);
      this.seasonSystem.setSeason(newWorldOptions?.dynamicSeasons === false ? (newWorldOptions.startSeason ?? "spring") : "auto");
    }

    this.loading("environment", 0.75);
    this.player.update(0, this.input, this.cameraController, this.world, false);
    this.cachedForecast = null;
    this.forecastRefreshTimer = 0;
    this.shelterRefreshTimer = 0;
    this.updateCommandContext();
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const elapsed = Math.min(0.5, (now - this.lastTime) / 1000);
    const delta = Math.min(0.05, elapsed);
    this.lastTime = now;

    if (this.started && this.world && this.chunks && this.entities) {
      this.frame(delta, elapsed);
    }

    this.renderer.render();
    this.input.endFrame();
  };

  private frame(delta: number, weatherDelta: number): void {
    const world = this.world!;
    const chunks = this.chunks!;
    const controlsEnabled = this.input.pointerLocked && !this.isUiBlocking();

    if (!this.pauseMenu.isOpen() && !this.command.isOpen() && !this.inventory.isOpen()) {
      this.time.update(delta);
    }

    this.cameraController.update(this.input, controlsEnabled);
    this.handleUiKeys();
    this.handleHotbar();
    const wasGrounded = this.player.physics.onGround;
    this.player.update(delta, this.input, this.cameraController, world, controlsEnabled);
    this.updateMovementAudio(delta, world, controlsEnabled, wasGrounded);

    chunks.update(this.player.position);
    this.entities!.update(delta, this.player);
    // Moteur météo régional : on suit le joueur puis on avance la simulation.
    this.weatherEngine.setObserver(this.player.position.x, this.player.position.z);
    this.updateWeatherEnvironment(world);
    this.weatherDirector.update(weatherDelta);
    this.weatherEngine.update(weatherDelta);
    this.weatherDebugProbeTimer -= weatherDelta;
    if (this.weatherDebugProbeTimer <= 0) {
      this.weatherDebugProbeTimer = 0.5;
      document.documentElement.dataset.weatherDebug = JSON.stringify(this.weatherDirector.debugState());
      document.documentElement.dataset.cloudPopulationVisual = String(this.skyCloudPopulation.visibleCount);
      document.documentElement.dataset.precipitationVisual = JSON.stringify(this.precipitation.debugState);
      document.documentElement.dataset.livingWorld = JSON.stringify(this.livingWorld.debug());
    }
    const weatherScene = this.weatherDirector.scenarios.currentScene;
    this.worldSnow?.update(weatherDelta, weatherScene);
    this.localWeatherField.update(delta, this.weatherEngine, this.player.position.x, this.player.position.z);
    this.sky.clouds.setWeatherField(
      this.localWeatherField.texture,
      this.localWeatherField.center.x,
      this.localWeatherField.center.y,
      this.localWeatherField.radius,
    );
    this.cloudShadows.setWeatherField(
      this.localWeatherField.texture,
      this.localWeatherField.center.x,
      this.localWeatherField.center.y,
      this.localWeatherField.radius,
    );
    // Le ciel lit la couverture/vent régionaux pour piloter les nuages shader.
    this.sky.weatherSample = this.weatherEngine.sampleObserver();
    this.sky.weatherScene = weatherScene;
    this.weather.syncRegional(this.sky.weatherSample);
    const dayFactor = this.sky.updateWithWorld(delta, this.time, this.weather, this.player, world);
    // Nuages convectifs procéduraux (sim particulaire + rendu d'ellipsoïdes).
    const sunAng = (this.time.ticks / WORLD_DAY_TICKS) * Math.PI * 2;
    this.sunDirScratch.set(Math.cos(sunAng), Math.max(0.15, Math.sin(sunAng)), -0.4).normalize();
    this.regionalClouds.update(weatherDelta, this.player.position.x, this.player.position.z);
    this.skyCloudPopulation.update(
      delta,
      this.regionalClouds.clusters,
      weatherScene,
      this.renderer.camera,
      dayFactor,
      this.sunDirScratch,
    );
    this.syncStormClouds(weatherDelta);
    this.convectiveClouds.update(Math.min(0.12, weatherDelta), { dayFactor, sunDir: this.sunDirScratch });
    this.cloudVolumeRenderer.update(
      delta,
      this.weatherEngine.state.time,
      dayFactor,
      this.sunDirScratch,
      this.renderer.camera,
      this.qualityPreset,
    );
    this.cloudVisualTimer -= delta;
    this.cloudVisualDelta += delta;
    if (this.cloudVisualTimer <= 0) {
      this.cloudVisualTimer = this.qualityPreset === "high" ? 0.12 : this.qualityPreset === "balanced" ? 0.22 : 0.4;
      this.cloudSystem.update(this.cloudVisualDelta, this.player.position.x, this.player.position.z);
      this.cloudVisualDelta = 0;
    }

    // --- Couche météo riche (v0.4) ---
    const sample = this.sky.weatherSample!;
    const events = this.weatherEngine.getActiveEvents();
    const camera = this.renderer.camera.position;
    const season = this.seasonSystem.sample(this.time.ticks);
    // Ombres de nuages au sol : couverture régionale + masses convectives.
    this.cloudShadows.update(delta, {
      sunDirection: this.sky.sunDirection,
      coverage: Math.max(sample.cloudCover, this.regionalClouds.backgroundCover),
      windX: sample.windX,
      windZ: sample.windZ,
      observerX: this.player.position.x,
      observerZ: this.player.position.z,
      observerY: this.player.position.y,
      masses: this.convectiveClouds.masses,
    });
    this.waterWaves.update(delta, sample.windX, sample.windZ);
    this.vegetationWind.update(delta, sample.windX, sample.windZ);
    this.ambientLife.update(delta, sample, camera, world, dayFactor, this.player.position, this.player.velocity);
    this.livingWorld.update(delta, world, this.player.position, sample, this.time.ticks, season, this.qualityPreset);
    this.worldMemory.update(delta, world, this.surfaceState, this.player.position, sample);
    // Perspective aérienne : teinte le lointain vers la couleur de l'atmosphère
    // (= couleur du brouillard/horizon du ciel), chaude vers le soleil.
    const aerialFog = this.renderer.scene.fog as THREE.Fog | null;
    if (aerialFog) {
      this.aerialPerspective.update(
        camera,
        aerialFog.color,
        this.aerialSunColor,
        this.sky.sunDirection,
        dayFactor,
      );
      this.skyCloudPopulation.setHaze(aerialFog.color);
    }
    // Sol : accumulation/fonte (le jour accélère la fonte).
    this.groundSystem.update(
      delta,
      sample,
      this.player.position.x,
      this.player.position.z,
      dayFactor,
      weatherScene.precipitation,
      weatherScene.temperatureProfile.surface,
    );
    const environment = this.environmentDirector.update({
      delta,
      world,
      surfaceState: this.surfaceState,
      ticks: this.time.ticks,
      player: this.player.position,
      dayFactor,
      exposedToSky: this.cachedSheltered ? 0.15 : 1,
    });
    world.environmentVisualState = environment.visual;
    this.refreshEnvironmentVisualsIfNeeded(environment, world);
    this.fogBankRenderer.update(delta, this.environmentDirector, camera, this.qualityPreset);
    document.documentElement.dataset.environmentState = JSON.stringify({
      season: environment.season.season,
      temp: Number(environment.temperature.toFixed(1)),
      feels: Number(environment.thermal.feelsLike.toFixed(1)),
      ground: environment.surface.mood,
      precip: environment.precipitationKind,
      river: Number(environment.riverLevel.toFixed(2)),
      fauna: environment.fauna.label,
      haze: Number(environment.airQuality.haze.toFixed(2)),
      fog: Number(environment.fog.density.toFixed(2)),
      visibility: environment.fog.visibilityMeters,
    });
    this.groundRenderer.update(delta, camera);
    this.weatherVisualTimer -= delta;
    this.weatherVisualDelta += delta;
    const hasWeatherVisuals = events.length > 0 || sample.precipitation > 0.04 || sample.windSpeed > 8;
    for (const strike of this.lightning.update(delta, events, this.player.position.x, this.player.position.z)) {
      this.lightningRenderer.addStrike(strike, camera);
      this.cloudVolumeRenderer.addLightningStrike(strike);
    }
    this.lightningRenderer.update(delta, camera);
    this.rainCurtains.update(delta, events, camera, sample.windX, sample.windZ);
    this.precipitation.update(
      delta,
      sample,
      camera,
      this.qualityPreset !== "low",
      this.groundSystem.forcedPrecipitation,
      { dayFactor, lightning: this.lightningRenderer.flashAmount },
      weatherScene.precipitation,
    );
    if (hasWeatherVisuals && this.weatherVisualTimer <= 0) {
      this.weatherVisualTimer = this.qualityPreset === "high" ? 0.06 : this.qualityPreset === "balanced" ? 0.14 : 0.28;
      if (this.qualityPreset !== "low") {
        this.windVisuals.update(this.weatherVisualDelta, sample, camera);
      } else {
        this.windVisuals.setEnabled(false);
      }
      this.weatherVisualDelta = 0;
    } else if (!hasWeatherVisuals) {
      this.windVisuals.setEnabled(false);
    }
    // Rendu régional APRÈS le ciel : quand activé, il a le dernier mot sur le
    // ciel/brouillard (sinon SkySystem les réécrirait). No-op si désactivé.
    this.weatherRenderer.update(delta);
    this.updateForecastAndAlerts(delta);
    this.weatherMapUI.update(delta);
    this.shelterRefreshTimer -= delta;
    if (this.shelterRefreshTimer <= 0) {
      this.shelterRefreshTimer = 0.45;
      this.cachedSheltered = this.hasRoofAbove(this.player.position.x, this.player.position.y, this.player.position.z);
    }
    this.weatherAudio.update(
      sample,
      events,
      this.surfaceState,
      {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        sheltered: this.cachedSheltered,
      },
      delta,
    );
    this.biomeAmbience.update(world, this.player.position, sample, this.time.ticks, season, delta, environment);
    this.updateTargetBlock();

    if (controlsEnabled) {
      this.handleBlockActions();
    }

    this.hud.update(this.player, chunks, this.blockRegistry, this.textureManager, this.time, this.weather, sample, environment);
    this.hotbar.render();
    this.debug.update(delta, this.player, chunks, this.textureManager, this.time, this.weather, this.currentSeed, sample, this.alertSystem.list().length);
  }

  private handleUiKeys(): void {
    if (this.command.isOpen()) {
      return;
    }
    if (this.mainMenu.isOpen()) {
      return;
    }
    if (this.input.wasPressed("Escape")) {
      if (this.weatherMapUI.isOpen()) {
        this.weatherMapUI.close();
      } else if (this.inventory.isOpen()) {
        this.inventory.close();
      } else if (this.pauseMenu.isOpen()) {
        this.resume();
      } else if (this.started) {
        this.pauseMenu.show();
      }
    }
    if (this.input.wasPressed("KeyE") && !this.pauseMenu.isOpen()) {
      this.inventory.toggle();
    }
    if (this.input.wasPressed("KeyM") && !this.pauseMenu.isOpen() && !this.inventory.isOpen()) {
      this.openWeatherMap();
    }
    if (this.input.wasPressed("F1")) {
      this.command.openCommandTable();
    }
    if (this.input.wasPressed("F3")) {
      this.debug.toggle();
    }
    if (this.input.wasPressed("F4")) {
      this.setGameMode(this.player.gameMode === "creative" ? "survival" : "creative");
    }
    if (this.input.wasPressed("KeyF")) {
      this.player.toggleFlight();
      this.hud.message(this.player.creativeFlying ? "Creative flight enabled." : "Creative flight disabled.");
    }
    if (this.input.wasPressed("KeyR") && this.world) {
      this.world.chunks.forEach((chunk) => (chunk.dirty = true));
      this.hud.message("Chunks queued for rebuild.");
    }
  }

  private updateForecastAndAlerts(delta: number): void {
    this.forecastRefreshTimer -= delta;
    if (this.cachedForecast && this.forecastRefreshTimer > 0) {
      return;
    }
    const eventCount = this.weatherEngine.activeEventCount;
    this.forecastRefreshTimer = this.weatherMapUI.isOpen() ? 1.2 : eventCount > 0 ? 4 : 8;
    const horizons = this.weatherMapUI.isOpen() ? undefined : ALERT_FORECAST_HORIZONS;
    this.cachedForecast = this.forecastSystem.forecastTimeline(this.player.position.x, this.player.position.z, horizons);
    this.alertSystem.update(this.cachedForecast, this.weatherEngine);
  }

  private handleHotbar(): void {
    if (this.command.isOpen() || this.inventory.isOpen()) return;
    for (let i = 0; i < 9; i += 1) {
      if (this.input.wasPressed(`Digit${i + 1}`)) {
        this.player.inventory.select(i);
      }
    }
    if (Math.abs(this.input.wheelDelta) > 0) {
      this.player.inventory.scroll(this.input.wheelDelta);
    }
  }

  private handleBlockActions(): void {
    if (!this.world || !this.currentHit) {
      return;
    }
    if (this.input.leftClick) {
      this.breakTargetBlock();
    }
    if (this.input.rightClick) {
      this.placeOrInteract();
    }
  }

  private breakTargetBlock(): void {
    const world = this.world!;
    const hit = this.currentHit!;
    const blockId = world.getBlock(hit.x, hit.y, hit.z);
    const block = this.blockRegistry.get(blockId);
    if (block.unbreakable || blockId === BlockId.AIR || blockId === BlockId.WATER) {
      return;
    }
    world.setBlock(hit.x, hit.y, hit.z, BlockId.AIR);
    this.gameAudio.playBreak(blockId, this.blockRegistry);
    if (this.player.gameMode === "survival") {
      this.entities?.spawnItem(blockId, new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5));
    }
  }

  private placeOrInteract(): void {
    const world = this.world!;
    const hit = this.currentHit!;
    const hitBlock = world.getBlock(hit.x, hit.y, hit.z);
    if (
      (hitBlock === BlockId.CRAFTING_TABLE || hitBlock === BlockId.FURNACE || hitBlock === BlockId.FURNACE_ON) &&
      !this.input.isDown("ShiftLeft") &&
      !this.input.isDown("ShiftRight")
    ) {
      this.inventory.show();
      this.hud.message(`${this.blockRegistry.get(hitBlock).displayName} opened.`);
      return;
    }

    const target = new THREE.Vector3(hit.x, hit.y, hit.z).add(hit.normal);
    const tx = Math.floor(target.x);
    const ty = Math.floor(target.y);
    const tz = Math.floor(target.z);
    const existing = world.getBlock(tx, ty, tz);
    if (existing !== BlockId.AIR && existing !== BlockId.WATER) {
      return;
    }
    if (this.player.placeableBlockIntersects(tx, ty, tz)) {
      this.hud.message("Cannot place a block inside the player.");
      return;
    }
    const blockId = this.player.inventory.selectedSlot?.blockId;
    if (blockId === undefined || blockId === BlockId.AIR) {
      return;
    }
    const consumed = this.player.inventory.consumeSelected(this.player.gameMode === "creative");
    if (!consumed) {
      return;
    }
    const placed = this.orientPlacedBlock(consumed, hit.normal);
    world.setBlock(tx, ty, tz, placed);
    this.gameAudio.playPlace(placed, this.blockRegistry);
  }

  private orientPlacedBlock(blockId: BlockId, normal: THREE.Vector3): BlockId {
    if (blockId === BlockId.OAK_LOG) {
      if (Math.abs(normal.x) > 0.5) return BlockId.OAK_LOG_X;
      if (Math.abs(normal.z) > 0.5) return BlockId.OAK_LOG_Z;
    }
    if (blockId === BlockId.BIRCH_LOG) {
      if (Math.abs(normal.x) > 0.5) return BlockId.BIRCH_LOG_X;
      if (Math.abs(normal.z) > 0.5) return BlockId.BIRCH_LOG_Z;
    }
    if (blockId === BlockId.SPRUCE_LOG) {
      if (Math.abs(normal.x) > 0.5) return BlockId.SPRUCE_LOG_X;
      if (Math.abs(normal.z) > 0.5) return BlockId.SPRUCE_LOG_Z;
    }
    if (blockId === BlockId.DARK_OAK_LOG) {
      if (Math.abs(normal.x) > 0.5) return BlockId.DARK_OAK_LOG_X;
      if (Math.abs(normal.z) > 0.5) return BlockId.DARK_OAK_LOG_Z;
    }
    if (blockId === BlockId.WEATHERED_BEAM) {
      if (Math.abs(normal.x) > 0.5) return BlockId.WEATHERED_BEAM_X;
      if (Math.abs(normal.z) > 0.5) return BlockId.WEATHERED_BEAM_Z;
    }
    return blockId;
  }

  private updateTargetBlock(): void {
    if (!this.world) return;
    const origin = this.renderer.camera.position.clone();
    const direction = this.cameraController.getForward();
    this.currentHit = this.raycastVoxel(origin, direction, 5.2);
    if (this.currentHit) {
      this.outline.visible = true;
      this.outline.position.set(this.currentHit.x + 0.5, this.currentHit.y + 0.5, this.currentHit.z + 0.5);
    } else {
      this.outline.visible = false;
    }
  }

  private updateMovementAudio(delta: number, world: World, controlsEnabled: boolean, wasGrounded: boolean): void {
    const groundBlock = this.blockBelowPlayer(world);
    const landed = !wasGrounded && this.player.physics.onGround;
    const jumped = controlsEnabled && this.input.wasPressed("Space") && this.player.velocity.y > 3 && !this.player.creativeFlying;
    if (jumped) {
      this.gameAudio.playJump(groundBlock, this.blockRegistry);
    }
    if (landed) {
      this.gameAudio.playFootstep(groundBlock, this.blockRegistry, 1.2);
    }
    const horizontalSpeed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    if (!controlsEnabled || !this.player.physics.onGround || this.player.creativeFlying || horizontalSpeed < 0.8) {
      this.stepDistance = 0;
      return;
    }
    this.stepDistance += horizontalSpeed * delta;
    const threshold = horizontalSpeed > 6.2 ? 1.75 : 2.25;
    if (this.stepDistance >= threshold) {
      this.stepDistance = 0;
      this.gameAudio.playFootstep(groundBlock, this.blockRegistry, horizontalSpeed);
    }
  }

  private blockBelowPlayer(world: World): BlockId {
    const x = Math.floor(this.player.position.x);
    const z = Math.floor(this.player.position.z);
    const y = Math.floor(this.player.position.y - 0.08);
    const direct = world.getBlock(x, y, z);
    if (direct !== BlockId.AIR) {
      return direct;
    }
    return world.getBlock(x, y - 1, z);
  }

  private raycastVoxel(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): RaycastHit | null {
    const world = this.world!;
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = direction.x > 0 ? 1 : -1;
    const stepY = direction.y > 0 ? 1 : -1;
    const stepZ = direction.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / (direction.x || 1e-8));
    const tDeltaY = Math.abs(1 / (direction.y || 1e-8));
    const tDeltaZ = Math.abs(1 / (direction.z || 1e-8));
    let tMaxX = this.intBound(origin.x, direction.x);
    let tMaxY = this.intBound(origin.y, direction.y);
    let tMaxZ = this.intBound(origin.z, direction.z);
    let distance = 0;
    const normal = new THREE.Vector3();

    while (distance <= maxDistance) {
      const blockId = world.getBlock(x, y, z);
      if (blockId !== BlockId.AIR && blockId !== BlockId.WATER) {
        return { x, y, z, normal: normal.clone() };
      }
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          x += stepX;
          distance = tMaxX;
          tMaxX += tDeltaX;
          normal.set(-stepX, 0, 0);
        } else {
          z += stepZ;
          distance = tMaxZ;
          tMaxZ += tDeltaZ;
          normal.set(0, 0, -stepZ);
        }
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        distance = tMaxY;
        tMaxY += tDeltaY;
        normal.set(0, -stepY, 0);
      } else {
        z += stepZ;
        distance = tMaxZ;
        tMaxZ += tDeltaZ;
        normal.set(0, 0, -stepZ);
      }
    }
    return null;
  }

  private intBound(s: number, ds: number): number {
    if (ds === 0) return Number.POSITIVE_INFINITY;
    const next = ds > 0 ? Math.floor(s + 1) : Math.ceil(s - 1);
    return (next - s) / ds;
  }

  private async saveGame(showMessage = true): Promise<void> {
    if (!this.world) {
      this.hud.message("No world to save.");
      return;
    }
    const player = this.player.serialize();
    await this.saveManager.save({
      version: 1,
      seed: this.currentSeed,
      player: {
        position: player.position,
        velocity: player.velocity,
        gameMode: player.gameMode,
        creativeFlying: player.creativeFlying,
        health: player.health,
        hunger: player.hunger,
        inventory: player.inventory,
        selectedHotbarIndex: player.selectedHotbarIndex,
      },
      time: this.time.serialize(),
      weather: this.weather.serialize(),
      worldOptions: this.currentWorldOptions,
      surfaceWeather: this.surfaceState.serialize(),
      regionalSnow: this.worldSnow?.serialize(),
      blockChanges: this.world.serializeChanges(),
    }, this.currentWorldId, this.currentWorldName);
    await this.refreshWorldList();
    if (showMessage) this.hud.message("Monde sauvegarde.");
  }

  private async deleteWorld(worldId: string): Promise<void> {
    await this.saveManager.clear(worldId);
    await this.refreshWorldList();
    if (worldId === this.currentWorldId) {
      this.disposeWorld();
      this.started = false;
      this.quickAccess.setVisible(false);
    }
    this.hud.message("Monde supprime.");
  }

  private async renameWorld(worldId: string, name: string): Promise<void> {
    await this.saveManager.renameWorld(worldId, name);
    if (worldId === this.currentWorldId) this.currentWorldName = name.trim() || this.currentWorldName;
    await this.refreshWorldList();
    this.hud.message("Monde renomme.");
  }

  private async duplicateWorld(worldId: string): Promise<void> {
    const copy = await this.saveManager.duplicateWorld(worldId);
    await this.refreshWorldList();
    this.hud.message(copy ? `Copie creee: ${copy.name}.` : "Impossible de dupliquer ce monde.");
  }

  private async loadGameFromCommand(): Promise<void> {
    await this.loadGame();
  }

  private resume(): void {
    this.pauseMenu.hide();
    this.mainMenu.hide();
    this.input.requestPointerLock();
  }

  private showMainMenu(): void {
    this.pauseMenu.hide();
    this.mainMenu.show();
    this.started = false;
    this.quickAccess.setVisible(false);
    void this.refreshWorldList();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private openWorldsFromPause(): void {
    this.pauseMenu.hide();
    this.mainMenu.showWorldsFromPause();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private openSettingsFromPause(): void {
    this.pauseMenu.hide();
    this.mainMenu.showSettingsFromPause();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private setGameMode(mode: GameMode): void {
    this.player.setGameMode(mode);
    this.hud.message(`Game mode set to ${mode}.`);
  }

  private hasRoofAbove(x: number, y: number, z: number): boolean {
    if (!this.world) return false;
    const top = Math.floor(y + 18);
    for (let checkY = Math.floor(y + 2); checkY <= top; checkY += 1) {
      if (this.world.isSolidBlock(x, checkY, z)) return true;
    }
    return false;
  }

  private isUiBlocking(): boolean {
    return this.mainMenu.isOpen() || this.pauseMenu.isOpen() || this.inventory.isOpen() || this.command.isOpen() || this.weatherMapUI.isOpen() || !this.started;
  }

  /**
   * Auto-génère un cumulonimbus convectif pour chaque cellule orageuse / ligne
   * de grains. Il NAÎT PETIT puis se développe (le signe avant-coureur visible),
   * suit l'événement, et se dissipe quand l'événement disparaît.
   */
  private syncStormClouds(delta: number): void {
    const events = this.weatherEngine.getActiveEvents();
    const wind = this.weatherEngine.getWind();
    const live = new Set<number>();
    for (const ev of events) {
      if (
        ev.type !== WeatherEventType.STORM_CELL
        && ev.type !== WeatherEventType.SQUALL_LINE
        && ev.type !== WeatherEventType.COLD_FRONT
      ) continue;
      live.add(ev.id);
      let group = this.stormCloudMasses.get(ev.id);
      if (group?.core.dead) {
        this.stormCloudMasses.delete(ev.id); // mort → on en refait un
        group = undefined;
      }
      if (!group) {
        const seeds = this.regionalClouds.claimStormSeeds(ev.x, ev.z, Math.max(2400, ev.radius * 2.2), 3);
        const core = seeds.shift() ?? this.convectiveClouds.spawnAt(
          ev.x - ev.dirX * Math.min(650, ev.radius * 0.35),
          ev.z - ev.dirZ * Math.min(650, ev.radius * 0.35),
          { humidity: 0.84, instability: 0.48 },
        );
        const desiredMasses = 3 + (ev.id % 3);
        while (seeds.length < desiredMasses - 1) {
          const index = seeds.length + 1;
          const angle = ev.id * 1.61803398875 + index * 2.399963229728653;
          const orbit = Math.min(1500, Math.max(720, ev.radius * (0.42 + index * 0.07)));
          const feeder = this.convectiveClouds.spawnAt(
            ev.x + Math.cos(angle) * orbit,
            ev.z + Math.sin(angle) * orbit,
            { humidity: 0.7 + (index % 2) * 0.06, instability: 0.35 + (index % 3) * 0.035 },
          );
          feeder.puffBudget = 95 + index * 18;
          feeder.upperWind.set(wind.x, 0, wind.z);
          seeds.push(feeder);
        }
        group = { core, feeders: seeds };
        this.stormCloudMasses.set(ev.id, group);
      }

      // La convection profonde se prépare sur plusieurs minutes. La phase de
      // l'événement borne la cible, mais ne peut plus faire apparaître un CB
      // mature à la première frame.
      const growthWindow = Math.max(120, Math.min(240, ev.maxAge * 0.34));
      const ageRamp = THREE.MathUtils.smoothstep(ev.age, 0, growthWindow);
      const ageDevelopment = ageRamp * 0.92;
      const development = Math.max(ageDevelopment, STORM_PHASE_DEVELOPMENT[ev.phase] * ageRamp);
      const core = group.core;
      const coreFollow = 1 - Math.exp(-delta * (0.025 + development * 0.1));
      core.translate((ev.x - core.position.x) * coreFollow, (ev.z - core.position.z) * coreFollow);

      for (let index = group.feeders.length - 1; index >= 0; index -= 1) {
        const feeder = group.feeders[index];
        if (feeder.dead) {
          group.feeders.splice(index, 1);
          continue;
        }
        const angle = core.shapeSeed + index * 2.399963;
        const orbit = THREE.MathUtils.lerp(Math.min(950, ev.radius * 0.55), 90, development);
        const targetX = core.position.x + Math.cos(angle) * orbit;
        const targetZ = core.position.z + Math.sin(angle) * orbit;
        const converge = 1 - Math.exp(-delta * (0.018 + development * 0.11));
        feeder.translate((targetX - feeder.position.x) * converge, (targetZ - feeder.position.z) * converge);
        feeder.humidity = Math.max(feeder.humidity, 0.72 + development * 0.22);
        feeder.setInstability(Math.max(feeder.instability, Math.min(0.48, 0.34 + development * 0.2)));
        feeder.puffBudget = Math.max(feeder.puffBudget, 190);
        if (development > 0.5 && Math.hypot(feeder.position.x - core.position.x, feeder.position.z - core.position.z) < 260) {
          core.absorb(feeder);
          group.feeders.splice(index, 1);
        }
      }

      const kind = ev.type === WeatherEventType.SQUALL_LINE || ev.type === WeatherEventType.COLD_FRONT
        ? "squall"
        : ev.radius >= 1800
          ? "supercell"
          : "storm";
      core.syncWeatherVisual({
        eventId: ev.id,
        kind,
        radius: ev.radius,
        intensity: ev.intensity,
        development,
        windX: wind.x + ev.dirX * 5,
        windZ: wind.z + ev.dirZ * 5,
        precip: ev.precip,
        warmStart: ev.visualWarmStart,
      });
    }
    for (const [id, group] of this.stormCloudMasses) {
      if (!live.has(id)) {
        group.core.dissipate();
        for (const feeder of group.feeders) feeder.dissipate();
        this.stormCloudMasses.delete(id);
      }
    }
  }

  /**
   * Pousse le contexte (saison/heure/biome/neige) au directeur de scénarios
   * pour que le choix des temps soit cohérent (orages rares, neige si froid,
   * brume au lever calme...). On lit le climat de fond BIOME pristine (non peint).
   */
  private updateWeatherEnvironment(world: World): void {
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const cellX = Math.floor(px / CELL_SIZE);
    const cellZ = Math.floor(pz / CELL_SIZE);
    const base = this.biomeWeather.baselineForCell(cellX, cellZ, world);
    const snowCol = this.surfaceState.get(px, pz);
    const seasonState = this.seasonSystem.sample(this.time.ticks);
    const temp = base.temperature + seasonState.temperatureOffset;
    const here = world.getSurfaceHeight(px, pz);
    const relief =
      Math.abs(world.getSurfaceHeight(px + 32, pz) - here)
      + Math.abs(world.getSurfaceHeight(px - 32, pz) - here)
      + Math.abs(world.getSurfaceHeight(px, pz + 32) - here)
      + Math.abs(world.getSurfaceHeight(px, pz - 32) - here);
    const terrainLift = Math.min(1, relief / 72);
    const pressureTrend = (this.weatherEngine.getObserverCell().pressure - base.pressure) / 10;
    const season = seasonState.season.toUpperCase() as "SPRING" | "SUMMER" | "AUTUMN" | "WINTER";
    this.weatherDirector.setEnvironment({
      timeOfDay: this.time.timeOfDay,
      season,
      biomeHumidity: base.humidity,
      biomeTemperature: temp,
      altitude: this.player.position.y,
      terrainLift,
      pressureTrend,
      surfaceWetness: snowCol?.wetness ?? 0,
      snowCover: snowCol ? Math.min(1, snowCol.snowDepth) : 0,
    });
  }

  private updateCommandContext(): void {
    if (!this.world) return;
    this.command.setContext({
      time: this.time,
      weather: this.weather,
      weatherEngine: this.weatherEngine,
      weatherDirector: this.weatherDirector,
      weatherRenderer: this.weatherRenderer,
      cloudSystem: this.cloudSystem,
      convectiveClouds: this.convectiveClouds,
      cloudVolumeRenderer: this.cloudVolumeRenderer,
      groundSystem: this.groundSystem,
      cloudPopulation: this.regionalClouds,
      lightning: this.lightning,
      forecastSystem: this.forecastSystem,
      alertSystem: this.alertSystem,
      weatherMapUI: this.weatherMapUI,
      player: this.player,
      world: this.world,
      save: () => this.saveGame(),
      load: () => this.loadGameFromCommand(),
      setGameMode: (mode) => this.setGameMode(mode),
      toggleDebug: () => this.debug.toggle(),
      getDebugSummary: () => this.debug.summary(),
      getSeed: () => this.currentSeed,
      setRenderDistance: (distance) => this.setRenderDistance(distance),
      getRenderDistance: () => this.chunks?.renderDistance ?? Settings.renderDistance,
      setQualityPreset: (preset) => this.setQualityPreset(preset),
      getQualityPreset: () => this.qualityPreset,
      setLook: (yawDegrees, pitchDegrees) => this.cameraController.setLookDegrees(yawDegrees, pitchDegrees),
      resetCloudVisuals: () => {
        this.convectiveClouds.clear();
        this.regionalClouds.reset();
        this.stormCloudMasses.clear();
      },
      livingWorld: this.livingWorld,
      seasonSystem: this.seasonSystem,
      ambientBiomeAudio: this.biomeAmbience,
      worldMemory: this.worldMemory,
      environmentDirector: this.environmentDirector,
    });
  }

  private refreshEnvironmentVisualsIfNeeded(environment: EnvironmentState, world: World): void {
    const visual = environment.visual;
    const key = [
      visual.season,
      Math.round(visual.vegetation * 5),
      Math.round(visual.leafWarmth * 5),
      Math.round(visual.leafDrop * 5),
      Math.round(visual.dryness * 5),
      Math.round(visual.frost * 4),
      Math.round(visual.snow * 4),
      Math.round(visual.wetness * 3),
    ].join(":");
    if (key === this.lastEnvironmentVisualKey) return;
    this.lastEnvironmentVisualKey = key;
    for (const chunk of world.chunks.values()) {
      chunk.dirty = true;
    }
  }

  private applyGameSettings(settings: GameSettingsSnapshot, syncMenu = true): GameSettingsSnapshot {
    this.menuSettings = normalizeSettings(settings);
    GameSettingsStore.save(this.menuSettings);
    GameSettingsStore.applyToRuntime(this.menuSettings);
    this.cameraController.sensitivity = Settings.mouseSensitivity;
    this.cameraController.invertY = this.menuSettings.invertY;
    this.renderer.camera.fov = this.menuSettings.fov;
    this.renderer.camera.updateProjectionMatrix();
    this.renderer.renderer.toneMappingExposure = 1.58 * this.menuSettings.brightness;
    this.setQualityPreset(this.menuSettings.quality, false);
    this.setRenderDistance(this.menuSettings.renderDistance, false);
    if (syncMenu) this.mainMenu.setSettingsSnapshot(this.menuSettings);
    return this.menuSettings;
  }

  private resetGameSettings(): GameSettingsSnapshot {
    return this.applyGameSettings({ ...DEFAULT_GAME_SETTINGS }, false);
  }

  private setRenderDistance(distance: number, syncMenu = true): void {
    const clamped = Math.max(2, Math.min(16, Math.round(distance)));
    Settings.renderDistance = clamped;
    this.menuSettings.renderDistance = clamped;
    if (this.chunks) {
      this.chunks.renderDistance = clamped;
      this.chunks.unloadDistance = clamped + 4;
      this.configureChunkBudgets();
    }
    this.renderer.camera.far = 40000;
    this.renderer.camera.updateProjectionMatrix();
    this.quickAccess.setState(this.qualityPreset, clamped);
    if (syncMenu) this.mainMenu.setSettings(this.qualityPreset, clamped);
  }

  private setQualityPreset(preset: QualityPreset, syncMenu = true): void {
    this.qualityPreset = preset;
    this.menuSettings.quality = preset;
    this.renderer.setShadowQuality(preset);
    this.renderer.setPostQuality(preset);
    this.cloudShadows.setEnabled(preset !== "low");
    switch (preset) {
      case "low":
        this.renderer.setPixelRatioLimit(1);
        this.setRenderDistance(3, syncMenu);
        if (syncMenu) this.hud.message("Quality set to low: fewer chunks and reduced weather particles.");
        break;
      case "high":
        this.renderer.setPixelRatioLimit(1.5);
        this.setRenderDistance(12, syncMenu);
        if (syncMenu) this.hud.message("Quality set to high: farther chunks and denser visuals.");
        break;
      case "balanced":
      default:
        this.renderer.setPixelRatioLimit(1.15);
        this.setRenderDistance(6, syncMenu);
        if (syncMenu) this.hud.message("Quality set to balanced.");
        break;
    }
    this.configureChunkBudgets();
    this.quickAccess.setState(this.qualityPreset, Settings.renderDistance);
    if (syncMenu) this.mainMenu.setSettings(this.qualityPreset, Settings.renderDistance);
  }

  private cycleQualityPreset(): void {
    const next: Record<QualityPreset, QualityPreset> = { low: "balanced", balanced: "high", high: "low" };
    this.setQualityPreset(next[this.qualityPreset]);
  }

  private configureChunkBudgets(): void {
    if (!this.chunks) return;
    const distance = this.chunks.renderDistance;
    if (this.qualityPreset === "low") {
      this.chunks.maxChunkGenerationsPerFrame = 1;
      this.chunks.maxChunkRebuildsPerFrame = 1;
      return;
    }
    if (this.qualityPreset === "high") {
      this.chunks.maxChunkGenerationsPerFrame = distance >= 12 ? 2 : 3;
      this.chunks.maxChunkRebuildsPerFrame = distance >= 12 ? 2 : 3;
      return;
    }
    this.chunks.maxChunkGenerationsPerFrame = distance >= 10 ? 1 : 2;
    this.chunks.maxChunkRebuildsPerFrame = distance >= 10 ? 1 : 2;
  }

  private openWeatherMap(): void {
    if (!this.started) return;
    this.pauseMenu.hide();
    this.inventory.close();
    this.weatherMapUI.open();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private openInventory(): void {
    if (!this.started) return;
    this.pauseMenu.hide();
    this.weatherMapUI.close();
    this.inventory.show();
  }

  private async refreshWorldList(): Promise<void> {
    this.knownWorlds = await this.saveManager.listWorlds();
    this.mainMenu.renderWorlds(this.knownWorlds);
  }

  private createWorldId(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "world";
    return `${slug}-${Date.now().toString(36)}`;
  }

  private disposeWorld(): void {
    this.worldSnow?.dispose();
    this.worldSnow = null;
    this.livingWorld.clear();
    this.chunks?.dispose();
    this.entities?.dispose();
    this.chunks = null;
    this.entities = null;
    this.world = null;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
