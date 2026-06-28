/**
 * WeatherDirector — façade de compatibilité.
 *
 * Le cerveau météo a migré vers {@link WeatherScenarioDirector} (atlas météo
 * multi-axes, plans persistants, ciels normaux variés). Cette classe garde
 * l'API historique attendue par `Game`, les commandes et les cinématiques
 * (`update`, `reset`, `hold`, `startPlan`, `debugState`, `regime`) et la
 * traduit vers le nouveau directeur. Aucune logique de timer/jet aléatoire ici.
 */

import { WeatherEngine } from "./WeatherEngine";
import { WeatherScenarioDirector, WeatherEnvironmentInput, ScenarioForceOptions } from "./scene/WeatherScenarioDirector";
import { SkyState, SynopticRegime, WeatherScenario } from "./scene/WeatherScene";
import { WeatherRegime, WeatherTransitionPlanId } from "./sky/WeatherTransitionPlan";

export type { WeatherRegime, WeatherTransitionPlanId } from "./sky/WeatherTransitionPlan";

/** Régime legacy <-> régime synoptique (libellés HUD/debug conservés). */
const REGIME_TO_SYNOPTIC: Record<WeatherRegime, SynopticRegime> = {
  CLEAR: SynopticRegime.STABLE_HIGH_PRESSURE,
  MOISTURE_RETURN: SynopticRegime.HUMID_HIGH_PRESSURE,
  WARM_FRONT: SynopticRegime.WARM_FRONT_APPROACH,
  STRATIFORM_RAIN: SynopticRegime.OCCLUDED_FRONT,
  CONVECTIVE_OUTBREAK: SynopticRegime.ISOLATED_CONVECTION,
  COLD_FRONT: SynopticRegime.COLD_FRONT_PASSAGE,
  WINTER_STORM: SynopticRegime.WINTER_LOW_PRESSURE,
  CLEARING: SynopticRegime.POST_FRONTAL_AIR,
};

/** Anciens plans <-> scénarios de l'atlas. */
const PLAN_TO_SCENARIO: Record<WeatherTransitionPlanId, WeatherScenario> = {
  FAIR_WEATHER: WeatherScenario.FAIR_CUMULUS_DAY,
  WARM_FRONT_PASSAGE: WeatherScenario.WARM_FRONT_SEQUENCE,
  COLD_FRONT_PASSAGE: WeatherScenario.COLD_FRONT_SEQUENCE,
  ISOLATED_CONVECTION: WeatherScenario.ISOLATED_THUNDERSTORM_DAY,
  WINTER_STORM_PASSAGE: WeatherScenario.WINTER_OVERCAST_SNOW,
};

function synopticToRegime(synoptic: SynopticRegime): WeatherRegime {
  switch (synoptic) {
    case SynopticRegime.STABLE_HIGH_PRESSURE:
    case SynopticRegime.COLD_CLEAR_OUTBREAK:
    case SynopticRegime.HEATWAVE:
    case SynopticRegime.DRY_WIND_EVENT:
      return "CLEAR";
    case SynopticRegime.HUMID_HIGH_PRESSURE:
    case SynopticRegime.WEAK_LOW_PRESSURE:
      return "MOISTURE_RETURN";
    case SynopticRegime.WARM_FRONT_APPROACH:
    case SynopticRegime.WARM_SECTOR:
      return "WARM_FRONT";
    case SynopticRegime.OCCLUDED_FRONT:
      return "STRATIFORM_RAIN";
    case SynopticRegime.CONVECTIVE_DAY:
    case SynopticRegime.ISOLATED_CONVECTION:
    case SynopticRegime.ORGANIZED_CONVECTION:
      return "CONVECTIVE_OUTBREAK";
    case SynopticRegime.COLD_FRONT_APPROACH:
    case SynopticRegime.COLD_FRONT_PASSAGE:
      return "COLD_FRONT";
    case SynopticRegime.WINTER_LOW_PRESSURE:
      return "WINTER_STORM";
    case SynopticRegime.POST_FRONTAL_AIR:
    case SynopticRegime.FOG_PRONE_NIGHT:
      return "CLEARING";
  }
}

export class WeatherDirector {
  readonly scenarios: WeatherScenarioDirector;
  regime: WeatherRegime = "CLEAR";

  constructor(private readonly engine: WeatherEngine) {
    this.scenarios = new WeatherScenarioDirector(engine);
  }

  update(dt: number): void {
    this.scenarios.update(dt);
    this.regime = synopticToRegime(this.scenarios.currentScene.synopticRegime);
  }

  reset(): void {
    this.scenarios.reset();
    this.regime = "CLEAR";
  }

  /** Maintient un régime déterministe (cinématiques) : mode passif. */
  hold(regime: WeatherRegime, durationSeconds = 900): void {
    this.scenarios.hold(REGIME_TO_SYNOPTIC[regime], durationSeconds);
    this.regime = regime;
  }

  /** Lance un scénario complet sans sauter d'étapes intermédiaires. */
  startPlan(planId: WeatherTransitionPlanId, startStep = 0): void {
    this.scenarios.forceScenario(PLAN_TO_SCENARIO[planId], { startPhase: startStep });
  }

  /** Force directement un scénario de l'atlas (commande /weather scenario). */
  forceScenario(scenario: WeatherScenario, options?: ScenarioForceOptions): void {
    this.scenarios.forceScenario(scenario, options);
  }

  /** Force un état de ciel unique pour quelques minutes (presets orage). */
  forceSky(sky: SkyState, seconds?: number, feature?: Parameters<WeatherScenarioDirector["forceSky"]>[2]): void {
    this.scenarios.forceSky(sky, seconds, feature);
  }

  setEnvironment(env: WeatherEnvironmentInput): void {
    this.scenarios.setEnvironment(env);
  }

  debugState(): {
    regime: WeatherRegime;
    secondsUntilTransition: number;
    activeEvents: number;
    flowX: number;
    flowZ: number;
    plan: string;
    step: number;
    milestone: string;
    recentPlans: readonly string[];
  } {
    const s = this.scenarios;
    return {
      regime: this.regime,
      secondsUntilTransition: s.phaseSecondsLeft,
      activeEvents: this.engine.activeEventCount,
      flowX: s.flow.x,
      flowZ: s.flow.z,
      plan: s.scenarioId,
      step: s.phaseIndex,
      milestone: s.currentMilestone,
      recentPlans: [...s.recentScenarios],
    };
  }
}
