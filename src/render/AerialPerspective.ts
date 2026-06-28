import * as THREE from "three";

/**
 * Perspective aérienne : le terrain lointain se teinte vers la couleur de
 * l'atmosphère (in-scattering) — plus le fragment est loin, plus il fond dans
 * la brume du ciel. La teinte est DIRECTIONNELLE : chaude vers le soleil, bleue
 * ailleurs, comme un vrai paysage. C'est le principal signal de profondeur des
 * shaderpacks (cf. Frostbite PBS sky/clouds, atmosphère physique).
 *
 * Injecté dans les matériaux terrain via onBeforeCompile (chaîne le précédent),
 * appliqué en espace d'affichage après colorspace_fragment.
 */
export class AerialPerspective {
  readonly uniforms = {
    uAerialCamera: { value: new THREE.Vector3() },
    uAerialColor: { value: new THREE.Color(0xa8c4e0) },
    uAerialSunColor: { value: new THREE.Color(0xffe6c2) },
    uAerialSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uAerialDensity: { value: 0.0013 },
    uAerialStrength: { value: 0.9 },
    uAerialSunStrength: { value: 0.5 },
  };

  apply(material: THREE.Material): void {
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (previous) previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vAerialWorld;")
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\n  vAerialWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${AERIAL_GLSL}`)
        .replace(
          "#include <colorspace_fragment>",
          "#include <colorspace_fragment>\n  gl_FragColor.rgb = applyAerialPerspective(gl_FragColor.rgb, vAerialWorld);",
        );
    };
    material.customProgramCacheKey = () => "ximacraft-aerial";
    material.needsUpdate = true;
  }

  update(
    cameraPosition: THREE.Vector3,
    atmosphereColor: THREE.Color,
    sunColor: THREE.Color,
    sunDirection: THREE.Vector3,
    sunStrength: number,
  ): void {
    this.uniforms.uAerialCamera.value.copy(cameraPosition);
    (this.uniforms.uAerialColor.value as THREE.Color).copy(atmosphereColor);
    (this.uniforms.uAerialSunColor.value as THREE.Color).copy(sunColor);
    this.uniforms.uAerialSunDir.value.copy(sunDirection);
    this.uniforms.uAerialSunStrength.value = THREE.MathUtils.clamp(sunStrength, 0, 1);
  }
}

const AERIAL_GLSL = /* glsl */ `
uniform vec3 uAerialCamera;
uniform vec3 uAerialColor;
uniform vec3 uAerialSunColor;
uniform vec3 uAerialSunDir;
uniform float uAerialDensity;
uniform float uAerialStrength;
uniform float uAerialSunStrength;
varying vec3 vAerialWorld;

vec3 applyAerialPerspective(vec3 color, vec3 worldPos) {
  vec3 toFragment = worldPos - uAerialCamera;
  float dist = length(toFragment);
  // Extinction exponentielle : la brume s'accumule avec la distance.
  float extinction = 1.0 - exp(-dist * uAerialDensity);
  // Teinte de l'atmosphère : chaude vers le soleil (forward scattering),
  // bleue ailleurs. Légèrement renforcée près de l'horizon (vue rasante).
  vec3 viewDir = toFragment / max(dist, 0.001);
  float sunAmount = pow(max(dot(viewDir, normalize(uAerialSunDir)), 0.0), 4.0);
  float lowView = 1.0 - clamp(abs(viewDir.y) * 1.6, 0.0, 1.0);
  vec3 atmosphere = mix(uAerialColor, uAerialSunColor, sunAmount * uAerialSunStrength);
  float amount = clamp(extinction * uAerialStrength * (0.78 + lowView * 0.4), 0.0, 0.94);
  return mix(color, atmosphere, amount);
}
`;
