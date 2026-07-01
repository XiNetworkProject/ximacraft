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
    uWaterFlow: { value: new THREE.Vector2(1, 0) },
    uWaterChop: { value: 0.08 },
    uWaterRain: { value: 0 },
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
          "#include <begin_vertex>\n  vXimaWaterDepth = aWaterDepth;\n  vXimaWaterWorld = (modelMatrix * vec4(position, 1.0)).xyz;\n  transformed.y += ximaWaterWave(vXimaWaterWorld).x;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${WATER_FRAGMENT_GLSL}`)
        .replace(
          "#include <dithering_fragment>",
          `float ximaDepthFog = smoothstep(1.4, 11.0, vXimaWaterDepth);
  float ximaShoreClear = 1.0 - smoothstep(0.4, 2.2, vXimaWaterDepth);
  float ximaRainRipples = ximaWaterRainRipples(vXimaWaterWorld.xz);
  float ximaFlowStreak = ximaWaterFlowStreak(vXimaWaterWorld.xz);
  vec3 ximaDeepBlue = vec3(0.015, 0.12, 0.24);
  vec3 ximaTurquoise = vec3(0.19, 0.72, 0.74);
  diffuseColor.rgb = mix(diffuseColor.rgb, ximaTurquoise, ximaShoreClear * 0.18);
  diffuseColor.rgb = mix(diffuseColor.rgb, ximaDeepBlue, ximaDepthFog * 0.72);
  diffuseColor.rgb += vec3(0.045, 0.06, 0.065) * ximaRainRipples * (0.35 + ximaShoreClear * 0.4);
  diffuseColor.rgb += vec3(0.025, 0.045, 0.055) * ximaFlowStreak * (0.25 + ximaDepthFog * 0.3);
  diffuseColor.a = max(diffuseColor.a, mix(0.50, 0.985, ximaDepthFog));
  diffuseColor.a = max(diffuseColor.a, 0.54 + uWaterRain * 0.12);
  #include <dithering_fragment>`,
        );
    };
    material.customProgramCacheKey = () => "ximacraft-water-waves-v3";
    material.needsUpdate = true;
  }

  update(delta: number, windX = 1, windZ = 0, precipitation = 0): void {
    this.uniforms.uWaterTime.value += delta;
    const speed = Math.hypot(windX, windZ);
    if (speed > 0.01) {
      this.uniforms.uWaterWind.value.set(windX / speed, windZ / speed);
      this.uniforms.uWaterFlow.value.lerp(new THREE.Vector2(windX / speed, windZ / speed), 1 - Math.exp(-delta * 0.65));
    }
    this.uniforms.uWaterChop.value = THREE.MathUtils.clamp(0.05 + speed * 0.006, 0.055, 0.16);
    this.uniforms.uWaterRain.value = THREE.MathUtils.damp(
      this.uniforms.uWaterRain.value,
      THREE.MathUtils.clamp(precipitation, 0, 1),
      3.8,
      delta,
    );
  }
}

const WATER_WAVE_GLSL = /* glsl */ `
attribute float aWaterDepth;
varying float vXimaWaterDepth;
varying vec3 vXimaWaterWorld;
uniform float uWaterTime;
uniform vec2 uWaterWind;
uniform vec2 uWaterFlow;
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
varying vec3 vXimaWaterWorld;
uniform float uWaterTime;
uniform vec2 uWaterWind;
uniform vec2 uWaterFlow;
uniform float uWaterRain;

float ximaWaterHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float ximaWaterRainRipples(vec2 p) {
  float rain = clamp(uWaterRain, 0.0, 1.0);
  if (rain <= 0.001) return 0.0;
  vec2 cell = floor(p * 1.55);
  vec2 local = fract(p * 1.55) - 0.5;
  float h = ximaWaterHash(cell);
  float age = fract(uWaterTime * (1.8 + rain * 2.2) + h);
  float radius = age * 0.7;
  float d = length(local);
  float ring = smoothstep(0.035, 0.0, abs(d - radius));
  float fade = (1.0 - age) * smoothstep(0.15, 1.0, rain);
  float fine = sin((p.x + p.y) * 17.0 + uWaterTime * 22.0) * 0.5 + 0.5;
  return clamp((ring * fade + fine * 0.08 * rain) * rain, 0.0, 1.0);
}

float ximaWaterFlowStreak(vec2 p) {
  vec2 flow = normalize(uWaterFlow + uWaterWind * 0.25 + vec2(0.0001));
  vec2 crossFlow = vec2(-flow.y, flow.x);
  float along = dot(p, flow);
  float cross = dot(p, crossFlow);
  float streak = sin(along * 0.72 - uWaterTime * 2.7) * 0.5 + 0.5;
  float braided = sin(cross * 5.2 + along * 0.11 + uWaterTime * 0.5) * 0.5 + 0.5;
  return smoothstep(0.58, 0.95, streak * braided) * 0.55;
}
`;
