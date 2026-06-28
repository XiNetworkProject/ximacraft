import * as THREE from "three";

/**
 * Matériau d'un puff de nuage — technique de "splatting" (cf. recherche EG/HPG).
 *
 * Chaque puff est un QUAD orienté caméra (billboard), mais le fragment shader
 * reconstruit une NORMALE DE SPHÈRE à partir des coordonnées du disque → on
 * obtient l'éclairage volumique d'une sphère sur une géométrie plate, avec un
 * bord radial DOUX qui fond avec les puffs voisins (pas de contour de sphère
 * dur, pas d'aspect "bulles"). Couplé au tri de profondeur côté renderer, le
 * mélange des transparences est correct.
 *
 * Éclairage : Henyey-Greenstein (liseré argenté vers le soleil) + diffus wrap.
 */
export function createCloudPuffMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
      uSun: { value: 0.8 },
      uAmbient: { value: 0.55 },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uCamForward: { value: new THREE.Vector3(0, 0, -1) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      uniform vec3 uCamRight, uCamUp;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vUv = uv * 2.0 - 1.0;        // coord radiale [-1,1]
        vColor = aColor;
        vAlpha = aAlpha;
        vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sx = length(vec3(instanceMatrix[0]));
        float sy = length(vec3(instanceMatrix[1]));
        // Quad face caméra (taille = diamètre).
        vec3 world = instPos + uCamRight * position.x * sx + uCamUp * position.y * sy;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define PI 3.14159265
      uniform vec3 uSunDir, uCamRight, uCamUp, uCamForward;
      uniform float uSun, uAmbient;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;

      float hash(vec2 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * (p.x + p.y)); }
      float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }

      void main() {
        float r2 = dot(vUv, vUv);
        if (r2 > 1.0) discard;           // disque
        float rr = sqrt(r2);
        float z = sqrt(max(0.0, 1.0 - r2));
        // Normale de SPHÈRE (l'hémisphère face caméra pointe vers la caméra = -forward).
        vec3 N = normalize(uCamRight * vUv.x + uCamUp * vUv.y - uCamForward * z);
        vec3 L = normalize(uSunDir);

        float diffuse = pow(clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0), 1.6);
        // Liseré argenté : diffusion avant quand on regarde vers le soleil.
        float forward = hg(dot(uCamForward, L), 0.55);
        float rim = smoothstep(0.45, 1.0, rr);
        float silver = forward * rim * 1.5;

        float light = uAmbient + uSun * (diffuse * 0.85 + silver);
        vec3 color = vColor * light + vec3(0.03, 0.04, 0.06) * uAmbient;

        // Bord radial DOUX → les puffs fondent ensemble (pas de cercle dur).
        float soft = 1.0 - smoothstep(0.45, 1.0, rr);
        float noise = 0.85 + 0.15 * hash(vUv * 6.0 + vColor.rr * 9.0);
        float alpha = vAlpha * soft * noise;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}
