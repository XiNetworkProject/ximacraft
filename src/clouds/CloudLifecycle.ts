/**
 * Cycle de vie d'une masse nuageuse convective.
 *
 * CLEAR_AIR → FORMING → CUMULUS → CUMULUS_CONGESTUS → CUMULONIMBUS → ANVIL
 * (+ PRECIPITATING en parallèle) → DISSIPATING → DISSIPATED.
 *
 * Les transitions sont pilotées par la hauteur du sommet, la maturité et
 * l'instabilité dans {@link CloudMass}, pas par un timer arbitraire.
 */
export enum CloudLifecycle {
  CLEAR_AIR = "CLEAR_AIR",
  FORMING = "FORMING",
  CUMULUS = "CUMULUS",
  CUMULUS_CONGESTUS = "CUMULUS_CONGESTUS",
  CUMULONIMBUS = "CUMULONIMBUS",
  ANVIL = "ANVIL",
  PRECIPITATING = "PRECIPITATING",
  DISSIPATING = "DISSIPATING",
  DISSIPATED = "DISSIPATED",
}

/** Le nuage est-il encore en croissance (peut bourgeonner / monter) ? */
export function isGrowing(state: CloudLifecycle): boolean {
  return (
    state === CloudLifecycle.FORMING ||
    state === CloudLifecycle.CUMULUS ||
    state === CloudLifecycle.CUMULUS_CONGESTUS ||
    state === CloudLifecycle.CUMULONIMBUS
  );
}

/** Stade orageux (base sombre, enclume possible, précipitations) ? */
export function isStormy(state: CloudLifecycle): boolean {
  return (
    state === CloudLifecycle.CUMULONIMBUS ||
    state === CloudLifecycle.ANVIL ||
    state === CloudLifecycle.PRECIPITATING
  );
}
