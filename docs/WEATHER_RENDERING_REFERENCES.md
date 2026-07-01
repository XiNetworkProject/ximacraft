# Références — rendu météo XimaCraft

Ce document liste les références étudiées pour la refonte du rendu visuel météo
(atmosphère, nuages, brouillard, précipitations), avec leur licence et ce qui en
est **repris** (code adapté) ou seulement **étudié** (idées/algorithmes, aucun
code copié).

> Règle : aucun code n'est copié sans vérifier la licence. Tout code adapté d'une
> source sous licence (ex. BSD Bruneton) doit être crédité et conserver son
> en-tête de licence dans le fichier concerné.

## État actuel (Phase 1)

Phase 1 = fondations + laboratoire + règle « météo ancrée monde » + bascule A/B.
**Aucun** code externe n'a encore été repris : tout ce qui est listé ci-dessous
est pour l'instant en statut **ÉTUDIÉ**. Les phases suivantes (atmosphère LUT,
couches nuageuses volumétriques) pourront reprendre du code, auquel cas ce
tableau et les en-têtes de fichiers seront mis à jour.

---

## Atmosphère — LUT / diffusion

### Eric Bruneton — Precomputed Atmospheric Scattering
- Code : https://github.com/ebruneton/precomputed_atmospheric_scattering
- Démo/paper : https://ebruneton.github.io/precomputed_atmospheric_scattering/
- **Licence : BSD-3-Clause** (permissive ; attribution + conservation de la
  licence requises en cas de reprise de code).
- **Statut : ÉTUDIÉ.** Principe repris comme *architecture cible* : précalcul de
  LUTs (transmittance, single/multiple scattering → sky-view LUT + aerial
  perspective) pour un ciel/horizon physiquement cohérents avec le soleil,
  l'humidité et la couverture.
- **Si du code GLSL Bruneton est adapté en Phase 2+ :** créditer Eric Bruneton,
  copier l'en-tête BSD-3-Clause en tête du/des fichier(s) shader, et référencer
  ce document.

---

## Nuages volumétriques — lumière / ombres

### Unreal Engine — Volumetric Cloud Component
- https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-cloud-component-in-unreal-engine
- **Licence : documentation propriétaire Epic** (référence conceptuelle
  uniquement — aucun code repris).
- **Statut : ÉTUDIÉ.** Modèle de référence : nuages comme volumes de densité
  raymarchés à altitude réelle, éclairage par transmittance + phase HG,
  paramètres météo (couverture, type, altitude base/sommet). Notre
  `CloudVolumeRenderer` (convectif) suit déjà cette approche (volumes ancrés
  monde) ; les couches stratiformes viseront le même modèle en Phase 2.

### Toft, Bowles, Zimmermann — Optimisations for Real-Time Volumetric Cloudscapes
- https://arxiv.org/abs/1609.05344
- **Licence : arXiv (droits des auteurs)** — texte académique, aucun code repris.
- **Statut : ÉTUDIÉ.** Techniques d'optimisation du raymarching (échantillonnage
  *jittered*, réduction du nombre de pas, anti-aliasing temporel / réutilisation
  d'historique). Déjà appliqué en partie dans `CloudVolumeRenderer`
  (jitter + historique temporel + LOD par distance).

---

## Réalisme météorologique (structure, altitudes, comportement)

### WMO — International Cloud Atlas
- https://cloudatlas.wmo.int/en/home.html
- **Licence : contenu WMO (usage de référence)** — aucune donnée/asset repris.
- **Statut : ÉTUDIÉ.** Classification et altitudes des genres nuageux (cirrus,
  cirrostratus, altocumulus, altostratus, stratocumulus, stratus, nimbostratus,
  cumulus, cumulonimbus) pour donner à chaque couche une altitude et un
  comportement crédibles.

### Met Office — Types of clouds
- https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/clouds
- **Licence : © Crown Copyright (Met Office)** — référence uniquement.
- **Statut : ÉTUDIÉ.** Descriptions accessibles des couches (hautes/moyennes/
  basses) et de leur météo associée, pour le mapping scénario → apparence.

### Met Office — Fog
- https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/fog
- **Licence : © Crown Copyright (Met Office)** — référence uniquement.
- **Statut : ÉTUDIÉ.** Formation du brouillard (radiatif de vallée, advection,
  dépendance relief/eau/humidité/température/vent/heure) → cible du brouillard
  volumétrique dépendant du relief (Phase 2).

---

## Suivi des reprises de code

| Source | Licence | Statut | Fichier(s) | Crédit posé |
|---|---|---|---|---|
| Bruneton PAS | BSD-3-Clause | ÉTUDIÉ | — | — |
| UE Volumetric Cloud | Doc Epic | ÉTUDIÉ | — | — |
| Toft/Bowles/Zimmermann | arXiv | ÉTUDIÉ | — | — |
| WMO Cloud Atlas | WMO | ÉTUDIÉ | — | — |
| Met Office clouds/fog | Crown © | ÉTUDIÉ | — | — |
| SebLague/Clouds | MIT (c) 2019 Sebastian Lague | ADAPTÉ (clean-room) | `StratiformCloudRenderer.ts`, `StratiformNoiseTextures.ts`, `CumulusFieldRenderer.ts` | `LICENSES/seb-lague-clouds-MIT.txt` + en-têtes fichiers |
| frmlinn/clouds-sim | MIT (c) 2026 frmlinn | ADAPTÉ (clean-room) | `StratiformNoiseTextures.ts`, `StratiformCloudRenderer.ts`, `CumulusFieldRenderer.ts` | `LICENSES/clouds-sim-MIT.txt` + en-têtes fichiers |
| mhr1235/cl0ud | non confirmée | INSPIRATION ESTHÉTIQUE — aucun code | — | — |

Détail Phase 2A-2 (couches stratiformes) : voir `docs/CLOUDS_REFERENCES.md`.
Mettre ce tableau à jour dès qu'un fichier reprend du code d'une source.
