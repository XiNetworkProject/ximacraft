import * as THREE from "three";

/**
 * Lightweight vertex sway for chunk vegetation.
 *
 * ChunkMesher writes an `aWindWeight` attribute on every vertex:
 * 0 = rigid block, 0.15 = leaves, 1 = grass/flowers. This keeps the effect
 * cheap and avoids creating one mesh per plant.
 */
export class VegetationWind {
  readonly uniforms = {
    uVegetationTime: { value: 0 },
    uVegetationWind: { value: new THREE.Vector2(1, 0) },
    uVegetationStrength: { value: 0.16 },
  };

  apply(material: THREE.Material): void {
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      if (previous) previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VEGETATION_WIND_GLSL}`)
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
  {
    float weight = ximaVegetationWindWeight();
    if (weight > 0.001) {
      vec2 windDir = normalize(uVegetationWind + vec2(0.0001));
      float gust = ximaVegetationGust(position.xz, weight);
      transformed.xz += windDir * gust;
      transformed.y += sin(uVegetationTime * 1.4 + position.x * 0.21 + position.z * 0.17) * weight * 0.018;
    }
  }`,
        );
    };
    material.customProgramCacheKey = () => `${previousKey?.call(material) ?? ""}|ximacraft-vegetation-wind-v1`;
    material.needsUpdate = true;
  }

  update(delta: number, windX: number, windZ: number): void {
    this.uniforms.uVegetationTime.value += delta;
    const speed = Math.hypot(windX, windZ);
    if (speed > 0.01) {
      this.uniforms.uVegetationWind.value.set(windX / speed, windZ / speed);
    }
    this.uniforms.uVegetationStrength.value = THREE.MathUtils.clamp(0.045 + speed * 0.012, 0.06, 0.34);
  }
}

const VEGETATION_WIND_GLSL = /* glsl */ `
attribute float aWindWeight;
uniform float uVegetationTime;
uniform vec2 uVegetationWind;
uniform float uVegetationStrength;

float ximaVegetationWindWeight() {
  return aWindWeight;
}

float ximaVegetationHash(vec2 p) {
  return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453123);
}

float ximaVegetationGust(vec2 p, float weight) {
  float local = ximaVegetationHash(p * 0.19);
  float broad = sin(uVegetationTime * 1.15 + p.x * 0.07 + p.y * 0.043 + local * 6.2831);
  float fine = sin(uVegetationTime * 3.7 + p.x * 0.23 - p.y * 0.19);
  float wave = broad * 0.74 + fine * 0.26;
  return wave * uVegetationStrength * weight;
}
`;
