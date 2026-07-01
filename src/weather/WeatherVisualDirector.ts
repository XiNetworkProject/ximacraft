/**
 * Autorité visuelle météo — SOURCE DE VÉRITÉ UNIQUE du rendu.
 *
 * Toute la météo (carte, radar, pluie, nuages, brouillard, éclairage) est pilotée
 * par une seule simulation : {@link WeatherEngine} (+ scène du WeatherDirector).
 * Ce director-ci ne touche PAS la simulation ; il décide seulement QUEL renderer
 * a le droit de dessiner CHAQUE phénomène, et gère la bascule A/B entre le
 * nouveau rendu (`new`) et l'ancien (`legacy`).
 *
 * RÈGLE FONDAMENTALE : la météo existe dans le monde, pas autour de la caméra.
 * Les renderers ancrés-caméra qui « suivaient » le joueur (dôme fBm stratiforme,
 * sprites 2D de cumulus) sont donc DÉSACTIVÉS par défaut (mode `new`) et ne
 * restent accessibles que pour la comparaison A/B.
 */

export type WeatherVisualMode = "new" | "legacy";

/** Renderer basculable (dôme stratiforme, sprites…). */
export interface ToggleableRenderer {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export interface WeatherVisualTargets {
  /** Ancien dôme fBm centré caméra (plafond noir/quadrillé). */
  stratiformDome: ToggleableRenderer;
  /** Ancien champ de sprites/points (petits nuages 2D « stickers »). */
  cloudSprites: ToggleableRenderer;
}

/** Une ligne du tableau d'autorité (quel renderer produit quoi). */
export interface WeatherLayerAuthority {
  phenomenon: string;
  authority: string;
  worldAnchored: boolean;
  active: () => boolean;
  note?: string;
}

export class WeatherVisualDirector {
  private mode: WeatherVisualMode = "new";
  private readonly authorities: WeatherLayerAuthority[];

  constructor(private readonly targets: WeatherVisualTargets) {
    this.authorities = [
      {
        phenomenon: "Atmosphère (ciel, horizon, halo soleil/lune)",
        authority: "SkySystem (dôme ciel + éclairage)",
        worldAnchored: false,
        active: () => true,
        note: "ciel = coupole caméra (normal) ; couleur pilotée par la couverture/pluie régionale",
      },
      {
        phenomenon: "Nuages convectifs (cumulus, congestus, Cb, orages)",
        authority: "CloudVolumeRenderer (raymarch volumétrique)",
        worldAnchored: true,
        active: () => true,
      },
      {
        phenomenon: "Précipitations distantes (rideaux/arbres de pluie)",
        authority: "CloudVolumeRenderer / RainShaftRenderer",
        worldAnchored: true,
        active: () => true,
      },
      {
        phenomenon: "Précipitations proches (pluie/neige autour du joueur)",
        authority: "PrecipitationRenderer + RainCurtainRenderer",
        worldAnchored: false,
        active: () => true,
        note: "volume local suivant la caméra mais piloté par la cellule/scène réelle",
      },
      {
        phenomenon: "Brouillard / brume",
        authority: "FogBankRenderer + THREE.Fog (SkySystem)",
        worldAnchored: false,
        active: () => true,
        note: "phase 2 : brouillard volumétrique dépendant du relief",
      },
      {
        phenomenon: "Neige au sol / manteau",
        authority: "WorldSnowSystem + GroundCoverRenderer",
        worldAnchored: true,
        active: () => true,
      },
      {
        phenomenon: "Carte / radar",
        authority: "WeatherMapData (lit WeatherEngine)",
        worldAnchored: true,
        active: () => true,
      },
      {
        phenomenon: "Nuages stratiformes (cirrus/alto/strato/nimbo)",
        authority: "— (phase 2 : couches volumétriques ancrées monde)",
        worldAnchored: false,
        active: () => this.targets.stratiformDome.isEnabled(),
        note: "LEGACY: dôme fBm caméra (plafond quadrillé) — coupé en mode new",
      },
      {
        phenomenon: "Cumulus lointains en sprites 2D",
        authority: "SkyCloudPopulationRenderer (points)",
        worldAnchored: true,
        active: () => this.targets.cloudSprites.isEnabled(),
        note: "LEGACY: « stickers » plats — coupé en mode new",
      },
    ];
    this.apply();
  }

  getMode(): WeatherVisualMode {
    return this.mode;
  }

  setMode(mode: WeatherVisualMode): void {
    this.mode = mode;
    this.apply();
  }

  /** Applique la visibilité des renderers legacy selon le mode courant. */
  private apply(): void {
    const legacy = this.mode === "legacy";
    // Mode `new` : les deux offenders ancrés-caméra sont coupés.
    this.targets.stratiformDome.setEnabled(legacy);
    this.targets.cloudSprites.setEnabled(legacy);
  }

  /** Tableau d'autorité pour `/weather visual layers` (qui dessine quoi). */
  layersReport(): string[] {
    const lines: string[] = [];
    lines.push(`Weather visual mode: ${this.mode.toUpperCase()} (source unique = WeatherEngine)`);
    lines.push("phénomène → autorité [ancrage] [état]");
    for (const a of this.authorities) {
      const anchor = a.worldAnchored ? "monde" : "caméra";
      const state = a.active() ? "ON" : "off";
      lines.push(`• ${a.phenomenon}`);
      lines.push(`    → ${a.authority} [${anchor}] [${state}]${a.note ? ` — ${a.note}` : ""}`);
    }
    return lines;
  }
}
