export class PauseMenu {
  readonly root: HTMLDivElement;
  private open = false;

  constructor(
    overlay: HTMLElement,
    callbacks: {
      resume: () => void;
      save: () => void;
      openMap: () => void;
      openWorldMap: () => void;
      openInventory: () => void;
      openCommands: () => void;
      openWorlds: () => void;
      openSettings: () => void;
      mainMenu: () => void;
    },
  ) {
    this.root = document.createElement("div");
    this.root.className = "pause-panel hidden";
    this.root.innerHTML = `
      <h2>Menu</h2>
      <p>Monde actif, meteo, inventaire et commandes.</p>
      <div class="button-stack"></div>
    `;
    const stack = this.root.querySelector(".button-stack")!;
    stack.append(
      this.button("Reprendre", callbacks.resume),
      this.button("Carte meteo", callbacks.openMap, "secondary"),
      this.button("Carte monde / journal", callbacks.openWorldMap, "secondary"),
      this.button("Inventaire / craft", callbacks.openInventory, "secondary"),
      this.button("Commandes", callbacks.openCommands, "secondary"),
      this.button("Mes mondes", callbacks.openWorlds, "secondary"),
      this.button("Parametres", callbacks.openSettings, "secondary"),
      this.button("Sauvegarder", callbacks.save, "secondary"),
      this.button("Menu principal", callbacks.mainMenu, "secondary"),
    );
    overlay.appendChild(this.root);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.root.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add("hidden");
  }

  private button(label: string, onClick: () => void, tone = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = `ui-button ${tone}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }
}
