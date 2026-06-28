import * as THREE from "three";

/**
 * Couche de nuages procéduraux (shader fBm sur un dôme).
 *
 * Remplace l'ancien CloudSystem (plans + sphères recyclés) qui « snappait » et
 * « popait ». Ici il n'y a AUCUNE géométrie à recycler : les nuages sont du
 * bruit fractal évalué par pixel sur un dôme centré sur la caméra.
 *
 *  - Organique : domain-warping fBm (formes billowy, pas de cartes plates).
 *  - Pas de pop : la couverture est un seuil DOUX (smoothstep) → les nuages se
 *    forment/dissipent en fondu quand `cover` varie.
 *  - Pas de snap : projection planaire infinie + défilement continu du vent
 *    (jamais de modulo/wrap). On suit la caméra, donc parallaxe nulle (normal
 *    pour des nuages « à l'infini »).
 *  - Lent : morphing temporel très doux + vent à petite échelle.
 *
 * Piloté par le moteur météo régional (cover, vent) et par le ciel (soleil,
 * facteur jour/nuit).
 */

export interface CloudRenderParams {
  cameraPosition: THREE.Vector3;
  /** Direction (monde) vers le soleil ; sa hauteur sert d'indice jour/nuit. */
  sunDirection: THREE.Vector3;
  /** 0 (nuit) .. 1 (plein jour). */
  dayFactor: number;
  /** 0..1, accentue les teintes chaudes près de l'horizon. */
  dawnFactor: number;
  /** Couverture nuageuse 0..1 (combien de ciel est couvert). */
  stratiformCover: number;
  /** Couverture des voiles hauts (cirrus/cirrostratus). */
  highCover: number;
  /** Couverture des couches moyennes (altocumulus/altostratus/nimbostratus). */
  midCover: number;
  /** Couverture des couches basses continues (stratus/nimbostratus). */
  lowCover: number;
  /** Vent (blocs/s, signé) — fait défiler lentement les nuages. */
  windX: number;
  windZ: number;
  /** Assombrissement orageux 0..1. */
  darkening: number;
}

const DOME_RADIUS = 460;

export class CloudRenderer {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly offset = new THREE.Vector2(0, 0);
  private morph = 0;

  // Couleurs réutilisées (zéro allocation par frame).
  private readonly lightColor = new THREE.Color();
  private readonly shadowColor = new THREE.Color();
  private readonly nightLight = new THREE.Color(0.24, 0.28, 0.36);
  private readonly dayLight = new THREE.Color(0.82, 0.86, 0.89);
  private readonly nightShadow = new THREE.Color(0.035, 0.045, 0.075);
  private readonly dayShadow = new THREE.Color(0.3, 0.34, 0.39);
  private readonly warm = new THREE.Color(1.0, 0.78, 0.6);

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uCover: { value: 0 },
        uHighCover: { value: 0 },
        uMidCover: { value: 0 },
        uLowCover: { value: 0 },
        uOpacity: { value: 0.92 },
        uScale: { value: 0.5 },
        uMorph: { value: 0 },
        uOffset: { value: this.offset },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uLightColor: { value: this.lightColor },
        uShadowColor: { value: this.shadowColor },
        uWeatherMap: { value: this.createFallbackWeatherTexture() },
        uWeatherCenter: { value: new THREE.Vector2() },
        uCameraXZ: { value: new THREE.Vector2() },
        uWeatherRadius: { value: 1 },
        uWeatherEnabled: { value: 0 },
        uDarkening: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uCover, uHighCover, uMidCover, uLowCover, uOpacity, uScale, uMorph;
        uniform vec2 uOffset;
        uniform vec3 uSunDir, uLightColor, uShadowColor;
        uniform sampler2D uWeatherMap;
        uniform vec2 uWeatherCenter, uCameraXZ;
        uniform float uWeatherRadius, uWeatherEnabled, uDarkening;
        varying vec3 vDir;

        float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p){
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.02 + vec2(11.3, 7.7); a *= 0.5; }
          return s;
        }

        void main(){
          float y = vDir.y;
          if (y <= 0.0) discard;                 // rien sous l'horizon
          vec2 uv = (vDir.xz / (y + 0.12)) * uScale + uOffset;

          // Domain warping (warp par la base) → formes billowy organiques.
          vec2 drift = vec2(uMorph * 0.6, uMorph * 0.45);
          float base = fbm(uv + drift);
          float detail = fbm(uv * 2.4 + drift * 1.6 + base * 2.0);
          float n = clamp(base * 0.6 + detail * 0.4, 0.0, 1.0);

          // Couverture régionale (weather map) + seuil DOUX.
          vec2 weatherWorld = uCameraXZ + (vDir.xz / (y + 0.12)) * 900.0;
          vec2 weatherUv = vec2(0.5) + (weatherWorld - uWeatherCenter) / (uWeatherRadius * 2.0);
          vec4 weather = texture2D(uWeatherMap, clamp(weatherUv, 0.002, 0.998));
          float mappedCover = weather.r;
          float mappedPrecip = weather.g;
          float mappedConvection = weather.b;
          float localCover = mix(uCover, mappedCover, uWeatherEnabled * 0.86);
          // This dome represents layered sky: high cirrus, mid alto decks and
          // low stratus/nimbostratus. Finite cumulus/towers are rendered by
          // the persistent population + volume system.
          float stratiform = max(smoothstep(0.34, 0.82, localCover), max(uLowCover * 0.92, uMidCover * 0.72));
          float edge = mix(0.76, 0.18, stratiform);
          float horizon = smoothstep(0.0, 0.16, y);
          float cloud = smoothstep(edge, edge + 0.18, n);
          float dens = smoothstep(edge + 0.02, edge + 0.42, n);
          // High clouds have a stretched, fibrous frequency and remain visible
          // in otherwise clear skies. They are independent from the low deck.
          vec2 highUv = vec2(uv.x * 0.34 + uv.y * 0.72, uv.y * 1.8 - uv.x * 0.12);
          float highNoise = fbm(highUv * 1.7 + drift * 1.9);
          float highDetail = fbm(highUv * 5.2 - drift * 0.8);
          float highThreshold = mix(0.82, 0.42, uHighCover);
          float highCloud = smoothstep(highThreshold, highThreshold + 0.14, highNoise * 0.78 + highDetail * 0.22);
          highCloud *= smoothstep(0.03, 0.25, y) * (0.42 + 0.58 * smoothstep(0.2, 0.8, y));
          // Mid layers: smoother than cumulus, still broken into cellular
          // patches. This gives altocumulus/altostratus without fake planes.
          vec2 midUv = vec2(uv.x * 0.82 + uv.y * 0.12, uv.y * 0.74 - uv.x * 0.08);
          float midNoise = fbm(midUv * 1.18 + drift * 0.72);
          float midCells = fbm(midUv * 3.8 - drift * 0.45 + midNoise);
          float midThreshold = mix(0.86, 0.28, uMidCover);
          float midCloud = smoothstep(midThreshold, midThreshold + 0.16, midNoise * 0.68 + midCells * 0.32);
          midCloud *= smoothstep(0.02, 0.18, y) * (1.0 - smoothstep(0.82, 1.0, y));

          // Low stratus/nimbostratus: broad flat bases, thick grey underside.
          float lowNoise = fbm(uv * 0.64 + drift * 0.32);
          float lowDetail = fbm(uv * 2.1 + vec2(lowNoise) - drift * 0.16);
          float lowThreshold = mix(0.9, 0.18, uLowCover);
          float lowCloud = smoothstep(lowThreshold, lowThreshold + 0.11, lowNoise * 0.82 + lowDetail * 0.18);
          lowCloud *= smoothstep(0.0, 0.12, y) * (1.0 - smoothstep(0.66, 0.94, y));

          float d = max(max(cloud * horizon * stratiform, highCloud * uHighCover), max(midCloud * uMidCover, lowCloud * uLowCover));
          if (d <= 0.001) discard;

          // Éclairage : liseré argenté côté soleil, base épaisse plus sombre.
          vec2 sdir = normalize(uSunDir.xz + vec2(0.0001));
          float nSun = fbm(uv + sdir * 0.22 + drift);
          float lit = clamp(0.42 + (n - nSun) * 1.9 + uSunDir.y * 0.28, 0.0, 1.0);
          lit *= mix(1.0, 0.78, dens * 0.6);

          vec3 col = mix(uShadowColor, uLightColor, lit);
          col += uLightColor * pow(lit, 5.0) * 0.1;
          float precipDarkening = max(mappedPrecip * 0.45, mappedConvection * 0.25);
          col *= 1.0 - max(uDarkening * 0.32, precipDarkening);
          vec3 horizonCloud = mix(uShadowColor, uLightColor * 0.68, 0.38);
          col = mix(col, horizonCloud, (1.0 - horizon) * 0.38);

          vec3 highColor = mix(uShadowColor, uLightColor, 0.72 + max(0.0, uSunDir.y) * 0.18);
          col = mix(col, highColor, highCloud * (1.0 - cloud * stratiform));
          vec3 midColor = mix(uShadowColor * 1.08, uLightColor * 0.86, 0.46 + max(0.0, uSunDir.y) * 0.18);
          vec3 lowColor = mix(uShadowColor * 0.72, uLightColor * 0.54, 0.32 + max(0.0, uSunDir.y) * 0.12);
          col = mix(col, midColor, midCloud * uMidCover * 0.58);
          col = mix(col, lowColor, lowCloud * uLowCover * 0.72);
          float lowAlpha = cloud * horizon * stratiform * uOpacity * (0.42 + 0.46 * dens);
          float highAlpha = highCloud * uHighCover * (0.2 + uHighCover * 0.24);
          float midAlpha = midCloud * uMidCover * (0.18 + uMidCover * 0.36);
          float deckAlpha = lowCloud * uLowCover * (0.28 + uLowCover * 0.48);
          float alpha = max(max(lowAlpha, highAlpha), max(midAlpha, deckAlpha));
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // après le dôme de ciel, avant les transparents proches
    scene.add(this.mesh);
  }

  update(dt: number, params: CloudRenderParams): void {
    // Suit la caméra (nuages « à l'infini »).
    this.mesh.position.copy(params.cameraPosition);

    // Défilement du vent : continu, lent, jamais de wrap (donc jamais de snap).
    this.offset.x += params.windX * dt * 0.0016;
    this.offset.y += params.windZ * dt * 0.0016;
    // Morphing temporel doux pour que ça « vive » même sans vent.
    this.morph += dt * 0.02;

    const u = this.material.uniforms;
    u.uCover.value = params.stratiformCover;
    u.uHighCover.value = params.highCover;
    u.uMidCover.value = params.midCover;
    u.uLowCover.value = params.lowCover;
    u.uDarkening.value = params.darkening;
    u.uMorph.value = this.morph;
    (u.uCameraXZ.value as THREE.Vector2).set(params.cameraPosition.x, params.cameraPosition.z);
    (u.uSunDir.value as THREE.Vector3).copy(params.sunDirection).normalize();

    // Couleurs jour/nuit + teinte chaude au lever/coucher + assombrissement.
    const t = params.dayFactor;
    this.lightColor.copy(this.nightLight).lerp(this.dayLight, t);
    this.shadowColor.copy(this.nightShadow).lerp(this.dayShadow, t);
    this.lightColor.lerp(this.warm, params.dawnFactor * 0.4);
    this.lightColor.multiplyScalar(1 - params.darkening * 0.5);
    this.shadowColor.multiplyScalar(1 - params.darkening * 0.45);

    // Un ciel couvert/orageux est un peu plus opaque.
    u.uOpacity.value = 0.18 + Math.min(params.stratiformCover, 1) * 0.42 + params.darkening * 0.1;
  }

  setWeatherField(texture: THREE.Texture, centerX: number, centerZ: number, radius: number): void {
    const uniforms = this.material.uniforms;
    uniforms.uWeatherMap.value = texture;
    (uniforms.uWeatherCenter.value as THREE.Vector2).set(centerX, centerZ);
    uniforms.uWeatherRadius.value = radius;
    uniforms.uWeatherEnabled.value = 1;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private createFallbackWeatherTexture(): THREE.DataTexture {
    const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    texture.name = "FallbackWeatherTexture";
    texture.needsUpdate = true;
    return texture;
  }
}
