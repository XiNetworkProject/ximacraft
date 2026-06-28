import * as THREE from "three";
import { CloudDensityGrid } from "../../clouds/CloudDensityGrid";
import { CloudLifecycle, isStormy } from "../../clouds/CloudLifecycle";
import { CloudMass } from "../../clouds/CloudMass";
import { ConvectiveCloudSystem } from "../../clouds/ConvectiveCloudSystem";
import { FrameCompositor } from "../../game/Renderer";
import { createCloudVolumeMaterial } from "./CloudVolumeMaterial";
import { createNubisNoiseTextures } from "./NubisNoiseTextures";
import { RainShaftRenderer, RainShaftSpec } from "./RainShaftRenderer";
import { LightningStrike } from "../../weather/LightningSystem";
import { CloudLodSystem, CloudRenderQuality, CloudVolumeLod } from "./CloudLodSystem";

const MAX_VOLUMES = 8;
const JITTER_SEQUENCE = [0.5, 0.125, 0.75, 0.375, 0.875, 0.25, 0.625, 0.0625];
const DEFAULT_PRESET: CloudVisualPreset = {
  profile: 0,
  label: "CUMULUS_SMALL",
};

export interface CloudVisualPreset {
  profile: number;
  label: string;
}

interface VolumeSlot {
  massId: number;
  mass: CloudMass | null;
  grid: CloudDensityGrid;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  helper: THREE.BoxHelper;
  worldToLocal: THREE.Matrix4;
  cameraLocal: THREE.Vector3;
  bakeTimer: number;
  hasDensity: boolean;
  preset: CloudVisualPreset;
  lod: CloudVolumeLod;
  stepCount: number;
  /** Fondu d'apparition/disparition du slot (0..1) → pas de pop. */
  fade: number;
  targetVisible: boolean;
}

export type CloudDebugMode = "off" | "bounds" | "density";

export function getCloudVisualPreset(mass: CloudMass): CloudVisualPreset {
  const storm = mass.stormVisual;
  if (storm.kind !== "convective") {
    const development = THREE.MathUtils.clamp(storm.development, 0, 1);
    const profile = development < 0.16 ? 0 : development < 0.46 ? 1 : development < 0.76 ? 2 : 3;
    const label = storm.kind === "supercell" ? "SUPERCELL" : storm.kind === "squall" ? "SQUALL_LINE" : "STORM_CELL";
    return { profile, label };
  }

  // Taille VISUELLE dérivée de l'étendue RÉELLE des puffs (sinon un preset fixe
  // étire le nuage : un congestus 1000×1600 devient une colonne). Une échelle
  // "atmosphérique" uniforme agrandit le tout sans déformer les proportions.
  const towerH = Math.max(80, mass.topHeight - mass.condensationLevel);
  const profile =
    mass.lifecycle === CloudLifecycle.CUMULONIMBUS || mass.lifecycle === CloudLifecycle.PRECIPITATING
      ? 2
      : mass.lifecycle === CloudLifecycle.ANVIL
        ? 3
        : mass.lifecycle === CloudLifecycle.CUMULUS_CONGESTUS
          ? 1
          : 0;
  const label = profile === 2 ? "CUMULONIMBUS" : profile === 3 ? "ANVIL" : profile === 1 ? "CUMULUS_CONGESTUS" : "CUMULUS_SMALL";
  return { profile, label };
}

/** Renders invisible CloudPuffs as continuous density volumes. */
export class CloudVolumeRenderer implements FrameCompositor {
  private readonly volumeScene = new THREE.Scene();
  private readonly screenScene = new THREE.Scene();
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly volumeGeometry = new THREE.BoxGeometry(2, 2, 2);
  private readonly nubisNoise = createNubisNoiseTextures();
  private readonly slots: VolumeSlot[] = [];
  private readonly rainShafts: RainShaftRenderer;
  private readonly resolveMaterial = this.createResolveMaterial();
  private readonly compositeMaterial = this.createCompositeMaterial();
  private readonly screenQuad: THREE.Mesh;
  private readonly drawingSize = new THREE.Vector2();
  private readonly previousCameraPosition = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly previousCameraQuaternion = new THREE.Quaternion();
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private currentTarget: THREE.WebGLRenderTarget | null = null;
  private historyReadTarget: THREE.WebGLRenderTarget | null = null;
  private historyWriteTarget: THREE.WebGLRenderTarget | null = null;
  private activeVolumes = 0;
  private historyValid = false;
  private frame = 0;
  private lowResolutionScale = 0.26;
  private debugMode: CloudDebugMode = "off";
  private readonly lightningLocal = new THREE.Vector3();
  private readonly lightningFlashes: Array<{
    eventId: number;
    world: THREE.Vector3;
    peak: number;
    life: number;
    duration: number;
    radius: number;
  }> = [];
  private totalLightningFlashes = 0;
  private readonly lodSystem = new CloudLodSystem();
  private profileTimer = 0;
  private bakesInWindow = 0;
  private bakesPerSecond = 0;
  private bakeMsInWindow = 0;
  private bakeMsPerSecond = 0;

  constructor(
    private readonly mainScene: THREE.Scene,
    private readonly system: ConvectiveCloudSystem,
  ) {
    this.screenCamera.position.z = 1;
    this.screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.resolveMaterial);
    this.screenQuad.frustumCulled = false;
    this.screenScene.add(this.screenQuad);
    this.rainShafts = new RainShaftRenderer(this.volumeScene);

    for (let i = 0; i < MAX_VOLUMES; i += 1) {
      const grid = new CloudDensityGrid();
      const material = createCloudVolumeMaterial(grid.texture, this.nubisNoise.base, this.nubisNoise.detail);
      const mesh = new THREE.Mesh(this.volumeGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.volumeScene.add(mesh);
      const helper = new THREE.BoxHelper(mesh, 0x39ff9b);
      helper.visible = false;
      helper.material.depthTest = false;
      helper.renderOrder = 100;
      this.mainScene.add(helper);
      this.slots.push({
        massId: -1,
        mass: null,
        grid,
        mesh,
        material,
        helper,
        worldToLocal: new THREE.Matrix4(),
        cameraLocal: new THREE.Vector3(),
        bakeTimer: 0,
        hasDensity: false,
        preset: DEFAULT_PRESET,
        lod: "HORIZON",
        stepCount: 18,
        fade: 0,
        targetVisible: false,
      });
    }
  }

  update(
    delta: number,
    time: number,
    dayFactor: number,
    sunDirection: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    quality: CloudRenderQuality,
  ): void {
    this.profileTimer += delta;
    if (this.profileTimer >= 1) {
      const scale = 1 / this.profileTimer;
      this.bakesPerSecond = this.bakesInWindow * scale;
      this.bakeMsPerSecond = this.bakeMsInWindow * scale;
      this.profileTimer = 0;
      this.bakesInWindow = 0;
      this.bakeMsInWindow = 0;
    }
    for (let index = this.lightningFlashes.length - 1; index >= 0; index -= 1) {
      const flash = this.lightningFlashes[index];
      flash.life -= delta;
      if (flash.life <= 0) this.lightningFlashes.splice(index, 1);
    }
    this.lowResolutionScale = quality === "high" ? 0.36 : quality === "low" ? 0.2 : 0.27;
    const candidates = this.system.masses
      .filter((mass) => !mass.dead && mass.puffs.length > 0)
      .sort((a, b) => {
        const aStorm = isStormy(a.lifecycle) || a.stormVisual.kind !== "convective" ? -1_000_000_000 : 0;
        const bStorm = isStormy(b.lifecycle) || b.stormVisual.kind !== "convective" ? -1_000_000_000 : 0;
        const ad = (a.position.x - camera.position.x) ** 2 + (a.position.z - camera.position.z) ** 2 + aStorm;
        const bd = (b.position.x - camera.position.x) ** 2 + (b.position.z - camera.position.z) ** 2 + bStorm;
        return ad - bd;
      })
      .slice(0, MAX_VOLUMES);

    const wantedIds = new Set(candidates.map((mass) => mass.id));
    const assignedIds = new Set<number>();
    let topologyChanged = false;
    for (const slot of this.slots) {
      slot.targetVisible = slot.mass !== null && wantedIds.has(slot.mass.id) && !slot.mass.dead;
      if (slot.targetVisible && slot.mass) assignedIds.add(slot.mass.id);
    }
    for (const mass of candidates) {
      if (assignedIds.has(mass.id)) continue;
      const slot = this.slots.find((candidate) => candidate.mass === null || (!candidate.targetVisible && candidate.fade <= 0.001));
      if (!slot) continue;
      slot.massId = mass.id;
      slot.mass = mass;
      slot.hasDensity = false;
      slot.bakeTimer = 0;
      slot.fade = 0;
      slot.targetVisible = true;
      topologyChanged = true;
      assignedIds.add(mass.id);
    }

    let bakeBudget = 1;
    const rainSpecs: RainShaftSpec[] = [];
    for (const slot of this.slots) {
      const mass = slot.mass;
      if (!mass) {
        slot.mesh.visible = false;
        slot.helper.visible = false;
        continue;
      }

      slot.fade = THREE.MathUtils.clamp(slot.fade + delta * (slot.targetVisible ? 0.55 : -0.42), 0, 1);
      if (!slot.targetVisible && slot.fade <= 0.001) {
        slot.massId = -1;
        slot.mass = null;
        slot.hasDensity = false;
        slot.mesh.visible = false;
        slot.helper.visible = false;
        topologyChanged = true;
        continue;
      }

      const distance = Math.hypot(mass.position.x - camera.position.x, mass.position.z - camera.position.z);
      slot.lod = this.lodSystem.resolveLod(distance, slot.lod);
      slot.bakeTimer -= delta;
      let bakedThisFrame = false;
      if (slot.targetVisible && slot.bakeTimer <= 0 && bakeBudget > 0) {
        const bakeStarted = performance.now();
        slot.hasDensity = slot.grid.bake(mass);
        this.bakeMsInWindow += performance.now() - bakeStarted;
        this.bakesInWindow += 1;
        bakedThisFrame = slot.hasDensity;
        slot.bakeTimer = this.lodSystem.densityBakeInterval(
          slot.lod,
          isStormy(mass.lifecycle) || mass.stormVisual.kind !== "convective",
          quality,
        );
        bakeBudget -= 1;
      }
      if (!slot.hasDensity) {
        slot.mesh.visible = false;
        slot.helper.visible = false;
        continue;
      }

      const preset = getCloudVisualPreset(mass);
      slot.preset = preset;
      // BoxGeometry spans [-1, 1]. Its world box must be exactly the density
      // bake box: no renderer-only visual scaling is permitted here.
      slot.mesh.position.copy(slot.grid.boundsMin).addScaledVector(slot.grid.boundsSize, 0.5);
      slot.mesh.scale.copy(slot.grid.boundsSize).multiplyScalar(0.5);
      slot.mesh.updateMatrixWorld(true);
      if (bakedThisFrame) this.assertMatchingBounds(slot);
      slot.worldToLocal.copy(slot.mesh.matrixWorld).invert();
      slot.mesh.worldToLocal(slot.cameraLocal.copy(camera.position));

      const uniforms = slot.material.uniforms;
      uniforms.uCameraLocal.value.copy(slot.cameraLocal);
      uniforms.uSunDirection.value.copy(sunDirection).transformDirection(slot.worldToLocal);
      const windLength = Math.hypot(mass.upperWind.x, mass.upperWind.z);
      uniforms.uAnvilDirection.value.set(
        windLength > 0.01 ? mass.upperWind.x / windLength : 1,
        windLength > 0.01 ? mass.upperWind.z / windLength : 0,
      );
      uniforms.uProfile.value = preset.profile;
      const organizationGrowth = THREE.MathUtils.smoothstep(mass.stormVisual.development, 0.12, 0.7);
      uniforms.uOrganization.value = (mass.stormVisual.kind === "supercell"
        ? 1
        : mass.stormVisual.kind === "squall"
          ? 0.9
          : mass.stormVisual.kind === "storm"
            ? 0.68
            : 0) * organizationGrowth;
      uniforms.uDevelopment.value = mass.convectiveShape.development;
      uniforms.uEventIntensity.value = mass.stormVisual.kind === "convective"
        ? mass.maturity
        : mass.stormVisual.intensity;
      const updraftUniforms = uniforms.uUpdrafts.value as THREE.Vector4[];
      for (let index = 0; index < updraftUniforms.length; index += 1) {
        const updraft = mass.convectiveShape.updrafts[index];
        updraftUniforms[index].set(
          updraft?.center.x ?? 0,
          updraft?.center.y ?? 0,
          updraft?.strength ?? 0,
          updraft?.radius ?? 0.1,
        );
      }
      uniforms.uAnvilGrowth.value = mass.convectiveShape.anvilGrowth;
      uniforms.uDryAirErosion.value = mass.convectiveShape.dryAirErosion;
      uniforms.uPrecipitationOffset.value.copy(mass.convectiveShape.precipitationCore);
      const densityBoost = mass.stormVisual.kind === "convective"
        ? 1
        : 1.15 + uniforms.uOrganization.value * 0.3 + mass.stormVisual.intensity * 0.22;
      const fairCumulusSoftening = mass.stormVisual.kind === "convective"
        ? THREE.MathUtils.lerp(0.46, 0.82, THREE.MathUtils.smoothstep(mass.convectiveShape.development, 0.26, 0.72))
        : 1;
      uniforms.uOpacity.value = this.lifecycleOpacity(mass) * densityBoost * fairCumulusSoftening * slot.fade;
      uniforms.uPrecipitation.value = mass.precipitationRate;
      uniforms.uDayFactor.value = THREE.MathUtils.clamp(dayFactor, 0.06, 1);
      const profilePenalty = preset.profile >= 3 ? -4 : 0;
      const targetSteps = this.lodSystem.targetSteps(slot.lod, quality, profilePenalty);
      slot.stepCount = this.lodSystem.smoothSteps(slot.stepCount, targetSteps, delta);
      uniforms.uStepCount.value = slot.stepCount;
      uniforms.uSeed.value = mass.shapeSeed + mass.id * 0.137;
      uniforms.uTime.value = time;
      uniforms.uDebugDensity.value = this.debugMode === "density" ? 1 : 0;
      const flashes = this.lightningFlashes
        .filter((candidate) => candidate.eventId === mass.stormVisual.eventId)
        .sort((a, b) => (b.peak * b.life / b.duration) - (a.peak * a.life / a.duration))
        .slice(0, 4);
      const flashUniforms = uniforms.uLightningFlashes.value as THREE.Vector4[];
      const flashRadii = uniforms.uLightningRadii.value as Float32Array;
      for (let index = 0; index < 4; index += 1) {
        const flash = flashes[index];
        if (!flash) {
          flashUniforms[index].set(0, 0, 0, 0);
          flashRadii[index] = 1;
          continue;
        }
        this.lightningLocal.copy(flash.world).applyMatrix4(slot.worldToLocal);
        const life = THREE.MathUtils.clamp(flash.life / Math.max(0.001, flash.duration), 0, 1);
        const pulse = Math.pow(life, 0.55) * (0.82 + Math.sin(life * 24) * 0.18);
        flashUniforms[index].set(this.lightningLocal.x, this.lightningLocal.y, this.lightningLocal.z, flash.peak * pulse);
        flashRadii[index] = flash.radius;
      }
      uniforms.uVolumeHalfSize.value.copy(slot.grid.boundsSize).multiplyScalar(0.5);
      slot.mesh.visible = true;
      slot.helper.visible = this.debugMode === "bounds";
      if (slot.helper.visible) slot.helper.update();

      const rainIntensity = Math.max(
        mass.precipitationRate,
        isStormy(mass.lifecycle) ? mass.maturity * 0.42 : 0,
      );
      if (slot.targetVisible && rainIntensity * slot.fade > 0.08) {
        const stormRadius = mass.stormVisual.radius;
        const volumeWidth = slot.grid.boundsSize.x;
        const volumeDepth = slot.grid.boundsSize.z;
        const volumeHeight = slot.grid.boundsSize.y;
        const rainWidth = mass.stormVisual.kind === "squall"
          ? volumeWidth * 0.86
          : stormRadius > 0
            ? Math.min(volumeWidth * 0.62, Math.max(1400, stormRadius * 2.8))
            : volumeWidth * 0.7;
        const rainDepth = mass.stormVisual.kind === "squall"
          ? Math.min(volumeDepth * 0.8, Math.max(900, stormRadius * 1.25))
          : rainWidth * 0.82;
        const windX = windLength > 0.01 ? mass.upperWind.x / windLength : 0;
        const windZ = windLength > 0.01 ? mass.upperWind.z / windLength : 0;
        const coreOffset = stormRadius > 0 ? Math.min(850, stormRadius * 0.38) : 0;
        rainSpecs.push({
          x: mass.position.x + windX * coreOffset,
          z: mass.position.z + windZ * coreOffset,
          baseHeight: slot.grid.boundsMin.y + volumeHeight * (preset.profile >= 2 ? 0.09 : 0.065),
          width: rainWidth,
          depth: rainDepth,
          intensity: rainIntensity * slot.fade,
          windX: mass.upperWind.x,
          windZ: mass.upperWind.z,
          kind: mass.stormVisual.precip === "none" ? "rain" : mass.stormVisual.precip,
          dayFactor,
          lightning: flashes.reduce((brightest, flash) => Math.max(
            brightest,
            flash.peak * THREE.MathUtils.clamp(flash.life / Math.max(0.001, flash.duration), 0, 1),
          ), 0),
        });
      }
    }

    if (topologyChanged) this.historyValid = false;
    this.activeVolumes = this.slots.reduce((count, slot) => count + (slot.mesh.visible ? 1 : 0), 0);
    this.rainShafts.update(rainSpecs, camera.position, time);
    if (this.activeVolumes === 0) this.historyValid = false;
  }

  setDebugMode(mode: CloudDebugMode): void {
    this.debugMode = mode;
    for (const slot of this.slots) {
      slot.helper.visible = mode === "bounds" && slot.mesh.visible;
      slot.material.uniforms.uDebugDensity.value = mode === "density" ? 1 : 0;
    }
  }

  addLightningStrike(strike: LightningStrike): void {
    this.totalLightningFlashes += 1;
    this.lightningFlashes.push({
      eventId: strike.eventId,
      world: new THREE.Vector3(
        strike.x,
        strike.cloudBaseY + strike.localOffset.y,
        strike.z,
      ),
      peak: strike.intensity * (1 - strike.embedded * 0.45) * 2.2,
      life: strike.duration,
      duration: strike.duration,
      radius: strike.flashRadius,
    });
    if (this.lightningFlashes.length > 12) this.lightningFlashes.shift();
  }

  debugSummary(observer: { x: number; z: number }): string[] {
    const lines: string[] = [];
    for (const slot of this.slots) {
      const mass = slot.mass;
      if (!mass || !slot.mesh.visible) continue;
      const distance = Math.hypot(mass.position.x - observer.x, mass.position.z - observer.z);
      const meshBounds = new THREE.Box3().setFromObject(slot.mesh);
      const densityMax = slot.grid.boundsMin.clone().add(slot.grid.boundsSize);
      lines.push(
        `#${mass.id} ${slot.preset.label} phase=${mass.lifecycle} `
        + `visual=${mass.convectiveShape.phase} morph=${mass.convectiveShape.development.toFixed(2)} `
        + `density=${this.formatBounds(slot.grid.boundsMin, densityMax)} mesh=${this.formatBounds(meshBounds.min, meshBounds.max)} `
        + `base=${Math.round(slot.grid.boundsMin.y)} top=${Math.round(densityMax.y)} `
        + `width=${Math.round(slot.grid.boundsSize.x)} depth=${Math.round(slot.grid.boundsSize.z)} `
        + `distance=${Math.round(distance)} LOD=${slot.lod}(${slot.stepCount}) points=${mass.puffs.length} `
        + `updrafts=${mass.convectiveShape.updrafts.filter((updraft) => updraft.strength > 0.12).length} anvil=${mass.convectiveShape.anvilGrowth.toFixed(2)}`,
      );
    }
    return lines;
  }

  debugRendererSummary(): string[] {
    return [
      "Stratiform authority: SkySystem/CloudRenderer dome (non-convective layers only).",
      "Convective authority: CloudVolumeRenderer raymarch volumes (one compositor).",
      "Legacy WeatherRenderer: disabled; legacy regional anvil/precipitation: hidden.",
      "CloudPuff: simulation/density control points only; no visible puff mesh.",
    ];
  }

  debugLightningSummary(): string {
    return `Volumetric lightning flashes active=${this.lightningFlashes.length} total=${this.totalLightningFlashes} localSlots=4.`;
  }

  debugPrecipitationSummary(): string {
    return `Distant precipitation shafts active=${this.rainShafts.activeCount}.`;
  }

  debugPerformanceSummary(): string[] {
    const counts: Record<CloudVolumeLod, number> = { NEAR: 0, MEDIUM: 0, FAR: 0, HORIZON: 0 };
    for (const slot of this.slots) if (slot.mesh.visible) counts[slot.lod] += 1;
    return [
      `Cloud budget ${this.activeVolumes}/${MAX_VOLUMES}; LOD near=${counts.NEAR} medium=${counts.MEDIUM} far=${counts.FAR} horizon=${counts.HORIZON}.`,
      `Density cadence ${this.bakesPerSecond.toFixed(1)} bake/s, CPU=${this.bakeMsPerSecond.toFixed(1)} ms/s; renderScale=${this.lowResolutionScale.toFixed(2)}.`,
      `Temporal history=${this.historyValid ? "stable" : "warming"}; slot fades and LOD hysteresis enabled.`,
    ];
  }

  renderFrame(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    outputTarget: THREE.WebGLRenderTarget | null = null,
  ): void {
    if (this.activeVolumes === 0) {
      renderer.setRenderTarget(outputTarget);
      renderer.render(scene, camera);
      return;
    }

    this.ensureTargets(renderer);
    const sceneTarget = this.sceneTarget;
    const currentTarget = this.currentTarget;
    const historyReadTarget = this.historyReadTarget;
    const historyWriteTarget = this.historyWriteTarget;
    if (!sceneTarget || !currentTarget || !historyReadTarget || !historyWriteTarget) return;

    const clearColor = renderer.getClearColor(new THREE.Color()).clone();
    const clearAlpha = renderer.getClearAlpha();
    camera.updateMatrixWorld();
    renderer.setRenderTarget(sceneTarget);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    const cameraMoved = !this.historyValid
      || camera.position.distanceToSquared(this.previousCameraPosition) > 0.0025
      || 1 - Math.abs(camera.quaternion.dot(this.previousCameraQuaternion)) > 0.000002;
    const jitter = cameraMoved ? 0.5 : JITTER_SEQUENCE[this.frame % JITTER_SEQUENCE.length];
    this.frame += 1;

    for (const slot of this.slots) {
      if (!slot.mesh.visible) continue;
      const uniforms = slot.material.uniforms;
      uniforms.uJitter.value = jitter;
      uniforms.uSceneDepth.value = sceneTarget.depthTexture;
      uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
      uniforms.uCameraWorld.value.copy(camera.matrixWorld);
      uniforms.uWorldToLocal.value.copy(slot.worldToLocal);
      uniforms.uLowResolution.value.set(currentTarget.width, currentTarget.height);
    }
    this.rainShafts.setDepthContext(sceneTarget.depthTexture!, camera, currentTarget.width, currentTarget.height);

    renderer.setRenderTarget(currentTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.volumeScene, camera);

    const resolve = this.resolveMaterial.uniforms;
    resolve.uCurrent.value = currentTarget.texture;
    resolve.uHistory.value = historyReadTarget.texture;
    resolve.uTexelSize.value.set(1 / currentTarget.width, 1 / currentTarget.height);
    resolve.uCurrentWeight.value = this.historyValid ? (cameraMoved ? 0.82 : 0.16) : 1;
    this.screenQuad.material = this.resolveMaterial;
    renderer.setRenderTarget(historyWriteTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.screenScene, this.screenCamera);

    this.historyReadTarget = historyWriteTarget;
    this.historyWriteTarget = historyReadTarget;
    this.historyValid = true;
    this.previousCameraPosition.copy(camera.position);
    this.previousCameraQuaternion.copy(camera.quaternion);

    this.compositeMaterial.uniforms.uSceneColor.value = sceneTarget.texture;
    this.compositeMaterial.uniforms.uCloudColor.value = historyWriteTarget.texture;
    this.screenQuad.material = this.compositeMaterial;
    renderer.setRenderTarget(outputTarget);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.clear(true, true, true);
    renderer.render(this.screenScene, this.screenCamera);
  }

  private lifecycleOpacity(mass: CloudMass): number {
    const birth = THREE.MathUtils.smoothstep(mass.age, 0, 8);
    if (mass.lifecycle === CloudLifecycle.DISSIPATING) return birth * THREE.MathUtils.clamp(mass.humidity * 1.4, 0, 1);
    return birth;
  }

  private assertMatchingBounds(slot: VolumeSlot): void {
    const meshBounds = new THREE.Box3().setFromObject(slot.mesh);
    const densityMax = slot.grid.boundsMin.clone().add(slot.grid.boundsSize);
    const error = Math.max(
      meshBounds.min.distanceTo(slot.grid.boundsMin),
      meshBounds.max.distanceTo(densityMax),
    );
    console.assert(
      error <= 0.05,
      `Cloud volume #${slot.massId} bounds mismatch: error=${error.toFixed(4)}`,
      { densityMin: slot.grid.boundsMin, densityMax, meshBounds },
    );
  }

  private formatBounds(min: THREE.Vector3, max: THREE.Vector3): string {
    return `[${Math.round(min.x)},${Math.round(min.y)},${Math.round(min.z)}>${Math.round(max.x)},${Math.round(max.y)},${Math.round(max.z)}]`;
  }

  private ensureTargets(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.drawingSize);
    const width = Math.max(1, Math.floor(this.drawingSize.x));
    const height = Math.max(1, Math.floor(this.drawingSize.y));
    const lowWidth = Math.max(1, Math.ceil(width * this.lowResolutionScale));
    const lowHeight = Math.max(1, Math.ceil(height * this.lowResolutionScale));
    if (this.sceneTarget?.width === width && this.sceneTarget.height === height
      && this.currentTarget?.width === lowWidth && this.currentTarget.height === lowHeight) return;

    this.disposeTargets();
    this.sceneTarget = this.createTarget(width, height, true);
    this.currentTarget = this.createTarget(lowWidth, lowHeight, false);
    this.historyReadTarget = this.createTarget(lowWidth, lowHeight, false);
    this.historyWriteTarget = this.createTarget(lowWidth, lowHeight, false);
    this.historyValid = false;
  }

  private createTarget(width: number, height: number, depth: boolean): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: depth,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    if (depth) {
      target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
      target.depthTexture.format = THREE.DepthFormat;
      target.depthTexture.minFilter = THREE.NearestFilter;
      target.depthTexture.magFilter = THREE.NearestFilter;
    }
    return target;
  }

  private createResolveMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uCurrent: { value: null },
        uHistory: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uCurrentWeight: { value: 1 },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uCurrent, uHistory;
        uniform vec2 uTexelSize;
        uniform float uCurrentWeight;
        varying vec2 vUv;
        void main() {
          vec4 current = texture2D(uCurrent, vUv);
          vec4 leftValue = texture2D(uCurrent, vUv - vec2(uTexelSize.x, 0.0));
          vec4 rightValue = texture2D(uCurrent, vUv + vec2(uTexelSize.x, 0.0));
          vec4 downValue = texture2D(uCurrent, vUv - vec2(0.0, uTexelSize.y));
          vec4 upValue = texture2D(uCurrent, vUv + vec2(0.0, uTexelSize.y));
          vec4 minimum = min(current, min(min(leftValue, rightValue), min(downValue, upValue)));
          vec4 maximum = max(current, max(max(leftValue, rightValue), max(downValue, upValue)));
          vec4 extent = maximum - minimum;
          vec4 history = clamp(texture2D(uHistory, vUv), minimum - extent * 0.1, maximum + extent * 0.1);
          gl_FragColor = mix(history, current, uCurrentWeight);
        }
      `,
    });
  }

  private createCompositeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { uSceneColor: { value: null }, uCloudColor: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uSceneColor, uCloudColor;
        varying vec2 vUv;
        void main() {
          vec4 sceneColor = texture2D(uSceneColor, vUv);
          vec4 cloudColor = texture2D(uCloudColor, vUv);
          gl_FragColor = vec4(mix(sceneColor.rgb, cloudColor.rgb, cloudColor.a), sceneColor.a);
          #include <colorspace_fragment>
        }
      `,
    });
  }

  private disposeTargets(): void {
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget?.dispose();
    this.currentTarget?.dispose();
    this.historyReadTarget?.dispose();
    this.historyWriteTarget?.dispose();
    this.sceneTarget = null;
    this.currentTarget = null;
    this.historyReadTarget = null;
    this.historyWriteTarget = null;
  }

  dispose(): void {
    this.rainShafts.dispose();
    for (const slot of this.slots) {
      this.volumeScene.remove(slot.mesh);
      this.mainScene.remove(slot.helper);
      slot.material.dispose();
      slot.grid.dispose();
      slot.helper.geometry.dispose();
      slot.helper.material.dispose();
    }
    this.screenScene.remove(this.screenQuad);
    this.screenQuad.geometry.dispose();
    this.resolveMaterial.dispose();
    this.compositeMaterial.dispose();
    this.volumeGeometry.dispose();
    this.nubisNoise.dispose();
    this.disposeTargets();
  }
}
