import { button, focusPrimary, MenuPage } from "./MenuPage";
import { createXimaCraftLogo } from "./XimaCraftLogo";

export class CreditsPage implements MenuPage {
  readonly route = "credits" as const;
  readonly element = document.createElement("section");

  constructor(callbacks: { back: () => void }) {
    this.element.className = "menu-credits-page";
    const header = document.createElement("header");
    header.className = "menu-page-header";
    header.append(createXimaCraftLogo(true), button("Retour", callbacks.back, "secondary"));
    const content = document.createElement("div");
    content.className = "credits-scroll";
    content.innerHTML = `
      <h2>Credits</h2>
      <p><strong>XimaCraft</strong> - prototype voxel web 3D, monde vivant, meteo regionale et construction.</p>
      <h3>Developpement</h3>
      <p>Projet XiNetworkProject / XimaCraft, developpement local assiste.</p>
      <h3>Bibliotheques</h3>
      <ul>
        <li>Three.js - rendu WebGL.</li>
        <li>Vite / TypeScript - outillage de developpement.</li>
      </ul>
      <h3>Assets</h3>
      <p>Les nouveaux logos XimaCraft sont des SVG originaux ajoutes au projet. Les packs externes doivent rester documentes dans THIRD_PARTY_NOTICES quand ils sont integres.</p>
      <h3>Licences</h3>
      <p>Consulte THIRD_PARTY_NOTICES.md pour les attributions et dependances externes disponibles.</p>
    `;
    this.element.append(header, content);
  }

  focusPrimary(): void {
    focusPrimary(this.element);
  }
}
