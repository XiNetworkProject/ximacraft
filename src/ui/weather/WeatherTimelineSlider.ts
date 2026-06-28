const STEPS = [
  { label: "Now", seconds: 0 },
  { label: "+15m", seconds: 15 * 60 },
  { label: "+30m", seconds: 30 * 60 },
  { label: "+1h", seconds: 60 * 60 },
  { label: "+3h", seconds: 3 * 60 * 60 },
  { label: "+6h", seconds: 6 * 60 * 60 },
];

export class WeatherTimelineSlider {
  readonly root = document.createElement("div");
  private selected = 0;

  constructor(private readonly onChange: (seconds: number) => void) {
    this.root.className = "weather-timeline";
    this.render();
  }

  get value(): number {
    return STEPS[this.selected].seconds;
  }

  private render(): void {
    this.root.replaceChildren();
    STEPS.forEach((step, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = step.label;
      button.className = index === this.selected ? "active" : "";
      button.addEventListener("click", () => {
        this.selected = index;
        this.render();
        this.onChange(step.seconds);
      });
      this.root.appendChild(button);
    });
  }
}
