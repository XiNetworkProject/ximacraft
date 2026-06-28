/**
 * Choix pondéré du prochain scénario météo (PUR, testable).
 *
 * Remplace `if (timer<=0 && Math.random()<0.4) spawnStorm()`. Ici :
 *  - on part des candidats `next` du scénario courant (transitions crédibles) ;
 *  - on pondère chaque candidat par le CONTEXTE (saison, heure, humidité,
 *    température, tendance de pression, instabilité, couvert neigeux) ;
 *  - les orages restent RARES : leur poids n'est élevé que si humidité ET
 *    instabilité sont réellement hautes ;
 *  - un malus de répétition évite de rejouer le même scénario en boucle.
 */

import { SCENARIOS } from "./WeatherScenarioData";
import { WeatherContext, WeatherScenario as WS } from "./WeatherScene";

export type Rng = () => number;

/** Convertit l'heure normalisée en proximité du milieu de journée 0..1. */
function daytimeHeating(ctx: WeatherContext): number {
  // pic à 14h (~0.58 en normalisé), nul la nuit.
  const t = ctx.timeOfDay;
  const solar = Math.cos((t - 0.58) * Math.PI * 2);
  return Math.max(0, solar);
}

function isCold(ctx: WeatherContext): boolean {
  return ctx.biomeTemperature <= 3 || ctx.snowCover > 0.4;
}

function isHot(ctx: WeatherContext): boolean {
  return ctx.biomeTemperature >= 24;
}

/**
 * Poids de base d'un scénario dans un contexte donné. >0. Les multiplicateurs
 * sont volontairement lisibles plutôt que « scientifiques ».
 */
export function scenarioWeight(scenario: WS, ctx: WeatherContext): number {
  const heat = daytimeHeating(ctx);
  const humid = ctx.biomeHumidity;
  const cold = isCold(ctx);
  const hot = isHot(ctx);
  const fallingPressure = Math.max(0, -ctx.currentPressureTrend); // baisse = perturbation
  const calmNight = (1 - heat) * (ctx.season === "AUTUMN" || ctx.season === "WINTER" ? 1.3 : 1);
  const terrainCloudBoost = ctx.terrainLift * (0.35 + humid * 0.45);
  const wetGroundFog = ctx.surfaceWetness * 0.45 + ctx.snowCover * 0.25;

  switch (scenario) {
    case WS.CLEAR_DAY:
      return cold ? 0.6 : 1.4 - fallingPressure * 0.8 + (1 - humid) * 0.8;
    case WS.FAIR_CUMULUS_DAY:
      return cold ? 0.3 : 1.2 * (0.4 + heat) * (0.5 + humid) - fallingPressure * 0.4;
    case WS.VARIABLE_CLOUD_DAY:
      return cold ? 0.4 : 0.9 * (0.4 + heat) + humid * 0.5 + fallingPressure * 0.4;
    case WS.GREY_DRY_DAY:
      return 0.7 + humid * 0.5 + terrainCloudBoost + (ctx.season === "AUTUMN" ? 0.4 : 0) - heat * 0.3;
    case WS.MORNING_FOG:
      // brume : nuit/lever calme, humide ; jamais en plein soleil venté.
      return (calmNight + wetGroundFog) * (0.5 + humid) * (ctx.timeOfDay < 0.35 || ctx.timeOfDay > 0.85 ? 1.6 : 0.4) * (cold ? 0.4 : 1);
    case WS.WARM_FRONT_SEQUENCE:
      return (0.5 + humid + terrainCloudBoost) * (0.6 + fallingPressure * 1.4);
    case WS.FRONTAL_RAIN_SEQUENCE:
      return (0.4 + humid * 1.1 + terrainCloudBoost) * (0.4 + fallingPressure * 1.6);
    case WS.COLD_FRONT_SEQUENCE:
      return (0.4 + humid * 0.8) * (0.4 + fallingPressure * 1.3) * (hot || !cold ? 1 : 0.6);
    case WS.POST_FRONTAL_SHOWERS:
      return 0.6 + humid * 0.6; // surtout enchaîné après un front
    case WS.ISOLATED_SHOWER_DAY:
      return cold ? 0.2 : (0.3 + heat * 0.8 + ctx.terrainLift * 0.18) * (0.3 + humid * 1.1);
    case WS.ISOLATED_THUNDERSTORM_DAY:
      // RARE : besoin de chaleur diurne + humidité + instabilité élevées.
      return cold ? 0.02 : Math.max(0, heat - 0.25) * Math.max(0, humid - 0.45) * (2.2 + ctx.terrainLift * 0.55);
    case WS.ORGANIZED_THUNDERSTORM_DAY:
      // TRÈS RARE : pression en baisse forte + chaleur + humidité.
      return cold ? 0.01 : Math.max(0, heat - 0.3) * Math.max(0, humid - 0.55) * Math.max(0, fallingPressure - 0.2) * 3;
    case WS.WINTER_OVERCAST_SNOW:
      return cold ? (0.6 + humid * 1.2) * (0.5 + fallingPressure) : 0.0;
    case WS.WINTER_SHOWERS:
      return cold ? 0.8 + humid * 0.6 : 0.0;
    case WS.BLIZZARD_EVENT:
      return cold && ctx.snowCover > 0.2 ? Math.max(0, humid - 0.5) * 1.4 * (0.4 + fallingPressure) : 0.0;
    case WS.FREEZING_FOG_EVENT:
      return cold ? calmNight * (0.4 + humid) * (ctx.timeOfDay < 0.35 || ctx.timeOfDay > 0.85 ? 1.4 : 0.3) : 0.0;
    case WS.HEAT_HAZE_DAY:
      return hot ? 1.4 + heat * 0.8 - humid * 0.6 : 0.05;
    case WS.DRY_WIND_DAY:
      return hot || humid < 0.3 ? 0.6 + (1 - humid) * 0.8 : 0.1;
  }
}

/**
 * Choisit le prochain scénario : tire dans les candidats `next` du scénario
 * courant (ou tous au premier choix), pondéré par le contexte, avec un malus
 * de répétition contre les `recent`.
 */
export function chooseScenario(
  prev: WS | null,
  ctx: WeatherContext,
  rng: Rng,
  recent: readonly WS[] = [],
): WS {
  const candidates: WS[] = prev ? [...SCENARIOS[prev].next] : (Object.keys(SCENARIOS) as WS[]);
  // Toujours garder un filet de variété : on ajoute quelques scénarios sûrs.
  for (const safe of [WS.CLEAR_DAY, WS.FAIR_CUMULUS_DAY, WS.GREY_DRY_DAY]) {
    if (!candidates.includes(safe)) candidates.push(safe);
  }

  const weights = candidates.map((scenario) => {
    let w = Math.max(0.001, scenarioWeight(scenario, ctx));
    if (recent[0] === scenario) w *= 0.18;
    else if (recent[1] === scenario) w *= 0.5;
    return w;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < candidates.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
