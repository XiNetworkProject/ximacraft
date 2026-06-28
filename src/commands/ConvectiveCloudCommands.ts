import { CloudMass, CloudTestProfile } from "../clouds/CloudMass";
import { ConvectiveCloudSystem } from "../clouds/ConvectiveCloudSystem";
import { CloudDebugMode, CloudVolumeRenderer } from "../render/clouds/CloudVolumeRenderer";

export class ConvectiveCloudCommands {
  constructor(
    private readonly system: ConvectiveCloudSystem,
    private readonly write: (message: string) => void,
    private readonly getObserver: () => { x: number; z: number },
    private readonly renderer?: CloudVolumeRenderer,
  ) {}

  handle(parts: string[]): boolean {
    if (parts[1] === "test") return this.handleTest(parts[2]);
    if (parts[1] === "debug") return this.handleDebug(parts[2]);
    if (parts[1] === "grow") return this.withNearest((mass) => {
      mass.grow();
      this.write(`Cloud #${mass.id} growth boosted.`);
    });
    if (parts[1] === "dissipate") return this.withNearest((mass) => {
      mass.dissipate();
      this.write(`Cloud #${mass.id} dissipating.`);
    });
    if (parts[1] !== "convective") return false;
    return this.handleLegacy(parts);
  }

  private handleTest(testName?: string): boolean {
    const profiles: Record<string, { profile: CloudTestProfile; distance: number }> = {
      cumulus_volume: { profile: "cumulus", distance: 900 },
      congestus_volume: { profile: "congestus", distance: 1500 },
      cumulonimbus_volume: { profile: "cumulonimbus", distance: 10300 },
      anvil_volume: { profile: "anvil", distance: 10300 },
      rainshaft: { profile: "rainshaft", distance: 4200 },
    };
    const test = testName ? profiles[testName] : undefined;
    if (!test) {
      this.write("Usage: /cloud test cumulus_volume|congestus_volume|cumulonimbus_volume|anvil_volume|rainshaft");
      return true;
    }
    const observer = this.getObserver();
    this.system.clear();
    const mass = this.system.spawnAt(observer.x, observer.z - test.distance, { humidity: 1, instability: 0.95 });
    mass.primeForTest(test.profile);
    this.write(`Cloud test ${testName} ready: #${mass.id}, distance=${test.distance}, puffs invisible.`);
    return true;
  }

  private handleDebug(mode?: string): boolean {
    if (mode === "volume" || mode === "scale") {
      this.writeSummary();
      return true;
    }
    if (mode === "lifecycle") {
      if (this.system.masses.length === 0) this.write("No simulated cloud mass.");
      for (const mass of this.system.masses.slice(0, 8)) {
        const top = mass.volumeBoundsMin.y + mass.volumeBoundsSize.y;
        this.write(`#${mass.id} phase=${mass.lifecycle} age=${mass.age.toFixed(1)}s maturity=${mass.maturity.toFixed(2)} base=${Math.round(mass.volumeBoundsMin.y)} top=${Math.round(top)} points=${mass.puffs.length}`);
      }
      return true;
    }
    if (mode === "evolution") {
      if (this.system.masses.length === 0) this.write("No simulated cloud mass.");
      for (const mass of this.system.masses.slice(0, 8)) {
        const shape = mass.convectiveShape;
        const active = shape.updrafts.filter((updraft) => updraft.strength > 0.12);
        this.write(`#${mass.id} event=${mass.stormVisual.eventId} kind=${mass.stormVisual.kind} target=${mass.stormVisual.development.toFixed(2)} visual=${shape.phase} morph=${shape.development.toFixed(2)} updrafts=${active.length} anvil=${shape.anvilGrowth.toFixed(2)} erosion=${shape.dryAirErosion.toFixed(2)} rain=${mass.precipitationRate.toFixed(2)}`);
      }
      return true;
    }
    if (mode === "layers" || mode === "renderers") {
      for (const line of this.renderer?.debugRendererSummary() ?? ["Cloud renderer unavailable."]) this.write(line);
      return true;
    }
    if (mode === "lightning") {
      this.write(this.renderer?.debugLightningSummary() ?? "Cloud renderer unavailable.");
      return true;
    }
    if (mode === "precipitation") {
      this.write(this.renderer?.debugPrecipitationSummary() ?? "Cloud renderer unavailable.");
      return true;
    }
    if (mode === "performance" || mode === "profile") {
      for (const line of this.renderer?.debugPerformanceSummary() ?? ["Cloud renderer unavailable."]) this.write(line);
      return true;
    }
    if (mode === "puffs") {
      this.write(`Invisible density sources: ${this.system.masses.length} masses, ${this.system.totalPuffs()} puffs.`);
      this.write("CloudPuffs are simulation-only; no puff mesh is rendered.");
      return true;
    }
    if (mode === "bounds" || mode === "density" || mode === "off") {
      this.renderer?.setDebugMode(mode as CloudDebugMode);
      this.write(`Cloud debug ${mode}.`);
      if (mode !== "off") this.writeSummary();
      return true;
    }
    this.write("Usage: /cloud debug volume|lifecycle|evolution|layers|lightning|precipitation|renderers|performance|bounds|density|puffs|off");
    return true;
  }

  private writeSummary(): void {
    const observer = this.getObserver();
    const lines = this.renderer?.debugSummary(observer) ?? [];
    if (lines.length === 0) {
      this.write("No rendered cloud volume.");
      return;
    }
    for (const line of lines.slice(0, 8)) this.write(line);
  }

  private handleLegacy(parts: string[]): boolean {
    const observer = this.getObserver();
    const action = parts[2];
    if (action === "spawn_small") {
      const mass = this.system.spawnSmall(observer.x, observer.z - 900);
      this.write(`Small cumulus spawned (#${mass.id}); puffs remain invisible.`);
      return true;
    }
    return this.withNearest((mass) => {
      switch (action) {
        case "grow":
          mass.grow();
          this.write(`Cloud #${mass.id} growth boosted.`);
          break;
        case "instability":
          mass.setInstability(parts[3] === "high" ? 0.9 : 0.25);
          this.write(`Cloud #${mass.id} instability ${parts[3] === "high" ? "HIGH" : "LOW"}.`);
          break;
        case "make_cumulonimbus":
          mass.makeCumulonimbus();
          this.write(`Cloud #${mass.id} developing toward cumulonimbus.`);
          break;
        case "force_anvil":
          mass.forceAnvil(16, 0);
          this.write(`Cloud #${mass.id} anvil forced.`);
          break;
        case "dissipate":
          mass.dissipate();
          this.write(`Cloud #${mass.id} dissipating.`);
          break;
        default:
          this.write("Usage: /cloud convective spawn_small|grow|instability|make_cumulonimbus|force_anvil|dissipate");
      }
    });
  }

  private withNearest(action: (mass: CloudMass) => void): boolean {
    const observer = this.getObserver();
    const mass = this.system.nearest(observer.x, observer.z);
    if (!mass) {
      this.write("No cloud nearby. Use /cloud test cumulus_volume first.");
      return true;
    }
    action(mass);
    return true;
  }
}
