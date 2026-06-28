import * as THREE from "three";

/**
 * Animated water surface. The mesh keeps voxel water, but top faces get a
 * directional wave normal so sunlight and cloud shadows read as water instead
 * of a flat transparent pane.
 */
export class WaterWaves {
  readonly uniforms = {
    uWaterTime: { value: 0 },
    uWaterWind: { value: new THREE.Vector2(1, 0) },
    uWaterChop: { value: 0.08 },
  };

  apply(material: THREE.Material): void {
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (previous) previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${WATER_WAVE_GLSL}`)
        .replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\n  if (objectNormal.y > 0.5) {\n    vec3 wWorld = (modelMatrix * vec4(position, 1.0)).xyz;\n    vec3 w = ximaWaterWave(wWorld);\n    objectNormal = normalize(vec3(-w.y, 1.0, -w.z));\n  }",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n  vXimaWaterDepth = aWaterDepth;\n  {\n    vec3 wWorld = (modelMatrix * vec4(position, 1.0)).xyz;\n    transformed.y += ximaWaterWave(wWorld).x;\n  }",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${WATER_FRAGMENT_GLSL}`)
        .replace(
          "#include <dithering_fragment>",
          `float ximaDepthFog = smoothstep(1.4, 11.0, vXimaWaterDepth);
  float ximaShoreClear = 1.0 - smoothstep(0.4, 2.2, vXimaWaterDepth);
  vec3 ximaDeepBlue = vec3(0.015, 0.12, 0.24);
  vec3 ximaTurquoise = vec3(0.19, 0.72, 0.74);
  diffuseColor.rgb = mix(diffuseColor.rgb, ximaTurquoise, ximaShoreClear * 0.18);
  diffuseColor.rgb = mix(diffuseColor.rgb, ximaDeepBlue, ximaDepthFog * 0.72);
  diffuseColor.a = max(diffuseColor.a, mix(0.46, 0.96, ximaDepthFog));
  #include <dithering_fragment>`,
        );
    };
    material.customProgramCacheKey = () => "ximacraft-water-waves-v2";
    material.needsUpdate = true;
  }

  update(delta: number, windX = 1, windZ = 0): void {
    this.uniforms.uWaterTime.value += delta;
    const speed = Math.hypot(windX, windZ);
    if (speed > 0.01) {
      this.uniforms.uWaterWind.value.set(windX / speed, windZ / speed);
    }
    this.uniforms.uWaterChop.value = THREE.MathUtils.clamp(0.05 + speed * 0.006, 0.055, 0.16);
  }
}

const WATER_WAVE_GLSL = /* glsl */ `
attribute float aWaterDepth;
varying float vXimaWaterDepth;
uniform float uWaterTime;
uniform vec2 uWaterWind;
uniform float uWaterChop;

vec3 ximaWaterWave(vec3 p) {
  vec2 wind = normalize(uWaterWind + vec2(0.0001));
  vec2 crossWind = vec2(-wind.y, wind.x);
  float along = dot(p.xz, wind);
  float cross = dot(p.xz, crossWind);
  float a1 = uWaterChop;
  float a2 = uWaterChop * 0.62;
  float a3 = uWaterChop * 0.34;
  float k1 = 0.26, k2 = 0.48, k3 = 0.83;
  float p1 = along * k1 + uWaterTime * 1.45;
  float p2 = cross * k2 - uWaterTime * 0.92;
  float p3 = (along * 0.72 + cross * 0.28) * k3 + uWaterTime * 2.35;
  float wave = a1 * sin(p1) + a2 * sin(p2) + a3 * sin(p3);
  float dAlong = a1 * k1 * cos(p1) + a3 * 0.72 * k3 * cos(p3);
  float dCross = a2 * k2 * cos(p2) + a3 * 0.28 * k3 * cos(p3);
  float dx = dAlong * wind.x + dCross * crossWind.x;
  float dz = dAlong * wind.y + dCross * crossWind.y;
  return vec3(wave, dx, dz);
}
`;

const WATER_FRAGMENT_GLSL = /* glsl */ `
varying float vXimaWaterDepth;
`;
