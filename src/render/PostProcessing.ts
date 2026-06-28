import * as THREE from "three";

export type PostQuality = "low" | "balanced" | "high";

/**
 * Post-traitement « shaderpack » : bloom (halo lumineux) + god rays (rayons de
 * soleil volumétriques par flou radial depuis la position écran du soleil —
 * technique GPU Gems 3 « Volumetric Light Scattering as a Post-Process »).
 *
 * Le compositeur (scène + nuages) rend dans `inputTarget` (sRGB LDR), puis on
 * extrait les zones brillantes, on les floute (bloom) et on les étire vers le
 * soleil (god rays), avant de recomposer à l'écran. À force 0, l'image est
 * identique à l'entrée (vérifiable) → aucune régression de couleur.
 */
export class PostProcessing {
  enabled = true;
  private bloomStrength = 0.34;
  private godStrength = 0.42;
  private godEnabled = true;
  private bloomThreshold = 0.74;

  private readonly screenScene = new THREE.Scene();
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly drawingSize = new THREE.Vector2();

  private inputRT: THREE.WebGLRenderTarget | null = null;
  private bloomA: THREE.WebGLRenderTarget | null = null;
  private bloomB: THREE.WebGLRenderTarget | null = null;
  private godRT: THREE.WebGLRenderTarget | null = null;
  private width = 0;
  private height = 0;

  private readonly brightMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly godMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;

  private readonly sunScreen = new THREE.Vector3();

  constructor() {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.screenScene.add(this.quad);

    this.brightMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uScene: { value: null },
        uThreshold: { value: this.bloomThreshold },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uScene;
        uniform float uThreshold;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(uScene, vUv).rgb;
          float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float knee = smoothstep(uThreshold, uThreshold + 0.25, luma);
          gl_FragColor = vec4(c * knee, 1.0);
        }
      `,
    });

    this.blurMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uTex: { value: null },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2() },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uTex;
        uniform vec2 uDirection;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec2 step = uDirection * uTexel;
          vec3 sum = texture2D(uTex, vUv).rgb * 0.227027;
          sum += texture2D(uTex, vUv + step * 1.3846).rgb * 0.316216;
          sum += texture2D(uTex, vUv - step * 1.3846).rgb * 0.316216;
          sum += texture2D(uTex, vUv + step * 3.2308).rgb * 0.070270;
          sum += texture2D(uTex, vUv - step * 3.2308).rgb * 0.070270;
          gl_FragColor = vec4(sum, 1.0);
        }
      `,
    });

    this.godMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uBright: { value: null },
        uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
        uVisible: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uBright;
        uniform vec2 uSunPos;
        uniform float uVisible;
        varying vec2 vUv;
        const int SAMPLES = 32;
        void main() {
          if (uVisible < 0.001) { gl_FragColor = vec4(0.0); return; }
          vec2 delta = (vUv - uSunPos) * (1.0 / float(SAMPLES)) * 0.92;
          vec2 coord = vUv;
          float decay = 0.96;
          float illum = 1.0;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < SAMPLES; i++) {
            coord -= delta;
            vec3 s = texture2D(uBright, coord).rgb;
            acc += s * illum;
            illum *= decay;
          }
          acc *= 1.0 / float(SAMPLES);
          gl_FragColor = vec4(acc * uVisible, 1.0);
        }
      `,
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uScene: { value: null },
        uBloom: { value: null },
        uGod: { value: null },
        uBloomStrength: { value: this.bloomStrength },
        uGodStrength: { value: this.godStrength },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uScene;
        uniform sampler2D uBloom;
        uniform sampler2D uGod;
        uniform float uBloomStrength;
        uniform float uGodStrength;
        varying vec2 vUv;
        void main() {
          vec3 scene = texture2D(uScene, vUv).rgb;
          vec3 bloom = texture2D(uBloom, vUv).rgb * uBloomStrength;
          vec3 god = texture2D(uGod, vUv).rgb * uGodStrength;
          // Screen-blend du bloom (lumineux mais sans cramer), god rays additifs.
          vec3 col = 1.0 - (1.0 - scene) * (1.0 - bloom);
          col += god;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `,
    });
  }

  setQuality(quality: PostQuality): void {
    this.enabled = quality !== "low";
    this.godEnabled = quality !== "low";
    this.bloomStrength = quality === "high" ? 0.42 : 0.34;
  }

  /** Cible plein écran (sRGB, avec depth) où le compositeur rend la frame. */
  inputTarget(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    this.ensureTargets(renderer);
    return this.inputRT!;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, sunWorldDir: THREE.Vector3, sunGlow: number): void {
    const input = this.inputRT;
    const bloomA = this.bloomA;
    const bloomB = this.bloomB;
    const god = this.godRT;
    if (!input || !bloomA || !bloomB || !god) return;

    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // 1) Bright-pass plein->demi résolution.
    this.brightMaterial.uniforms.uScene.value = input.texture;
    this.drawPass(renderer, this.brightMaterial, bloomA);

    // 2) Flou gaussien séparable (H puis V), deux fois pour un halo large.
    const texel = this.blurMaterial.uniforms.uTexel.value as THREE.Vector2;
    texel.set(1 / bloomA.width, 1 / bloomA.height);
    for (let i = 0; i < 2; i += 1) {
      this.blurMaterial.uniforms.uTex.value = bloomA.texture;
      (this.blurMaterial.uniforms.uDirection.value as THREE.Vector2).set(1, 0);
      this.drawPass(renderer, this.blurMaterial, bloomB);
      this.blurMaterial.uniforms.uTex.value = bloomB.texture;
      (this.blurMaterial.uniforms.uDirection.value as THREE.Vector2).set(0, 1);
      this.drawPass(renderer, this.blurMaterial, bloomA);
    }

    // 3) God rays : flou radial du bright-pass depuis la position écran du soleil.
    let visible = 0;
    if (this.godEnabled && sunGlow > 0.02) {
      const forward = camera.getWorldDirection(this.sunScreen).clone();
      const facing = forward.dot(sunWorldDir);
      if (facing > 0) {
        this.sunScreen.copy(camera.position).addScaledVector(sunWorldDir, 1000).project(camera);
        const sx = this.sunScreen.x * 0.5 + 0.5;
        const sy = this.sunScreen.y * 0.5 + 0.5;
        (this.godMaterial.uniforms.uSunPos.value as THREE.Vector2).set(sx, sy);
        // Atténue quand le soleil sort de l'écran ou est rasant.
        const edge = Math.max(Math.abs(this.sunScreen.x), Math.abs(this.sunScreen.y));
        visible = Math.min(1, sunGlow) * Math.max(0, facing) * (1 - THREE.MathUtils.smoothstep(edge, 1.0, 1.6));
      }
    }
    this.godMaterial.uniforms.uVisible.value = visible;
    if (visible > 0.001) {
      this.godMaterial.uniforms.uBright.value = bloomA.texture;
      this.drawPass(renderer, this.godMaterial, god);
    }

    // 4) Composition finale à l'écran.
    this.compositeMaterial.uniforms.uScene.value = input.texture;
    this.compositeMaterial.uniforms.uBloom.value = bloomA.texture;
    this.compositeMaterial.uniforms.uGod.value = visible > 0.001 ? god.texture : this.blackTexture(bloomB);
    this.compositeMaterial.uniforms.uBloomStrength.value = this.bloomStrength;
    this.compositeMaterial.uniforms.uGodStrength.value = visible > 0.001 ? this.godStrength : 0;
    renderer.setRenderTarget(null);
    this.drawPass(renderer, this.compositeMaterial, null);

    renderer.autoClear = previousAutoClear;
  }

  private blackTexture(rt: THREE.WebGLRenderTarget): THREE.Texture {
    return rt.texture;
  }

  private drawPass(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.screenScene, this.screenCamera);
  }

  private ensureTargets(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.drawingSize);
    const w = Math.max(1, Math.floor(this.drawingSize.x));
    const h = Math.max(1, Math.floor(this.drawingSize.y));
    if (this.inputRT && this.width === w && this.height === h) return;
    this.disposeTargets();
    this.width = w;
    this.height = h;
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));

    this.inputRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.inputRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.inputRT.texture.generateMipmaps = false;

    this.bloomA = this.makeHalf(hw, hh);
    this.bloomB = this.makeHalf(hw, hh);
    this.godRT = this.makeHalf(hw, hh);
  }

  private makeHalf(w: number, h: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  private disposeTargets(): void {
    this.inputRT?.dispose();
    this.bloomA?.dispose();
    this.bloomB?.dispose();
    this.godRT?.dispose();
    this.inputRT = null;
    this.bloomA = null;
    this.bloomB = null;
    this.godRT = null;
  }

  dispose(): void {
    this.disposeTargets();
    this.quad.geometry.dispose();
    this.brightMaterial.dispose();
    this.blurMaterial.dispose();
    this.godMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
