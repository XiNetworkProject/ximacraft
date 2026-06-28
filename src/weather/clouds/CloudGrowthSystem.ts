/**
 * Moteur de croissance des nuages.
 *
 * Pour chaque {@link CloudMass}, lit les conditions locales (humidité,
 * instabilité, pression, vent, risque d'orage) et fait évoluer sa maturité,
 * son type, ses dimensions, sa noirceur et son enclume.
 *
 * Règles appliquées (cf. cahier des charges) :
 *  - humidité faible           → support faible → le nuage se dissipe ;
 *  - pression basse            → favorise la croissance ;
 *  - pression haute / clearing → dissipe ;
 *  - forte instabilité + humidité → développement vertical (CB) ;
 *  - CB mûr + vent d'altitude  → enclume étirée dans le vent.
 */

import { CloudMass } from "./CloudMass";
import { WeatherSample } from "../WeatherTypes";
import { approach, clamp01, smoothstep } from "../WeatherMath";
import { CloudType, classifyCloud, cloudBaseAltitude, isStorm } from "./CloudType";

/** Fraction du vent répercutée en dérive visuelle des nuages (lente). */
const DRIFT = 0.25;

export class CloudGrowthSystem {
  /** Fait évoluer une masse d'un pas, selon les conditions échantillonnées. */
  update(mass: CloudMass, sample: WeatherSample, dt: number): void {
    mass.age += dt;

    // Conditions locales lissées (le nuage "ressent" son environnement).
    mass.moisture = approach(mass.moisture, sample.humidity, 0.12, dt);
    mass.instability = approach(mass.instability, sample.instability, 0.12, dt);
    const windSpeed = sample.windSpeed;

    // Support de croissance : humidité × facteur de pression.
    const moistFactor = clamp01((mass.moisture - 0.3) / 0.5);
    const pressureFactor = clamp01((1014 - sample.pressure) / 16 + 0.5); // basse pression → >0.5
    let support = Math.min(1, moistFactor * (0.4 + pressureFactor * 0.8));
    if (mass.dissipating) support = 0;

    // Croissance vers le support ; dissipation un peu plus rapide.
    const rate = support >= mass.growth ? 0.05 : 0.09;
    mass.growth = approach(mass.growth, support, rate, dt);

    // Type : imposé (commande) ou classé d'après les conditions.
    mass.type = mass.pinnedType ?? classifyCloud(mass.moisture, mass.instability, mass.growth, windSpeed);

    // Altitude de base douce selon le type + conditions locales : air sature et
    // basse pression abaissent la base, air sec la remonte. C'est une
    // approximation lisible, pas encore un vrai profil vertical.
    const saturationLowering = clamp01((mass.moisture - 0.52) / 0.36) * 18;
    const pressureLowering = clamp01((1012 - sample.pressure) / 18) * 10;
    const dryLift = clamp01((0.45 - mass.moisture) / 0.3) * 18;
    const stormLowering = isStorm(mass.type) ? 12 * mass.growth : 0;
    const targetBase = cloudBaseAltitude(mass.type) - saturationLowering - pressureLowering - stormLowering + dryLift;
    mass.y = approach(mass.y, targetBase, 4, dt);

    this.applyDimensions(mass);

    // Noirceur de la base : risque d'orage + instabilité, modulée par l'épaisseur.
    const darkTarget = clamp01(sample.thunderRisk * 0.7 + mass.instability * 0.25) * smoothstep(mass.growth);
    mass.darkness = approach(mass.darkness, darkTarget, 0.2, dt);

    // Densité (opacité) suit la maturité.
    mass.density = clamp01(mass.growth);

    // Enclume : seulement pour un CB mûr avec vent d'altitude.
    const anvilTarget = isStorm(mass.type) && mass.growth > 0.7 ? clamp01((windSpeed - 3) / 12) * mass.growth : 0;
    mass.anvilStretch = approach(mass.anvilStretch, anvilTarget, 0.05, dt);
    if (windSpeed > 1) {
      mass.anvilDirX = sample.windX / windSpeed;
      mass.anvilDirZ = sample.windZ / windSpeed;
    }

    // Dérive visuelle avec le vent (advection lente).
    mass.x += sample.windX * dt * DRIFT;
    mass.z += sample.windZ * dt * DRIFT;
  }

  /** Largeur/hauteur selon le type et la maturité. */
  private applyDimensions(mass: CloudMass): void {
    const g = mass.growth;
    switch (mass.type) {
      case CloudType.CIRRUS:
        mass.width = 70 + g * 50;
        mass.height = 6;
        break;
      case CloudType.STRATUS:
        mass.width = 90 + g * 70;
        mass.height = 10 + g * 6;
        break;
      case CloudType.FOG:
        mass.width = 80 + g * 60;
        mass.height = 6;
        break;
      case CloudType.CUMULUS:
        mass.width = 22 + g * 26;
        mass.height = mass.width * 0.7;
        break;
      case CloudType.CUMULUS_CONGESTUS:
        mass.width = 28 + g * 28;
        mass.height = mass.width * 1.4; // bourgeonnement vertical
        break;
      case CloudType.CUMULONIMBUS:
      case CloudType.ANVIL:
        mass.width = 38 + g * 36;
        mass.height = 55 + g * 95; // tour orageuse
        break;
    }
  }

  /** Le nuage doit-il être retiré ? */
  isDead(mass: CloudMass): boolean {
    return mass.age > mass.maxAge || (mass.growth < 0.03 && mass.age > 12);
  }
}
