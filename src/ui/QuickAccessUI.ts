export class QuickAccessUI {
  readonly root: HTMLDivElement;
  private readonly renderLabel: HTMLSpanElement;
  private readonly qualityLabel: HTMLSpanElement;

  constructor(
    overlay: HTMLElement,
    callbacks: {
      openMap: () => void;
      openWorldMap: () => void;
      openJournal: () => void;
      openInventory: () => void;
      openCommands: () => void;
      openCommandTable: () => void;
      cycleQuality: () => void;
      changeRenderDistance: (delta: number) => void;
    },
  ) {
    this.root = document.createElement("div");
    this.root.className = "quick-access hidden";
    this.root.innerHTML = `
      <button type="button" title="Carte meteo">M</button>
      <button type="button" title="Carte monde">N</button>
      <button type="button" title="Journal">J</button>
      <button type="button" title="Inventaire et craft">I</button>
      <button type="button" title="Console">/</button>
      <button type="button" title="Table des commandes">?</button>
      <button type="button" title="Qualite"><span class="quality-label">balanced</span></button>
      <button type="button" title="Moins de chunks">-</button>
      <span class="render-label">4</span>
      <button type="button" title="Plus de chunks">+</button>
    `;
    const buttons = [...this.root.querySelectorAll("button")];
    buttons[0].addEventListener("click", callbacks.openMap);
    buttons[1].addEventListener("click", callbacks.openWorldMap);
    buttons[2].addEventListener("click", callbacks.openJournal);
    buttons[3].addEventListener("click", callbacks.openInventory);
    buttons[4].addEventListener("click", callbacks.openCommands);
    buttons[5].addEventListener("click", callbacks.openCommandTable);
    buttons[6].addEventListener("click", callbacks.cycleQuality);
    buttons[7].addEventListener("click", () => callbacks.changeRenderDistance(-1));
    buttons[8].addEventListener("click", () => callbacks.changeRenderDistance(1));
    this.qualityLabel = this.root.querySelector(".quality-label")!;
    this.renderLabel = this.root.querySelector(".render-label")!;
    overlay.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }

  setState(quality: string, renderDistance: number): void {
    this.qualityLabel.textContent = quality;
    this.renderLabel.textContent = `${renderDistance}`;
  }
}
