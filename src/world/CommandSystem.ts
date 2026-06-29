import { Time } from "../game/Time";
import { Player } from "../player/Player";
import { GameMode } from "../player/GameMode";
import { World } from "./World";
import { WeatherSystem } from "./WeatherSystem";
import { MoonPhase, WeatherType } from "./WeatherTypes";
import { WeatherEngine } from "../weather/WeatherEngine";
import { WeatherCommands, WeatherRenderToggle, CloudPopulationDiagnostics, LightningDiagnostics } from "../commands/WeatherCommands";
import { CloudSystem } from "../weather/clouds/CloudSystem";
import { GroundAccumulationSystem } from "../weather/ground/GroundAccumulationSystem";
import { ConvectiveCloudSystem } from "../clouds/ConvectiveCloudSystem";
import { ConvectiveCloudCommands } from "../commands/ConvectiveCloudCommands";
import { CloudVolumeRenderer } from "../render/clouds/CloudVolumeRenderer";
import { ForecastSystem } from "../weather/forecast/ForecastSystem";
import { WeatherAlertSystem } from "../weather/alerts/WeatherAlertSystem";
import { WeatherMapUI } from "../ui/weather/WeatherMapUI";
import { WeatherDirector } from "../weather/WeatherDirector";
import { LivingWorldSystem } from "../living/LivingWorldSystem";
import { SeasonSystem, SeasonId } from "../living/SeasonSystem";
import { AmbientBiomeAudioSystem } from "../living/AmbientBiomeAudioSystem";
import { WorldMemorySystem } from "../living/WorldMemorySystem";
import { WildlifeSpecies } from "../living/LivingWorldTypes";
import { EnvironmentDirector } from "../environment/EnvironmentDirector";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../utils/Constants";
import { BlockId, isLegacyTrack, isPlant } from "./BlockTypes";
import { BiomeId, isForestBiome, isMountainBiome } from "./BiomeGenerator";

export type CommandContext = {
  time: Time;
  weather: WeatherSystem;
  /** Nouveau moteur météo régional (v0.1). */
  weatherEngine: WeatherEngine;
  weatherDirector: WeatherDirector;
  /** Rendu météo régional optionnel (pour `/weather render on|off`). */
  weatherRenderer?: WeatherRenderToggle;
  /** Système de nuages discrets (pour `/weather cloud ...`). */
  cloudSystem?: CloudSystem;
  /** Système de nuages convectifs procéduraux (pour `/cloud convective ...`). */
  convectiveClouds?: ConvectiveCloudSystem;
  cloudVolumeRenderer?: CloudVolumeRenderer;
  /** Météo au sol (pour `/weather ground ...` et les précip forcées). */
  groundSystem?: GroundAccumulationSystem;
  /** Population de nuages persistante (pour `/weather debug cloud_population`). */
  cloudPopulation?: CloudPopulationDiagnostics;
  /** Système d'éclairs (pour `/weather debug lightning`). */
  lightning?: LightningDiagnostics;
  forecastSystem: ForecastSystem;
  alertSystem: WeatherAlertSystem;
  weatherMapUI: WeatherMapUI;
  player: Player;
  world: World;
  save: () => Promise<void>;
  load: () => Promise<void>;
  setGameMode: (mode: GameMode) => void;
  toggleDebug: (type: string) => void;
  getDebugSummary: () => string;
  getSeed: () => string;
  setRenderDistance: (distance: number) => void;
  getRenderDistance: () => number;
  setQualityPreset: (preset: "low" | "balanced" | "high") => void;
  getQualityPreset: () => "low" | "balanced" | "high";
  resetCloudVisuals: () => void;
  livingWorld?: LivingWorldSystem;
  seasonSystem?: SeasonSystem;
  ambientBiomeAudio?: AmbientBiomeAudioSystem;
  worldMemory?: WorldMemorySystem;
  environmentDirector?: EnvironmentDirector;
};

const weatherTypes: WeatherType[] = [
  "clear",
  "cloudy",
  "overcast",
  "rain",
  "storm",
  "thunderstorm",
  "snow",
  "blizzard",
  "hail",
  "fog",
  "rainbow",
  "mist",
];

export type CommandDefinition = {
  usage: string;
  prefix: string;
  description: string;
};

export const COMMANDS: CommandDefinition[] = [
  { usage: "/help [filter]", prefix: "/help", description: "Show the command table." },
  { usage: "/commands [filter]", prefix: "/commands", description: "Show the command table." },
  { usage: "/time set day|noon|night|midnight|sunrise|sunset|6000", prefix: "/time set", description: "Set world time." },
  { usage: "/time add 1000", prefix: "/time add", description: "Advance world time." },
  { usage: "/time speed 20", prefix: "/time speed", description: "Set day/night speed." },
  { usage: "/weather map open", prefix: "/weather map open", description: "Open the weather map." },
  { usage: "/weather forecast here", prefix: "/weather forecast here", description: "Forecast at player position." },
  { usage: "/weather forecast x z", prefix: "/weather forecast", description: "Forecast at coordinates." },
  { usage: "/weather alert list", prefix: "/weather alert list", description: "List active alerts." },
  { usage: "/weather alert create type=storm level=orange radius=2000", prefix: "/weather alert create", description: "Create a manual alert." },
  { usage: "/weather cinematic storm_approach", prefix: "/weather cinematic storm_approach", description: "Spawn an approaching storm scene." },
  { usage: "/weather cinematic fair_cumulus", prefix: "/weather cinematic fair_cumulus", description: "Spawn separated fair-weather cumulus under blue sky." },
  { usage: "/weather cinematic isolated_storm", prefix: "/weather cinematic isolated_storm", description: "Spawn one isolated storm with blue sky around it." },
  { usage: "/weather cinematic storm_developing", prefix: "/weather cinematic storm_developing", description: "Spawn an early developing convective cell." },
  { usage: "/weather cinematic storm_mature_far", prefix: "/weather cinematic storm_mature_far", description: "Spawn a mature distant cumulonimbus." },
  { usage: "/weather cinematic storm_passing", prefix: "/weather cinematic storm_passing", description: "Show a storm moving away with clearing behind." },
  { usage: "/weather cinematic warm_front", prefix: "/weather cinematic warm_front", description: "Show the layered arrival of a warm front." },
  { usage: "/weather cinematic cold_front", prefix: "/weather cinematic cold_front", description: "Show an active cold front and its convective line." },
  { usage: "/weather cinematic stratiform_rain", prefix: "/weather cinematic stratiform_rain", description: "Show broad steady rain without a thunder core." },
  { usage: "/weather cinematic supercell_far", prefix: "/weather cinematic supercell_far", description: "Spawn a far supercell." },
  { usage: "/weather cinematic clearing_after_storm", prefix: "/weather cinematic clearing_after_storm", description: "Spawn clearing after storm." },
  { usage: "/weather cinematic blizzard_wall", prefix: "/weather cinematic blizzard_wall", description: "Spawn a blizzard wall." },
  { usage: "/weather cinematic snow_squall", prefix: "/weather cinematic snow_squall", description: "Spawn a moving snow squall with accumulation." },
  { usage: "/weather cinematic blizzard_night", prefix: "/weather cinematic blizzard_night", description: "Spawn a dark wind-driven night blizzard." },
  { usage: "/weather cinematic hail_core", prefix: "/weather cinematic hail_core", description: "Spawn a hail core." },
  { usage: "/weather cinematic sunset_rainbow", prefix: "/weather cinematic sunset_rainbow", description: "Spawn sunset rain and rainbow conditions." },
  { usage: "/weather scenario clear_day|fair_cumulus|warm_front|isolated_thunderstorm|morning_fog|steady_snow|blizzard|...", prefix: "/weather scenario", description: "Drive a full multi-phase weather scenario (clear, cumulus, fronts, storms, snow, fog, haze)." },
  { usage: "/weather scenario clear_spring|summer_heatwave|autumn_rain|winter_fog|lake_morning_mist|post_storm_clearing", prefix: "/weather scenario", description: "Seasonal environment scenarios coupled to the world state." },
  { usage: "/weather debug scene|plan|layers|precipitation|cloud_population|lightning", prefix: "/weather debug scene", description: "Inspect the multi-axis weather scene, plan, layers, precipitation and lightning." },
  { usage: "/weather debug cell|events|ground|wind|director|environment|thermal|fog", prefix: "/weather debug", description: "Inspect regional weather, environment, comfort and fog banks." },
  { usage: "/weather set cloudy|clearing|rain|storm radius=1000", prefix: "/weather set", description: "Spawn regional weather." },
  { usage: "/weather set season spring|summer|autumn|winter|auto", prefix: "/weather set season", description: "Force season through the environment director." },
  { usage: "/weather set temperature -8|auto", prefix: "/weather set temperature", description: "Force or release local environment temperature." },
  { usage: "/weather set wind 45 NW", prefix: "/weather set wind", description: "Force wind speed and direction for weather/environment tests." },
  { usage: "/weather debug snow", prefix: "/weather debug snow", description: "Inspect snow burial, frost and surface temperature." },
  { usage: "/weather wind set direction=east speed=strong", prefix: "/weather wind set", description: "Set wind." },
  { usage: "/weather spawn storm_cell direction=east intensity=violent", prefix: "/weather spawn", description: "Spawn a weather event." },
  { usage: "/weather spawn storm --x=0 --z=0 --radius=2200", prefix: "/weather spawn storm", description: "Spawn a storm at explicit coordinates." },
  { usage: "/weather spawn fogbank --x=0 --z=0 --direction=sw", prefix: "/weather spawn fogbank", description: "Force a fog bank scenario; mobile fog is world-space." },
  { usage: "/weather spawn heatwave --radius=3200", prefix: "/weather spawn heatwave", description: "Spawn a heatwave/haze scenario." },
  { usage: "/weather event inspect nearest", prefix: "/weather event inspect nearest", description: "Inspect nearest event." },
  { usage: "/weather event track nearest", prefix: "/weather event track nearest", description: "Track nearest event." },
  { usage: "/weather ground inspect", prefix: "/weather ground inspect", description: "Inspect ground weather state." },
  { usage: "/weather biome debug", prefix: "/weather biome debug", description: "Inspect biome weather." },
  { usage: "/weather terrain debug", prefix: "/weather terrain debug", description: "Inspect terrain influence." },
  { usage: "/cloud test cumulus_volume|congestus_volume|cumulonimbus_volume|anvil_volume|rainshaft", prefix: "/cloud test ", description: "Spawn an isolated volumetric cloud test." },
  { usage: "/cloud debug volume|lifecycle|layers|lightning|precipitation|renderers|performance", prefix: "/cloud debug ", description: "Inspect cloud authority, lifecycle, bounds and performance." },
  { usage: "/cloud debug bounds|density|puffs|off", prefix: "/cloud debug ", description: "Toggle cloud density and bounds overlays." },
  { usage: "/cloud grow nearest", prefix: "/cloud grow nearest", description: "Boost growth of the nearest cloud mass." },
  { usage: "/cloud dissipate nearest", prefix: "/cloud dissipate nearest", description: "Dissipate the nearest cloud mass." },
  { usage: "/sky clouds|wind|fog|stars|moonphase ...", prefix: "/sky", description: "Legacy sky controls." },
  { usage: "/gamemode creative|survival", prefix: "/gamemode", description: "Change game mode." },
  { usage: "/tp x y z", prefix: "/tp", description: "Teleport player." },
  { usage: "/renderdistance 2-16", prefix: "/renderdistance", description: "Set chunk render distance." },
  { usage: "/quality low|balanced|high", prefix: "/quality", description: "Switch performance/visual preset." },
  { usage: "/world regen loaded", prefix: "/world regen loaded", description: "Regenerate loaded terrain chunks with the current generator." },
  { usage: "/world cleanup generated-tracks", prefix: "/world cleanup generated-tracks", description: "Remove legacy generated track blocks from loaded chunks and saves." },
  { usage: "/world regenerate-decoration", prefix: "/world regenerate-decoration", description: "Clean legacy tracks and regenerate loaded chunk decoration." },
  { usage: "/world debug decorations", prefix: "/world debug decorations", description: "Inspect plants, legacy tracks and natural decorations in loaded chunks." },
  { usage: "/world biome debug", prefix: "/world biome debug", description: "Inspect macro climate, local biome and micro-biome at the player." },
  { usage: "/world biome map", prefix: "/world biome map", description: "Print a compact biome map around the player." },
  { usage: "/world biome locate forest|village|river|mountain", prefix: "/world biome locate", description: "Locate the nearest broad biome/feature from the real generator." },
  { usage: "/world biome regenerate", prefix: "/world biome regenerate", description: "Regenerate loaded chunks with the current climate/biome decorators." },
  { usage: "/build debug palette", prefix: "/build debug palette", description: "Place a compact palette of new non-cube block shapes." },
  { usage: "/build debug stairs", prefix: "/build debug stairs", description: "Place oriented stair variants." },
  { usage: "/build debug fences", prefix: "/build debug fences", description: "Place auto-connected fence variants." },
  { usage: "/build debug walls", prefix: "/build debug walls", description: "Place auto-connected wall variants." },
  { usage: "/build debug roof", prefix: "/build debug roof", description: "Place sloped roof variants." },
  { usage: "/build debug house", prefix: "/build debug house", description: "Build a small house using slabs, stairs, door, pane and roof shapes." },
  { usage: "/build debug bridge", prefix: "/build debug bridge", description: "Build a small bridge with slabs, fences and lanterns." },
  { usage: "/build debug village", prefix: "/build debug village", description: "Build a small village prototype block-out." },
  { usage: "/living debug", prefix: "/living debug", description: "Inspect living world fauna, ambience and activity." },
  { usage: "/living fauna on|off|all|bird|butterfly|dragonfly|firefly|rabbit|deer|fish|frog|bat", prefix: "/living fauna", description: "Toggle or force wildlife for testing." },
  { usage: "/living traces", prefix: "/living traces", description: "Inspect world memory/traces state." },
  { usage: "/season set auto|spring|summer|autumn|winter", prefix: "/season set", description: "Force or release the season system." },
  { usage: "/poi debug", prefix: "/poi debug", description: "Inspect micro-biome and rare POI seed logic here." },
  { usage: "/seed", prefix: "/seed", description: "Show world seed." },
  { usage: "/save", prefix: "/save", description: "Save game." },
  { usage: "/load", prefix: "/load", description: "Load game." },
  { usage: "/debug fps", prefix: "/debug", description: "Toggle debug overlay." },
];

export class CommandSystem {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  readonly log: HTMLDivElement;
  readonly suggestions: HTMLDivElement;
  readonly helpPanel: HTMLDivElement;
  readonly closeButton: HTMLButtonElement;
  private open = false;
  private history: string[] = [];
  private historyIndex = -1;
  private context: CommandContext | null = null;
  private weatherCommands: WeatherCommands | null = null;
  private convectiveCommands: ConvectiveCloudCommands | null = null;

  constructor(overlay: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "command-console hidden";
    this.log = document.createElement("div");
    this.log.className = "command-log";
    this.input = document.createElement("input");
    this.input.className = "command-input";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.placeholder = "/weather rain 300";
    this.suggestions = document.createElement("div");
    this.suggestions.className = "command-suggestions hidden";
    this.helpPanel = document.createElement("div");
    this.helpPanel.className = "command-help hidden";
    this.closeButton = document.createElement("button");
    this.closeButton.className = "command-close";
    this.closeButton.type = "button";
    this.closeButton.textContent = "X";
    this.closeButton.ariaLabel = "Close command console";
    this.root.append(this.log, this.input, this.closeButton, this.suggestions, this.helpPanel);
    overlay.appendChild(this.root);

    window.addEventListener("keydown", this.onGlobalKeyDown, true);
    this.input.addEventListener("keydown", this.onInputKeyDown);
    this.input.addEventListener("input", this.onInputChanged);
    this.closeButton.addEventListener("click", this.closeFromButton);
  }

  setContext(context: CommandContext): void {
    this.context = context;
    this.weatherCommands = new WeatherCommands(
      context.weatherEngine,
      (message) => this.write(message),
      context.weatherRenderer,
      context.cloudSystem,
      context.groundSystem,
      context.forecastSystem,
      context.alertSystem,
      context.weatherMapUI,
      context.world,
      context.weatherDirector,
      context.resetCloudVisuals,
      context.cloudVolumeRenderer,
      context.time,
      context.cloudPopulation,
      context.lightning,
    );
    this.convectiveCommands = context.convectiveClouds
      ? new ConvectiveCloudCommands(
          context.convectiveClouds,
          (message) => this.write(message),
          () => ({ x: context.player.position.x, z: context.player.position.z }),
          context.cloudVolumeRenderer,
        )
      : null;
  }

  isOpen(): boolean {
    return this.open;
  }

  openWithPrefix(prefix = "/"): void {
    this.openConsole(prefix);
  }

  openCommandTable(filter = ""): void {
    this.openConsole("/commands ");
    this.showCommandHelp(filter);
  }

  getCommandDefinitions(): CommandDefinition[] {
    return COMMANDS.slice();
  }

  write(message: string): void {
    const line = document.createElement("div");
    line.textContent = message;
    this.log.appendChild(line);
    while (this.log.children.length > 9) {
      this.log.firstChild?.remove();
    }
  }

  close(): void {
    this.open = false;
    this.root.classList.add("hidden");
    this.suggestions.classList.add("hidden");
    this.helpPanel.classList.add("hidden");
    this.input.blur();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onGlobalKeyDown, true);
    this.input.removeEventListener("keydown", this.onInputKeyDown);
    this.input.removeEventListener("input", this.onInputChanged);
    this.closeButton.removeEventListener("click", this.closeFromButton);
  }

  private openConsole(prefix = "/"): void {
    this.open = true;
    this.root.classList.remove("hidden");
    this.input.value = prefix;
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.updateSuggestions();
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  private execute(raw: string): void {
    if (!this.context) return;
    const command = raw.trim().replace(/^\//, "");
    if (!command) return;
    this.history.unshift(`/${command}`);
    this.historyIndex = -1;

    const parts = command.split(/\s+/).map((part, index) => (index < 4 && !part.includes("=") ? part.toLowerCase() : part));
    const [root] = parts;

    try {
      switch (root) {
        case "weather":
          this.executeWeather(parts);
          break;
        case "cloud":
          if (!this.convectiveCommands?.handle(parts)) {
            this.write("Usage: /cloud test cumulus_volume|congestus_volume|cumulonimbus_volume|anvil_volume|rainshaft | /cloud debug volume|lifecycle|layers|lightning|precipitation|renderers|performance|bounds|density|puffs|off");
          }
          break;
        case "help":
        case "commands":
          this.showCommandHelp(parts.slice(1).join(" "));
          break;
        case "time":
          this.executeTime(parts);
          break;
        case "sky":
          this.executeSky(parts);
          break;
        case "debug":
          this.context.toggleDebug(parts[1] ?? "fps");
          this.write(this.context.getDebugSummary());
          break;
        case "gamemode":
          this.executeGameMode(parts);
          break;
        case "tp":
          this.executeTeleport(parts);
          break;
        case "seed":
          this.write(`Seed: ${this.context.getSeed()}`);
          break;
        case "renderdistance":
          this.executeRenderDistance(parts);
          break;
        case "quality":
          this.executeQuality(parts);
          break;
        case "world":
          this.executeWorld(parts);
          break;
        case "build":
          this.executeBuild(parts);
          break;
        case "living":
          this.executeLiving(parts);
          break;
        case "season":
          this.executeSeason(parts);
          break;
        case "poi":
          this.executePoi(parts);
          break;
        case "save":
          void this.context.save().then(() => this.write("Game saved."));
          break;
        case "load":
          void this.context.load().then(() => this.write("Game loaded."));
          break;
        default:
          this.write(`Unknown command: /${command}`);
      }
    } catch (error) {
      this.write(error instanceof Error ? error.message : "Command failed.");
    }
  }

  private executeWeather(parts: string[]): void {
    const context = this.context!;
    if (this.executeEnvironmentWeather(parts)) {
      return;
    }
    // Routage prioritaire vers le moteur régional (debug/set/wind/spawn/render).
    // Sinon on retombe sur l'ancien format `/weather <type> [durée]`.
    if (this.weatherCommands?.handle(parts)) {
      return;
    }
    const type = parts[1] as WeatherType | undefined;
    if (!type || !weatherTypes.includes(type)) {
      this.write(`Weather types: ${weatherTypes.join(", ")}`);
      return;
    }

    const intensityIndex = parts.indexOf("intensity");
    if (intensityIndex >= 0) {
      const intensity = Number(parts[intensityIndex + 1]);
      context.weather.setIntensity(type, Number.isFinite(intensity) ? intensity : 0.6);
      this.spawnRegionalWeather(type, Number.isFinite(intensity) ? intensity : 0.6);
      this.write(`Weather changed to ${type} with intensity ${Number.isFinite(intensity) ? intensity : 0.6}.`);
      return;
    }

    const duration = Number(parts[2]);
    context.weather.setWeather(type, Number.isFinite(duration) ? duration : undefined);
    this.spawnRegionalWeather(type, type === "thunderstorm" || type === "blizzard" ? 1 : 0.82);
    this.write(`Weather changed to ${type}${Number.isFinite(duration) ? ` for ${duration} seconds` : ""}.`);
  }

  private executeEnvironmentWeather(parts: string[]): boolean {
    const context = this.context!;
    const environment = context.environmentDirector;
    if (parts[1] === "debug" && (parts[2] === "environment" || parts[2] === "thermal" || parts[2] === "fog" || parts[2] === "snow")) {
      if (!environment) {
        this.write("Environment director unavailable.");
        return true;
      }
      if (parts[2] === "fog") {
        this.write(environment.fogDebugText());
      } else if (parts[2] === "snow") {
        const s = environment.state;
        this.write(s ? `Snow debug depth=${s.surface.snowDepth.toFixed(2)} burial=${s.surface.snowBurial.toFixed(2)} compacted=${s.surface.compactedSnow.toFixed(2)} frost=${s.surface.frost.toFixed(2)} temp=${s.surface.surfaceTemperature.toFixed(1)}C` : "Environment unavailable.");
      } else {
        this.write(environment.debugText());
      }
      return true;
    }
    if (parts[1] === "set" && parts[2] === "season") {
      const value = parts[3] as SeasonId | "auto" | undefined;
      if (value === "auto" || value === "spring" || value === "summer" || value === "autumn" || value === "winter") {
        context.seasonSystem?.setSeason(value);
        this.write(`Environment season set to ${value}.`);
      } else {
        this.write("Usage: /weather set season auto|spring|summer|autumn|winter");
      }
      return true;
    }
    if (parts[1] === "set" && parts[2] === "temperature") {
      if (!environment) {
        this.write("Environment director unavailable.");
        return true;
      }
      if (parts[3] === "auto" || parts[3] === undefined) {
        environment.forceTemperature(null);
        this.write("Environment temperature released to weather simulation.");
        return true;
      }
      const value = Number(parts[3]);
      if (Number.isFinite(value)) {
        environment.forceTemperature(value);
        this.write(`Environment temperature forced to ${value.toFixed(1)}C.`);
      } else {
        this.write("Usage: /weather set temperature -8|auto");
      }
      return true;
    }
    if (parts[1] === "set" && parts[2] === "wind") {
      if (!environment) {
        this.write("Environment director unavailable.");
        return true;
      }
      if (parts[3] === "auto") {
        environment.forceWind(null);
        this.write("Environment wind released to weather simulation.");
        return true;
      }
      const speed = Number(parts[3]);
      const direction = this.directionToDegrees(parts[4] ?? "north");
      if (Number.isFinite(speed) && direction !== null) {
        environment.forceWind(speed, direction);
        this.write(`Environment wind forced to ${speed.toFixed(1)} blk/s from ${parts[4] ?? "north"} (${direction}deg).`);
      } else {
        this.write("Usage: /weather set wind 12 nw | /weather set wind auto");
      }
      return true;
    }
    return false;
  }

  private directionToDegrees(raw: string): number | null {
    const normalized = raw.toLowerCase();
    const named: Record<string, number> = {
      north: 0,
      n: 0,
      northeast: 45,
      ne: 45,
      east: 90,
      e: 90,
      southeast: 135,
      se: 135,
      south: 180,
      s: 180,
      southwest: 225,
      sw: 225,
      west: 270,
      w: 270,
      northwest: 315,
      nw: 315,
    };
    if (normalized in named) return named[normalized];
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? ((numeric % 360) + 360) % 360 : null;
  }

  private spawnRegionalWeather(type: WeatherType, intensity: number): void {
    const context = this.context!;
    const engine = context.weatherEngine;
    const observer = engine.getObserver();
    const mature = (event: ReturnType<WeatherEngine["spawnStormCell"]>): void => {
      event.intensity = Math.max(0.35, Math.min(1, intensity));
      event.age = event.maxAge * 0.32;
      event.setDirection("south");
    };

    if (type === "thunderstorm" || type === "storm") {
      mature(engine.spawnStormCell(type === "thunderstorm" ? 2200 : 1500, observer.x, observer.z));
    } else if (type === "blizzard" || type === "snow") {
      mature(engine.spawnStormCell(type === "blizzard" ? 2400 : 1500, observer.x, observer.z, "snow"));
      context.groundSystem?.forcePrecip("snow", Math.max(0.55, intensity), type === "blizzard" ? 240 : 120);
    } else if (type === "hail") {
      mature(engine.spawnStormCell(1500, observer.x, observer.z, "hail"));
      context.groundSystem?.forcePrecip("hail", Math.max(0.65, intensity), 75);
    } else if (type === "rain") {
      engine.spawnRainBand(1300, observer.x, observer.z);
    }
  }

  private executeTime(parts: string[]): void {
    const context = this.context!;
    if (parts[1] === "set") {
      const value = parts[2];
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        context.time.ticks = numeric;
        this.write(`Time set to ${numeric}.`);
      } else if (context.time.setNamedTime(value)) {
        this.write(`Time set to ${value}.`);
      } else {
        this.write("Usage: /time set day|noon|night|midnight|sunrise|sunset|6000");
      }
      return;
    }
    if (parts[1] === "add") {
      const amount = Number(parts[2]);
      context.time.ticks += Number.isFinite(amount) ? amount : 0;
      this.write(`Time advanced by ${Number.isFinite(amount) ? amount : 0}.`);
      return;
    }
    if (parts[1] === "speed") {
      const speed = Number(parts[2]);
      if (Number.isFinite(speed)) {
        context.time.speed = speed;
        this.write(`Time speed set to ${speed}.`);
      }
      return;
    }
    this.write("Usage: /time set|add|speed ...");
  }

  private executeSky(parts: string[]): void {
    const context = this.context!;
    const value = Number(parts[2]);
    switch (parts[1]) {
      case "clouds":
        context.weather.setCloudDensity(Number.isFinite(value) ? value : 0.5);
        this.write(`Cloud density set to ${Number.isFinite(value) ? value : 0.5}.`);
        break;
      case "wind":
        context.weather.setWind(Number.isFinite(value) ? value : 0.2);
        this.write(`Wind set to ${Number.isFinite(value) ? value : 0.2}.`);
        break;
      case "fog":
        context.weather.setWeather("fog", 180, Number.isFinite(value) ? value : 0.4);
        this.write(`Fog intensity set to ${Number.isFinite(value) ? value : 0.4}.`);
        break;
      case "stars":
        this.write("Stars are controlled by time of day and cloud density.");
        break;
      case "moonphase":
        context.weather.moonPhase = (parts[2] as MoonPhase) || "full";
        this.write(`Moon phase set to ${context.weather.moonPhase}.`);
        break;
      default:
        this.write("Usage: /sky clouds|wind|fog|stars|moonphase ...");
    }
  }

  private executeGameMode(parts: string[]): void {
    const mode = parts[1] as GameMode | undefined;
    if (mode !== "creative" && mode !== "survival") {
      this.write("Usage: /gamemode creative|survival");
      return;
    }
    this.context!.setGameMode(mode);
    this.write(`Game mode set to ${mode}.`);
  }

  private executeTeleport(parts: string[]): void {
    const [x, y, z] = parts.slice(1, 4).map(Number);
    if (![x, y, z].every(Number.isFinite)) {
      this.write("Usage: /tp 0 80 0");
      return;
    }
    this.context!.player.position.set(x, y, z);
    this.context!.player.velocity.set(0, 0, 0);
    this.write(`Teleported to ${x} ${y} ${z}.`);
  }

  private executeRenderDistance(parts: string[]): void {
    const distance = Number(parts[1]);
    if (!Number.isFinite(distance)) {
      this.write(`Render distance: ${this.context!.getRenderDistance()} chunks. Usage: /renderdistance 8`);
      return;
    }
    this.context!.setRenderDistance(distance);
    this.write(`Render distance set to ${this.context!.getRenderDistance()} chunks.`);
  }

  private executeQuality(parts: string[]): void {
    const preset = parts[1] as "low" | "balanced" | "high" | undefined;
    if (preset !== "low" && preset !== "balanced" && preset !== "high") {
      this.write(`Quality: ${this.context!.getQualityPreset()}. Usage: /quality low|balanced|high`);
      return;
    }
    this.context!.setQualityPreset(preset);
    this.write(`Quality set to ${preset}.`);
  }

  private executeWorld(parts: string[]): void {
    if (parts[1] === "biome") {
      this.executeWorldBiome(parts);
      return;
    }
    if (parts[1] === "regen" && (parts[2] === "loaded" || !parts[2])) {
      const count = this.context!.world.regenerateLoadedChunks();
      this.write(`Regenerated ${count} loaded chunk(s).`);
      return;
    }
    if (parts[1] === "cleanup" && parts[2] === "generated-tracks") {
      const removed = this.context!.worldMemory?.cleanupGeneratedTrackBlocks(this.context!.world) ?? this.cleanupLegacyTracksFallback();
      this.write(`Removed ${removed} legacy generated track block(s) from loaded chunks.`);
      return;
    }
    if (parts[1] === "regenerate-decoration") {
      const removed = this.context!.worldMemory?.cleanupGeneratedTrackBlocks(this.context!.world) ?? this.cleanupLegacyTracksFallback();
      const regenerated = this.context!.world.regenerateLoadedChunks();
      this.write(`Cleaned ${removed} legacy track block(s), regenerated ${regenerated} loaded chunk(s).`);
      return;
    }
    if (parts[1] === "debug" && parts[2] === "decorations") {
      this.write(this.debugDecorationSummary());
      return;
    }
    this.write("Usage: /world regen loaded | /world biome debug|map|locate|regenerate | /world cleanup generated-tracks | /world regenerate-decoration | /world debug decorations");
  }

  private executeWorldBiome(parts: string[]): void {
    const world = this.context!.world;
    const player = this.context!.player.position;
    const x = Math.floor(player.x);
    const z = Math.floor(player.z);
    if (parts[2] === "debug" || !parts[2]) {
      const height = world.getSurfaceHeight(x, z);
      const hydro = world.terrain.macro.sample(x, z).hydrology;
      this.write(world.terrain.biomes.debugAt(x, z, height, hydro));
      return;
    }
    if (parts[2] === "map") {
      this.write(this.biomeMap(x, z));
      return;
    }
    if (parts[2] === "locate") {
      const target = parts[3] ?? "forest";
      this.write(this.locateBiomeFeature(x, z, target));
      return;
    }
    if (parts[2] === "regenerate") {
      const count = world.regenerateLoadedChunks();
      this.write(`Regenerated ${count} loaded chunk(s) using the current climate/biome planners.`);
      return;
    }
    this.write("Usage: /world biome debug|map|locate forest|village|river|mountain|regenerate");
  }

  private biomeMap(centerX: number, centerZ: number): string {
    const world = this.context!.world;
    const step = 64;
    const radius = 4;
    const rows: string[] = [];
    const legend = new Map<string, string>();
    for (let gz = -radius; gz <= radius; gz += 1) {
      let row = "";
      for (let gx = -radius; gx <= radius; gx += 1) {
        const x = centerX + gx * step;
        const z = centerZ + gz * step;
        const h = world.getSurfaceHeight(x, z);
        const hydro = world.terrain.macro.sample(x, z).hydrology;
        const biome = world.terrain.biomes.sample(x, z, h, hydro).id;
        const char = biomeGlyph(biome);
        row += gx === 0 && gz === 0 ? "@" : char;
        legend.set(char, biome);
      }
      rows.push(row);
    }
    const legendText = [...legend.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
    return `Biome map step=${step}m center=${centerX},${centerZ}\n${rows.join("\n")}\n${legendText}`;
  }

  private locateBiomeFeature(centerX: number, centerZ: number, target: string): string {
    const world = this.context!.world;
    const maxRadius = 4096;
    const step = 64;
    let best: { x: number; z: number; distance: number; label: string } | null = null;
    for (let radius = step; radius <= maxRadius; radius += step) {
      for (let z = centerZ - radius; z <= centerZ + radius; z += step) {
        for (let x = centerX - radius; x <= centerX + radius; x += step) {
          if (Math.abs(x - centerX) !== radius && Math.abs(z - centerZ) !== radius) continue;
          const height = world.getSurfaceHeight(x, z);
          const macro = world.terrain.macro.sample(x, z);
          const biome = world.terrain.biomes.sample(x, z, height, macro.hydrology).id;
          const settlement = world.terrain.regions.settlementAt(x, z, height, biome, (wx, wz) => world.getSurfaceHeight(wx, wz));
          const matches =
            (target === "forest" && isForestBiome(biome)) ||
            (target === "mountain" && isMountainBiome(biome)) ||
            (target === "river" && Math.max(macro.hydrology.river, macro.hydrology.stream) > 0.58) ||
            (target === "village" && settlement?.kind === "village");
          if (!matches) continue;
          const distance = Math.hypot(x - centerX, z - centerZ);
          best = { x, z, distance, label: target === "village" && settlement ? settlement.kind : biome };
          break;
        }
        if (best) break;
      }
      if (best) break;
    }
    return best
      ? `${target} found at x=${best.x} z=${best.z} distance=${best.distance.toFixed(0)} label=${best.label}`
      : `${target} not found within ${maxRadius} blocks.`;
  }

  private executeBuild(parts: string[]): void {
    if (parts[1] !== "debug") {
      this.write("Usage: /build debug palette|stairs|fences|walls|roof|house|bridge|village");
      return;
    }
    const kind = parts[2] ?? "palette";
    const origin = this.demoOrigin();
    switch (kind) {
      case "palette":
        this.placePalette(origin.x, origin.y, origin.z);
        break;
      case "stairs":
        this.placeLine(origin.x, origin.y, origin.z, [
          BlockId.OAK_STAIRS_NORTH,
          BlockId.OAK_STAIRS_SOUTH,
          BlockId.OAK_STAIRS_EAST,
          BlockId.OAK_STAIRS_WEST,
          BlockId.COBBLESTONE_STAIRS_NORTH,
          BlockId.COBBLESTONE_STAIRS_SOUTH,
          BlockId.STONE_BRICK_STAIRS_EAST,
          BlockId.STONE_BRICK_STAIRS_WEST,
        ]);
        break;
      case "fences":
        this.placeFenceDemo(origin.x, origin.y, origin.z);
        break;
      case "walls":
        this.placeWallDemo(origin.x, origin.y, origin.z);
        break;
      case "roof":
        this.placeRoofDemo(origin.x, origin.y, origin.z);
        break;
      case "house":
        this.placeHouseDemo(origin.x, origin.y, origin.z);
        break;
      case "bridge":
        this.placeBridgeDemo(origin.x, origin.y, origin.z);
        break;
      case "village":
        this.placeVillageDemo(origin.x, origin.y, origin.z);
        break;
      default:
        this.write("Usage: /build debug palette|stairs|fences|walls|roof|house|bridge|village");
        return;
    }
    this.write(`Placed build debug ${kind} at ${origin.x} ${origin.y} ${origin.z}.`);
  }

  private cleanupLegacyTracksFallback(): number {
    let removed = 0;
    const world = this.context!.world;
    for (const chunk of world.chunks.values()) {
      let chunkRemoved = false;
      for (let y = 0; y < WORLD_HEIGHT; y += 1) {
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            if (isLegacyTrack(chunk.getLocal(x, y, z))) {
              chunk.setLocal(x, y, z, BlockId.AIR);
              chunkRemoved = true;
              removed += 1;
            }
          }
        }
      }
      if (chunkRemoved) chunk.dirty = true;
    }
    for (const [key, blockId] of world.blockChanges.entries()) {
      if (isLegacyTrack(blockId)) world.blockChanges.delete(key);
    }
    return removed;
  }

  private debugDecorationSummary(): string {
    let plants = 0;
    let legacyTracks = 0;
    let reeds = 0;
    let carpets = 0;
    let waterPlants = 0;
    let poiBlocks = 0;
    for (const chunk of this.context!.world.chunks.values()) {
      for (let y = 0; y < WORLD_HEIGHT; y += 1) {
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            const block = chunk.getLocal(x, y, z);
            if (isPlant(block)) plants += 1;
            if (isLegacyTrack(block)) legacyTracks += 1;
            if (block === BlockId.REEDS) reeds += 1;
            if (block === BlockId.MOSS_CARPET) carpets += 1;
            if (block === BlockId.LILY_PAD) waterPlants += 1;
            if (block === BlockId.CAMPFIRE || block === BlockId.WEATHERED_BEAM || block === BlockId.WEATHERED_PLANKS) poiBlocks += 1;
          }
        }
      }
    }
    return `Decorations loaded chunks=${this.context!.world.chunks.size} plants=${plants} reeds=${reeds} moss=${carpets} lily=${waterPlants} poiBlocks=${poiBlocks} legacyTracks=${legacyTracks}`;
  }

  private demoOrigin(): { x: number; y: number; z: number } {
    const player = this.context!.player.position;
    const x = Math.floor(player.x) + 4;
    const z = Math.floor(player.z) + 4;
    return { x, y: this.context!.world.getSurfaceHeight(x, z) + 1, z };
  }

  private placeLine(x: number, y: number, z: number, blocks: BlockId[]): void {
    blocks.forEach((block, index) => this.context!.world.setBlock(x + index, y, z, block));
  }

  private placePalette(x: number, y: number, z: number): void {
    const rows: BlockId[][] = [
      [BlockId.OAK_SLAB, BlockId.OAK_SLAB_TOP, BlockId.OAK_STAIRS_NORTH, BlockId.OAK_FENCE, BlockId.OAK_DOOR_NORTH, BlockId.GLASS_PANE],
      [BlockId.COBBLESTONE_SLAB, BlockId.COBBLESTONE_STAIRS_EAST, BlockId.COBBLESTONE_WALL, BlockId.MOSSY_COBBLESTONE_WALL, BlockId.STONE_BRICK_WALL],
      [BlockId.WEATHERED_ROOF_NORTH, BlockId.WEATHERED_ROOF_SOUTH, BlockId.LANTERN_POST, BlockId.HANGING_LANTERN, BlockId.DIRT_PATH, BlockId.GRAVEL_PATH],
    ];
    rows.forEach((row, dz) => row.forEach((block, dx) => this.context!.world.setBlock(x + dx, y, z + dz, block)));
  }

  private placeFenceDemo(x: number, y: number, z: number): void {
    for (let i = 0; i < 7; i += 1) {
      this.context!.world.setBlock(x + i, y, z, BlockId.OAK_FENCE);
      this.context!.world.setBlock(x + 3, y, z + i - 3, BlockId.OAK_FENCE);
    }
    this.context!.world.setBlock(x + 3, y + 1, z, BlockId.LANTERN_POST);
  }

  private placeWallDemo(x: number, y: number, z: number): void {
    for (let i = 0; i < 7; i += 1) {
      this.context!.world.setBlock(x + i, y, z, i % 2 === 0 ? BlockId.COBBLESTONE_WALL : BlockId.MOSSY_COBBLESTONE_WALL);
      this.context!.world.setBlock(x + 3, y, z + i - 3, BlockId.STONE_BRICK_WALL);
    }
  }

  private placeRoofDemo(x: number, y: number, z: number): void {
    for (let i = 0; i < 7; i += 1) {
      this.context!.world.setBlock(x + i, y, z, BlockId.WEATHERED_ROOF_NORTH);
      this.context!.world.setBlock(x + i, y, z + 1, BlockId.WEATHERED_ROOF_SOUTH);
      this.context!.world.setBlock(x + i, y + 1, z + 2, BlockId.WEATHERED_ROOF_NORTH);
      this.context!.world.setBlock(x + i, y + 1, z + 3, BlockId.WEATHERED_ROOF_SOUTH);
    }
  }

  private placeHouseDemo(x: number, y: number, z: number): void {
    for (let dx = 0; dx < 7; dx += 1) {
      for (let dz = 0; dz < 6; dz += 1) {
        this.context!.world.setBlock(x + dx, y - 1, z + dz, BlockId.WEATHERED_PLANKS);
        const edge = dx === 0 || dz === 0 || dx === 6 || dz === 5;
        for (let dy = 0; dy < 3; dy += 1) {
          this.context!.world.setBlock(x + dx, y + dy, z + dz, edge ? BlockId.WEATHERED_BEAM : BlockId.AIR);
        }
      }
    }
    this.context!.world.setBlock(x + 3, y, z, BlockId.OAK_DOOR_NORTH);
    this.context!.world.setBlock(x + 1, y + 1, z, BlockId.GLASS_PANE);
    this.context!.world.setBlock(x + 5, y + 1, z, BlockId.GLASS_PANE);
    this.context!.world.setBlock(x + 1, y + 1, z + 5, BlockId.GLASS_PANE);
    this.context!.world.setBlock(x + 5, y + 1, z + 5, BlockId.GLASS_PANE);
    for (let dx = -1; dx <= 7; dx += 1) {
      this.context!.world.setBlock(x + dx, y + 3, z - 1, BlockId.WEATHERED_ROOF_NORTH);
      this.context!.world.setBlock(x + dx, y + 3, z + 6, BlockId.WEATHERED_ROOF_SOUTH);
      this.context!.world.setBlock(x + dx, y + 4, z + 1, BlockId.WEATHERED_ROOF_NORTH);
      this.context!.world.setBlock(x + dx, y + 4, z + 4, BlockId.WEATHERED_ROOF_SOUTH);
    }
    this.context!.world.setBlock(x + 5, y + 5, z + 3, BlockId.CHIMNEY);
  }

  private placeBridgeDemo(x: number, y: number, z: number): void {
    for (let i = 0; i < 12; i += 1) {
      this.context!.world.setBlock(x + i, y, z, BlockId.OAK_SLAB);
      this.context!.world.setBlock(x + i, y, z + 1, BlockId.OAK_SLAB);
      if (i % 2 === 0) {
        this.context!.world.setBlock(x + i, y + 1, z - 1, BlockId.OAK_FENCE);
        this.context!.world.setBlock(x + i, y + 1, z + 2, BlockId.OAK_FENCE);
      }
    }
    this.context!.world.setBlock(x + 1, y + 2, z - 1, BlockId.LANTERN_POST);
    this.context!.world.setBlock(x + 10, y + 2, z + 2, BlockId.LANTERN_POST);
  }

  private placeVillageDemo(x: number, y: number, z: number): void {
    this.placeHouseDemo(x, y, z);
    this.placeHouseDemo(x + 12, y, z + 8);
    this.placeBridgeDemo(x + 2, y, z + 15);
    for (let i = 0; i < 22; i += 1) {
      this.context!.world.setBlock(x + i, y - 1, z + 7, i % 4 === 0 ? BlockId.GRAVEL_PATH : BlockId.DIRT_PATH);
    }
  }

  private executeLiving(parts: string[]): void {
    const living = this.context!.livingWorld;
    if (!living) {
      this.write("Living world system unavailable.");
      return;
    }
    if (parts[1] === "debug" || !parts[1]) {
      this.write(living.debugText());
      this.write(this.context!.ambientBiomeAudio?.debug() ?? "Ambience unavailable.");
      return;
    }
    if (parts[1] === "traces") {
      this.write(this.context!.worldMemory?.debug(this.context!.weatherEngine.sampleObserver()) ?? "World memory unavailable.");
      return;
    }
    if (parts[1] === "fauna") {
      const arg = parts[2] as WildlifeSpecies | "all" | "on" | "off" | undefined;
      if (arg === "on") {
        living.setEnabled(true);
        this.write("Living fauna enabled.");
        return;
      }
      if (arg === "off") {
        living.setEnabled(false);
        this.write("Living fauna disabled.");
        return;
      }
      const species = ["bird", "butterfly", "dragonfly", "firefly", "rabbit", "deer", "fish", "frog", "bat"];
      if (arg === "all" || (arg && species.includes(arg))) {
        living.force(arg, 60);
        this.write(`Forcing fauna: ${arg} for 60s.`);
        return;
      }
    }
    this.write("Usage: /living debug | /living fauna on|off|all|bird|butterfly|dragonfly|firefly|rabbit|deer|fish|frog|bat | /living traces");
  }

  private executeSeason(parts: string[]): void {
    const seasonSystem = this.context!.seasonSystem;
    if (!seasonSystem) {
      this.write("Season system unavailable.");
      return;
    }
    if (parts[1] === "set") {
      const value = parts[2] as SeasonId | "auto" | undefined;
      if (value === "auto" || value === "spring" || value === "summer" || value === "autumn" || value === "winter") {
        seasonSystem.setSeason(value);
        this.write(`Season set to ${value}.`);
        return;
      }
    }
    this.write(seasonSystem.debug(this.context!.time.ticks));
  }

  private executePoi(_parts: string[]): void {
    const world = this.context!.world;
    const x = Math.floor(this.context!.player.position.x);
    const z = Math.floor(this.context!.player.position.z);
    const height = world.getSurfaceHeight(x, z);
    const biome = world.getBiomeAt(x, z).id;
    const micro = world.terrain.living.sampleMicroBiome(x, z, biome, height);
    const poi = world.terrain.living.poiAt(x, z, biome, height);
    this.write(`POI debug x=${x} z=${z} biome=${biome} micro=${micro} anchor=${poi ?? "none"}`);
  }

  private showCommandHelp(filterRaw = ""): void {
    const filter = filterRaw.trim().replace(/^\//, "").toLowerCase();
    const rows = COMMANDS.filter((command) => {
      if (!filter) return true;
      return command.usage.toLowerCase().includes(filter) || command.description.toLowerCase().includes(filter);
    });
    this.helpPanel.textContent = "";
    const title = document.createElement("strong");
    title.textContent = filter ? `Commands matching "${filter}"` : "Available commands";
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    for (const command of rows) {
      const row = document.createElement("tr");
      const usage = document.createElement("td");
      const description = document.createElement("td");
      usage.textContent = command.usage;
      description.textContent = command.description;
      row.append(usage, description);
      body.appendChild(row);
    }
    table.appendChild(body);
    this.helpPanel.append(title, table);
    this.helpPanel.classList.remove("hidden");
    this.write(`${rows.length} command(s). Use Tab to autocomplete while typing.`);
  }

  private readonly onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (this.open) {
      if (event.code === "Escape") {
        this.consumeEvent(event);
        this.close();
      }
      return;
    }
    if (event.code === "Slash") {
      this.consumeEvent(event);
      this.openConsole("/");
    } else if (event.code === "KeyT") {
      this.consumeEvent(event);
      this.openConsole("");
    }
  };

  private readonly onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Escape") {
      this.consumeEvent(event);
      this.close();
      return;
    }
    if (event.code === "Enter") {
      this.consumeEvent(event);
      const value = this.input.value;
      this.write(value.startsWith("/") ? value : `/${value}`);
      const keepOpen = /^\/?(help|commands)\b/i.test(value.trim());
      this.execute(value);
      if (!keepOpen) {
        this.close();
      }
      return;
    }
    if (event.code === "Tab") {
      this.consumeEvent(event);
      this.applyFirstSuggestion();
      return;
    }
    if (event.code === "ArrowUp") {
      this.consumeEvent(event);
      this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
      this.input.value = this.history[this.historyIndex] ?? this.input.value;
    }
    if (event.code === "ArrowDown") {
      this.consumeEvent(event);
      this.historyIndex = Math.max(-1, this.historyIndex - 1);
      this.input.value = this.historyIndex >= 0 ? this.history[this.historyIndex] : "/";
    }
  };

  private readonly onInputChanged = (): void => {
    this.updateSuggestions();
  };

  private readonly closeFromButton = (): void => {
    this.close();
  };

  private updateSuggestions(): void {
    const matches = this.currentSuggestions();
    this.suggestions.textContent = "";
    if (!this.open || matches.length === 0) {
      this.suggestions.classList.add("hidden");
      return;
    }
    for (const command of matches.slice(0, 8)) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = command.usage;
      option.title = command.description;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.input.value = command.prefix.endsWith(" ") ? command.prefix : `${command.prefix} `;
        this.input.focus();
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        this.updateSuggestions();
      });
      this.suggestions.appendChild(option);
    }
    this.suggestions.classList.remove("hidden");
  }

  private currentSuggestions(): CommandDefinition[] {
    const value = this.input.value.trim().toLowerCase();
    if (!value || value === "/") {
      return COMMANDS.slice(0, 8);
    }
    const normalized = value.startsWith("/") ? value : `/${value}`;
    return COMMANDS.filter((command) => command.usage.toLowerCase().startsWith(normalized) || command.usage.toLowerCase().includes(normalized));
  }

  private applyFirstSuggestion(): void {
    const first = this.currentSuggestions()[0];
    if (!first) {
      return;
    }
    this.input.value = first.prefix.endsWith(" ") ? first.prefix : `${first.prefix} `;
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.updateSuggestions();
  }

  private consumeEvent(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
}

function biomeGlyph(biome: BiomeId): string {
  if (isForestBiome(biome)) return "F";
  if (isMountainBiome(biome)) return "M";
  if (biome === "riverbank") return "R";
  if (biome === "lake" || biome === "mountain_lake") return "L";
  if (biome === "marsh" || biome === "bog") return "W";
  if (biome === "beach" || biome === "dunes") return "B";
  if (biome === "desert" || biome === "rocky_desert" || biome === "canyon") return "D";
  if (biome === "tundra" || biome === "snow" || biome === "glacial_valley") return "S";
  if (biome === "flower_meadow") return "*";
  if (biome === "bocage") return "H";
  if (biome === "hills" || biome === "plateau") return "h";
  return ".";
}
