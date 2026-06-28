import * as THREE from "three";
import { CloudMass } from "../../clouds/CloudMass";

const MAX_SHADOW_MASSES = 8;

/**
 * Ombres de nuages projetées au sol — la technique des shaderpacks Minecraft :
 * on échantillonne la COUVERTURE nuageuse au point projeté vers le soleil et on
 * atténue UNIQUEMENT la lumière directe (le ciel/ambiant reste, donc l'ombre est
 * douce et colorée, pas noire). Deux sources :
 *   1. un dapple fBm procédural qui dérive avec le vent (couverture stratiforme /
 *      cumulus de beau temps) — c'est l'ombre « qui glisse sur les champs » ;
 *   2. des disques nets pour les masses convectives (cumulonimbus) → grosses
 *      ombres d'orage qui suivent le nuage.
 *
 * Injecté dans les matériaux terrain/feuillage/eau via onBeforeCompile : on
 * multiplie `reflectedLight.directDiffuse/Specular` par le facteur d'ombre.
 */
export class CloudShadowSystem {
  private elapsed = 0;
  private readonly massScratch: Array<{ mass: CloudMass; dist: number }> = [];

  readonly uniforms = {
    uCloudShadowEnabled: { value: 1 },
    uCloudShadowSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloudShadowCoverage: { value: 0 },
    uCloudShadowWind: { value: new THREE.Vector2() },
    uCloudShadowTime: { value: 0 },
    uCloudShadowHeight: { value: 320 },
    uCloudShadowStrength: { value: 0.82 },
    uCloudShadowWeatherMap: { value: createFallbackWeatherTexture() },
    uCloudShadowWeatherCenter: { value: new THREE.Vector2() },
    uCloudShadowWeatherRadius: { value: 1 },
    uCloudShadowWeatherEnabled: { value: 0 },
    uCloudShadowMasses: { value: Array.from({ length: MAX_SHADOW_MASSES }, () => new THREE.Vector4()) },
  };

  /** Injecte le code d'ombre de nuages dans un matériau (à appeler une fois). */
  apply(material: THREE.Material): void {
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (previous) previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCloudShadowWorld;")
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\n  vCloudShadowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${CLOUD_SHADOW_GLSL}`)
        .replace(
          "#include <lights_fragment_end>",
          "#include <lights_fragment_end>\n  {\n    float cloudShade = cloudShadowFactor(vCloudShadowWorld);\n    reflectedLight.directDiffuse *= cloudShade;\n    reflectedLight.directSpecular *= cloudShade;\n  }",
        );
    };
    material.customProgramCacheKey = () => "ximacraft-cloud-shadow";
    material.needsUpdate = true;
  }

  setEnabled(enabled: boolean): void {
    this.uniforms.uCloudShadowEnabled.value = enabled ? 1 : 0;
  }

  setStrength(strength: number): void {
    this.uniforms.uCloudShadowStrength.value = THREE.MathUtils.clamp(strength, 0, 1);
  }

  setWeatherField(texture: THREE.Texture, centerX: number, centerZ: number, radius: number): void {
    this.uniforms.uCloudShadowWeatherMap.value = texture;
    this.uniforms.uCloudShadowWeatherCenter.value.set(centerX, centerZ);
    this.uniforms.uCloudShadowWeatherRadius.value = Math.max(1, radius);
    this.uniforms.uCloudShadowWeatherEnabled.value = 1;
  }

  update(
    delta: number,
    options: {
      sunDirection: THREE.Vector3;
      coverage: number;
      windX: number;
      windZ: number;
      observerX: number;
      observerZ: number;
      observerY: number;
      masses: readonly CloudMass[];
    },
  ): void {
    this.elapsed += delta;
    this.uniforms.uCloudShadowTime.value = this.elapsed;
    this.uniforms.uCloudShadowSunDir.value.copy(options.sunDirection);
    this.uniforms.uCloudShadowCoverage.value = THREE.MathUtils.clamp(options.coverage, 0, 1);
    this.uniforms.uCloudShadowWind.value.set(options.windX, options.windZ);
    // Plafond nuageux ancré ~260 blocs au-dessus du joueur : garde le décalage
    // d'ombre raisonnable même quand le soleil est bas.
    this.uniforms.uCloudShadowHeight.value = options.observerY + 260;

    // Sélectionne les masses convectives les plus proches et significatives.
    this.massScratch.length = 0;
    for (const mass of options.masses) {
      if (mass.dead || mass.puffs.length === 0) continue;
      const strength = THREE.MathUtils.clamp(mass.maturity * 1.25, 0, 0.98);
      if (strength < 0.05) continue;
      const dist = Math.hypot(mass.position.x - options.observerX, mass.position.z - options.observerZ);
      if (dist > 9000) continue;
      this.massScratch.push({ mass, dist });
    }
    this.massScratch.sort((a, b) => a.dist - b.dist);

    const slots = this.uniforms.uCloudShadowMasses.value;
    for (let i = 0; i < MAX_SHADOW_MASSES; i += 1) {
      const entry = this.massScratch[i];
      if (!entry) {
        slots[i].set(0, 0, 0, 0);
        continue;
      }
      const mass = entry.mass;
      const radius = Math.max(mass.volumeBoundsSize.x, mass.volumeBoundsSize.z) * 0.65;
      slots[i].set(mass.position.x, mass.position.z, Math.max(180, radius), THREE.MathUtils.clamp(mass.maturity * 1.25, 0, 0.98));
    }
  }
}

const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform float uCloudShadowEnabled;
uniform vec3 uCloudShadowSunDir;
uniform float uCloudShadowCoverage;
uniform vec2 uCloudShadowWind;
uniform float uCloudShadowTime;
uniform float uCloudShadowHeight;
uniform float uCloudShadowStrength;
uniform sampler2D uCloudShadowWeatherMap;
uniform vec2 uCloudShadowWeatherCenter;
uniform float uCloudShadowWeatherRadius;
uniform float uCloudShadowWeatherEnabled;
uniform vec4 uCloudShadowMasses[${MAX_SHADOW_MASSES}];
varying vec3 vCloudShadowWorld;

float csHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float csValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = csHash(i);
  float b = csHash(i + vec2(1.0, 0.0));
  float c = csHash(i + vec2(0.0, 1.0));
  float d = csHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float csFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.55;
  for (int i = 0; i < 3; i += 1) {
    value += amplitude * csValueNoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

float cloudShadowFactor(vec3 worldPos) {
  if (uCloudShadowEnabled < 0.5) return 1.0;
  vec3 sunDir = uCloudShadowSunDir;
  if (sunDir.y < 0.06) return 1.0; // soleil rasant/sous l'horizon : pas d'ombre de nuage
  float travel = (uCloudShadowHeight - worldPos.y) / sunDir.y;
  vec2 hit = worldPos.xz + sunDir.xz * travel;

  float shade = 0.0;
  float coverage = clamp(uCloudShadowCoverage, 0.0, 1.0);
  if (uCloudShadowWeatherEnabled > 0.5) {
    vec2 weatherUv = vec2(0.5) + (hit - uCloudShadowWeatherCenter) / (uCloudShadowWeatherRadius * 2.0);
    vec4 weather = texture2D(uCloudShadowWeatherMap, clamp(weatherUv, 0.002, 0.998));
    float mappedCoverage = max(weather.r, max(weather.g * 0.58, weather.b * 0.72));
    coverage = mix(coverage, mappedCoverage, 0.88);
  }
  if (coverage > 0.01) {
    vec2 q = hit * 0.0019 + uCloudShadowWind * uCloudShadowTime * 0.0006;
    float broad = csFbm(q);
    float cells = csFbm(q * 2.8 + vec2(17.1, -9.2));
    float deck = smoothstep(0.62 - coverage * 0.5, 0.9 - coverage * 0.34, broad * 0.72 + cells * 0.28);
    float broken = smoothstep(0.58 - coverage * 0.42, 0.86 - coverage * 0.22, cells);
    float openSky = 1.0 - smoothstep(0.82, 0.98, broad);
    shade = max(deck, broken * openSky * 0.62) * coverage;
  }

  for (int i = 0; i < ${MAX_SHADOW_MASSES}; i += 1) {
    vec4 mass = uCloudShadowMasses[i];
    if (mass.w <= 0.001) continue;
    float d = length(hit - mass.xy) / max(mass.z, 1.0);
    shade = max(shade, (1.0 - smoothstep(0.5, 1.0, d)) * mass.w);
  }

  return 1.0 - clamp(shade, 0.0, 1.0) * uCloudShadowStrength;
}
`;

function createFallbackWeatherTexture(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  texture.name = "FallbackCloudShadowWeatherTexture";
  texture.needsUpdate = true;
  return texture;
}
