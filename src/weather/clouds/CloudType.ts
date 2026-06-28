/**
 * Types de nuages et classification d'après les conditions atmosphériques.
 *
 * Logique pure (aucun Three.js). La fonction {@link classifyCloud} applique les
 * règles météo : peu d'humidité → voile fin ; humidité+instabilité moyennes →
 * cumulus ; forte humidité + faible instabilité → stratus ; forte humidité +
 * forte instabilité → cumulonimbus ; cumulonimbus mûr + vent d'altitude →
 * enclume.
 */

export enum CloudType {
  CIRRUS = "CIRRUS",
  STRATUS = "STRATUS",
  CUMULUS = "CUMULUS",
  CUMULUS_CONGESTUS = "CUMULUS_CONGESTUS",
  CUMULONIMBUS = "CUMULONIMBUS",
  ANVIL = "ANVIL",
  FOG = "FOG",
}

/** Altitude de base (Y monde) d'un type de nuage. */
export function cloudBaseAltitude(type: CloudType): number {
  switch (type) {
    case CloudType.CIRRUS:
      return 220;
    case CloudType.STRATUS:
      return 118;
    case CloudType.CUMULUS:
      return 126;
    case CloudType.CUMULUS_CONGESTUS:
      return 112;
    case CloudType.CUMULONIMBUS:
    case CloudType.ANVIL:
      return 104;
    case CloudType.FOG:
      return 56;
  }
}

/** Nuage à développement vertical (convectif) ? */
export function isConvective(type: CloudType): boolean {
  return (
    type === CloudType.CUMULUS ||
    type === CloudType.CUMULUS_CONGESTUS ||
    type === CloudType.CUMULONIMBUS ||
    type === CloudType.ANVIL
  );
}

/** Nuage d'orage (cumulonimbus / enclume) ? */
export function isStorm(type: CloudType): boolean {
  return type === CloudType.CUMULONIMBUS || type === CloudType.ANVIL;
}

/**
 * Classe un nuage à partir de son humidité, son instabilité, sa maturité
 * (growth) et le vent d'altitude. Source de vérité des règles de formation.
 */
export function classifyCloud(
  moisture: number,
  instability: number,
  growth: number,
  windSpeed: number,
): CloudType {
  // Air saturé, calme et stable au sol → brouillard.
  if (moisture > 0.9 && windSpeed < 1.5 && instability < 0.2) return CloudType.FOG;

  // Peu d'humidité → au mieux un voile élevé fin (sinon ~rien via growth faible).
  if (moisture < 0.32) return CloudType.CIRRUS;

  // Forte humidité + forte instabilité → convection profonde.
  if (moisture >= 0.55 && instability >= 0.55) {
    if (growth > 0.8 && windSpeed > 5) return CloudType.ANVIL; // mûr + vent d'altitude
    if (growth > 0.6) return CloudType.CUMULONIMBUS;
    return CloudType.CUMULUS_CONGESTUS; // en cours de développement
  }

  // Forte humidité + faible instabilité → couche stratiforme.
  if (moisture > 0.62 && instability < 0.32) return CloudType.STRATUS;

  // Humidité moyenne + un peu d'instabilité → cumulus de beau temps.
  if (instability >= 0.3) return CloudType.CUMULUS;

  return CloudType.STRATUS;
}
