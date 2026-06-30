/**
 * Contrôle de relecture radar : curseur temporel libre sur l'historique
 * enregistré (passé) ET les prévisions (futur), lecture/pause, vitesse x1/x2/x4,
 * horodatage, et boucle automatique des dernières minutes simulées.
 *
 * Le composant ne simule rien lui-même : il déplace une position temporelle (en
 * secondes, 0 = maintenant) et notifie via onChange. La carte lit alors soit
 * l'historique (offset < 0), soit la prévision (offset > 0).
 */

/** Presets de prévision lointaine conservés (simulation vers l'avant). */
const FORECAST_PRESETS = [
  { label: "+1h", seconds: 60 * 60 },
  { label: "+3h", seconds: 3 * 60 * 60 },
  { label: "+6h", seconds: 6 * 60 * 60 },
];

/** Secondes simulées avancées par seconde réelle, à la vitesse x1. */
const PLAYBACK_RATE = 90;

export class WeatherTimelineSlider {
  readonly root = document.createElement("div");
  private readonly playButton = document.createElement("button");
  private readonly slider = document.createElement("input");
  private readonly label = document.createElement("span");
  private readonly speedButtons: HTMLButtonElement[] = [];

  private position = 0;
  private minSeconds = -30 * 60;
  private maxSeconds = 30 * 60;
  private playing = false;
  private speed = 1;

  constructor(private readonly onChange: (seconds: number) => void) {
    this.root.className = "weather-timeline";

    const controls = document.createElement("div");
    controls.className = "weather-timeline-controls";

    this.playButton.type = "button";
    this.playButton.className = "weather-timeline-play";
    this.playButton.textContent = "▶";
    this.playButton.title = "Lecture / pause de la boucle radar";
    this.playButton.addEventListener("click", () => this.togglePlay());

    const live = document.createElement("button");
    live.type = "button";
    live.textContent = "Live";
    live.title = "Revenir au temps réel";
    live.addEventListener("click", () => {
      this.setPlaying(false);
      this.setPosition(0, true);
    });

    const speedWrap = document.createElement("div");
    speedWrap.className = "weather-timeline-speed";
    [1, 2, 4].forEach((factor) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `x${factor}`;
      button.className = factor === this.speed ? "active" : "";
      button.addEventListener("click", () => this.setSpeed(factor));
      this.speedButtons.push(button);
      speedWrap.appendChild(button);
    });

    this.label.className = "weather-timeline-label";

    controls.append(this.playButton, live, speedWrap, this.label);

    FORECAST_PRESETS.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = preset.label;
      button.title = "Prévision (simulation vers l'avant)";
      button.addEventListener("click", () => {
        this.setPlaying(false);
        this.setPosition(preset.seconds, true);
      });
      controls.appendChild(button);
    });

    this.slider.type = "range";
    this.slider.className = "weather-timeline-slider";
    this.slider.min = String(this.minSeconds);
    this.slider.max = String(this.maxSeconds);
    this.slider.step = "1";
    this.slider.value = "0";
    this.slider.addEventListener("input", () => {
      this.setPlaying(false);
      this.setPosition(Number(this.slider.value), false);
    });

    this.root.append(controls, this.slider);
    this.updateLabel();
  }

  get value(): number {
    return this.position;
  }

  /**
   * Met à jour la plage disponible : `oldestOffset` est négatif (plus ancien
   * instantané enregistré), `forecastMax` positif (horizon de prévision).
   */
  setRange(oldestOffset: number, forecastMax: number): void {
    // Au moins une minute de profondeur visible, même au tout début.
    this.minSeconds = Math.min(-60, Math.floor(oldestOffset));
    this.maxSeconds = Math.max(60, Math.floor(forecastMax));
    this.slider.min = String(this.minSeconds);
    this.slider.max = String(this.maxSeconds);
    if (this.position < this.minSeconds) this.setPosition(this.minSeconds, true);
    else if (this.position > this.maxSeconds) this.setPosition(this.maxSeconds, true);
  }

  /** Avance la lecture. `delta` = secondes réelles écoulées. */
  tick(delta: number): void {
    if (!this.playing) return;
    let next = this.position + delta * PLAYBACK_RATE * this.speed;
    // Boucle radar : on relit la fenêtre passée [oldest .. maintenant].
    if (next >= 0) {
      next = this.minSeconds;
    }
    this.setPosition(next, true);
  }

  private togglePlay(): void {
    this.setPlaying(!this.playing);
    if (this.playing && this.position >= 0) {
      // Démarrer une boucle de relecture depuis le plus ancien instantané.
      this.setPosition(this.minSeconds, true);
    }
  }

  private setPlaying(playing: boolean): void {
    this.playing = playing;
    this.playButton.textContent = playing ? "⏸" : "▶";
    this.playButton.classList.toggle("active", playing);
  }

  private setSpeed(factor: number): void {
    this.speed = factor;
    this.speedButtons.forEach((button) => {
      button.classList.toggle("active", button.textContent === `x${factor}`);
    });
  }

  private setPosition(seconds: number, syncSlider: boolean): void {
    const clamped = Math.max(this.minSeconds, Math.min(this.maxSeconds, Math.round(seconds)));
    this.position = clamped;
    if (syncSlider) this.slider.value = String(clamped);
    this.updateLabel();
    this.onChange(clamped);
  }

  private updateLabel(): void {
    this.label.textContent = formatOffset(this.position);
  }
}

function formatOffset(seconds: number): string {
  if (Math.abs(seconds) < 1) return "Live";
  const sign = seconds < 0 ? "-" : "+";
  const abs = Math.abs(seconds);
  if (abs < 60 * 60) {
    const m = Math.floor(abs / 60);
    const s = Math.floor(abs % 60);
    const suffix = seconds < 0 ? " ago" : "";
    return `${sign}${m}:${String(s).padStart(2, "0")}${suffix}`;
  }
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}
