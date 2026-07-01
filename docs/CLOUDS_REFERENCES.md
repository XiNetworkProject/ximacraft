# Références nuages volumétriques — couches stratiformes (Phase 2A-2)

Ce document trace précisément, pour le rendu des **couches stratiformes**
(`src/render/weather/StratiformCloudRenderer.ts` +
`src/render/weather/StratiformNoiseTextures.ts`), ce qui a été **adapté** depuis
des sources sous licence, ce qui a seulement été **étudié**, et ce qui relève de
**l'inspiration esthétique** sans reprise de code.

> Règle du projet : aucune copie de code/shader/asset sans licence vérifiée.
> Tout ce qui est listé « adapté » est une **ré-implémentation clean-room** en
> TypeScript + GLSL (WebGL2 / Three.js) — aucun fichier source amont n'a été
> copié. Les licences MIT amont sont néanmoins conservées par bonne foi dans
> `LICENSES/` et créditées ci-dessous.

---

## 1. Sebastian Lague — "Coding Adventure: Clouds" (référence principale)

- Vidéo : https://www.youtube.com/watch?v=4QOcCGI6xOU
- Dépôt : https://github.com/SebLague/Clouds
- Licence : **MIT** — `Copyright (c) 2019 Sebastian Lague`
  (texte complet : `LICENSES/seb-lague-clouds-MIT.txt`).

### Techniques réellement ADAPTÉES (clean-room, aucune copie de code Unity/HLSL)
- **Raymarching dans un volume** borné + **intersection ray-box** (slab method) :
  `boxIntersect()` dans le fragment shader stratiforme.
- **Champ de densité forme + détail** : bruit basse fréquence (silhouette) érodé
  par un bruit haute fréquence sur les bords (`shapeField` + érosion Worley dans
  `densityField`).
- **Bruit Perlin-Worley / Worley FBM pré-baké** en texture 3D tileable :
  `StratiformNoiseTextures.ts` (canaux forme + octaves d'érosion/warp).
- **Érosion des contours** par `1 - detailWorley` pondérée par un masque de bord.
- **Gradient vertical** (base douce → cœur → sommet érodé) : `verticalEnvelope`.
- **Beer-Lambert** pour la transmittance (`exp(-opticalDepth)`), avec un
  **light-march court** (2-3 échantillons) vers le soleil.
- **Phase de Henyey-Greenstein** (approximation **double lobe** avant/arrière) :
  `hg()` + `phase()`.
- **Jitter** de départ de pas pour casser le banding (ici en blue-noise STABLE,
  cf. §2).
- **Early-exit** quand la transmittance devient faible (`transmittance < 0.02`).

### Seulement ÉTUDIÉ (non repris tel quel)
- L'architecture Unity/HLSL complète, la weather-map 2D d'UE/Horizon, le
  container box unique fixe : **non** repris — XimaCraft garde des volumes
  world-space par couche qui suivent l'observateur (boîte invisible) avec bruit
  en coordonnées monde absolues.

---

## 2. frmlinn — clouds-sim (référence WebGL navigateur)

- Dépôt : https://github.com/frmlinn/clouds-sim
- Licence : **MIT** — `Copyright (c) 2026 frmlinn`
  (texte complet : `LICENSES/clouds-sim-MIT.txt`).

### Techniques réellement ADAPTÉES (clean-room)
- **Bruit 3D pré-baké + cache** : les `Data3DTexture` sont générées **une seule
  fois** puis mises en cache au niveau module (`getStratiformNoiseTextures()`),
  jamais re-bakées par frame.
- **Contraintes WebGL2** : `sampler3D` + `Data3DTexture`, `precision highp
  sampler3D`, GLSL3 ; **fallback propre** en FBM 2D si les textures 3D sont
  indisponibles (define `HAS_NOISE3D`).
- **Compromis qualité / FPS navigateur** : presets `low` / `balanced` / `high`
  pilotant le nombre de pas de raymarch, le nombre d'échantillons de light-march
  et la force du bruit de détail.
- **Jitter blue-noise** : jitter *interleaved gradient noise* **stable dans le
  temps** (pas de grain qui danse, pas de scintillement).

### Seulement ÉTUDIÉ (non repris dans cette phase)
- **Textures 3D via render targets GPU**, **shadow pass solaire** dédié,
  **accumulation temporelle (TAA)** : étudiés mais **non** livrés ici. Le
  `CloudVolumeRenderer` **convectif** utilise déjà un TAA/low-res séparé ; pour
  les couches stratiformes (rendues inline dans la scène), aucun TAA n'a été
  ajouté — un rendu stable sans flou a été préféré à un TAA instable.

---

## 3. mhr1235 — cl0ud (inspiration esthétique UNIQUEMENT)

- Dépôt : https://github.com/mhr1235/cl0ud
- **Aucun code, shader, texture ou asset repris.** Utilisé seulement comme
  inspiration visuelle : douceur, ambiance, dégradés, densité perçue, rendu
  atmosphérique, composition des masses. **Aucune licence confirmée → aucune
  importation.**

---

## Récapitulatif

| Source | Licence | Statut | Fichiers concernés |
|---|---|---|---|
| SebLague/Clouds | MIT (c) 2019 Sebastian Lague | **Adapté** (clean-room) | `StratiformCloudRenderer.ts`, `StratiformNoiseTextures.ts`, `CumulusFieldRenderer.ts` |
| frmlinn/clouds-sim | MIT (c) 2026 frmlinn | **Adapté** (clean-room) | `StratiformNoiseTextures.ts`, `StratiformCloudRenderer.ts`, `CumulusFieldRenderer.ts` |
| mhr1235/cl0ud | Non confirmée | **Inspiration esthétique seule — aucun code** | — |

## Phase 2B-2 / 2A-3 — continuité des ciels + régimes de beau temps

- **Cumulus (silhouette)** : structure claire macro (lobes = base) → medium
  breakup (2ᵉ octave 3D + domain-warp) → fine erosion (Worley détail). Le bruit
  3D définit désormais réellement la silhouette (remap par la couverture macro) :
  base plus plate, dessous plus sombre/irrégulier, sommet bourgeonnant, contours
  moins ronds.
- **Régimes déterministes** (`CumulusRegimeName`, table `CUMULUS_REGIMES`) :
  crystal_clear → humid_summer_cumulus, chacun modifiant couverture, espacement,
  taille, base, épaisseur, maturité, chance de formation dominante, fraction de
  ciel bleu et portée horizon. Dérivés de la seed/zone/humidité/ciel, ou forcés
  via `/weather visual cumulus_clear|sparse|classic|broken|dominant|humid`.
- **Autorité cumulus** : sous ciel fair-weather, `RegionalCloudController.setAmbientSuppressed(true)`
  coupe les cumulus ambiants convectifs/legacy (les orages, ciels non-cumulus,
  restent intacts) → `CumulusFieldRenderer` seule autorité.
- **Continuité overcast/rain** : fondu horizontal doux des decks stratiformes
  (plus de face de boîte visible) + front pluvieux progressif (voile bord d'attaque
  → nimbostratus dense) + horizon gris prolongé dans `SkySystem` (mêmes données
  météo) → plus de frontière bleu/gris nette ni de mur diagonal.

## Phase 2B-1 — champ de cumulus de beau temps

`src/clouds/FairWeatherCumulusField.ts` (logique monde, pure) + `src/render/weather/CumulusFieldRenderer.ts` (rendu volumétrique LOD) réutilisent le **même bruit 3D partagé** (`StratiformNoiseTextures`) et les mêmes techniques adaptées (raymarch ray-box, Beer-Lambert, Henyey-Greenstein, jitter blue-noise stable, early-exit, érosion forme+détail). Le champ est **streamé en espace de masse d'air** (`airMass = world - wind·time`) sur une grille globale déterministe (hash par cellule), avec 3 zones de LOD et fondu atmosphérique. Aucun sprite/billboard/blob 2D ; `SkyCloudPopulationRenderer` reste coupé. Audit : `CloudVolumeRenderer` (unique FrameCompositor, lié à `ConvectiveCloudSystem`, budget 8 bakes) n'a pas été détourné — inadapté à un champ streamé de dizaines de cumulus.

Licences amont conservées : `LICENSES/seb-lague-clouds-MIT.txt`,
`LICENSES/clouds-sim-MIT.txt`. Voir aussi `THIRD_PARTY_NOTICES.md` et
`docs/WEATHER_RENDERING_REFERENCES.md`.
