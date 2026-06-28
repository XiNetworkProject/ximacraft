import * as THREE from "three";
import { Settings } from "./Settings";
import { PostProcessing } from "../render/PostProcessing";

export interface FrameCompositor {
  renderFrame(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    outputTarget?: THREE.WebGLRenderTarget | null,
  ): void;
}

export type ShadowQuality = "low" | "balanced" | "high";

/** Distance (en blocs) à laquelle on place la lumière du soleil pour les ombres. */
const SUN_SHADOW_DISTANCE = 260;

export class Renderer {
  readonly root: HTMLDivElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly ambientLight = new THREE.AmbientLight(0xffffff, 0.24);
  readonly hemisphereLight = new THREE.HemisphereLight(0xbddcff, 0x31401f, 0.48);
  readonly sunLight = new THREE.DirectionalLight(0xfff4cf, 1.25);
  readonly moonLight = new THREE.DirectionalLight(0x9fb8ff, 0.14);
  readonly post = new PostProcessing();
  private frameCompositor: FrameCompositor | null = null;
  private readonly sunWorldDir = new THREE.Vector3(0, 1, 0);
  private sunGlow = 1;
  /** Rayon couvert par la caméra d'ombre orthographique, en blocs. */
  private shadowRadius = 90;
  private shadowsEnabled = true;
  private readonly shadowAnchor = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "game-root";
    container.appendChild(this.root);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, Settings.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.58;
    // Ombres de soleil temps réel (PCF doux) : c'est ce qui donne le relief
    // « jeu vidéo ». Le shadow map est rendu automatiquement par le renderer
    // avant la passe de scène, y compris via le compositeur de nuages.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.domElement.className = "game-canvas";
    this.renderer.domElement.tabIndex = 0;
    this.root.appendChild(this.renderer.domElement);

    // Distant weather must remain visible several kilometres before it arrives.
    this.camera = new THREE.PerspectiveCamera(Settings.initialFov, window.innerWidth / window.innerHeight, 0.1, 40000);
    this.scene.add(this.camera);
    this.scene.add(this.ambientLight);
    this.scene.add(this.hemisphereLight);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.scene.add(this.moonLight);
    this.scene.fog = new THREE.Fog(0x9bb7cf, 120, 980);
    this.sunLight.position.set(80, 120, -60);
    this.moonLight.position.set(-80, 80, 60);
    // Résolution par défaut = preset « équilibré » (ajustée ensuite via setShadowQuality).
    this.sunLight.shadow.mapSize.set(1536, 1536);
    this.configureSunShadow();

    window.addEventListener("resize", this.resize);
  }

  /** Configure la caméra d'ombre du soleil (frustum orthographique + biais). */
  private configureSunShadow(): void {
    this.sunLight.castShadow = this.shadowsEnabled;
    const shadow = this.sunLight.shadow;
    const cam = shadow.camera;
    cam.left = -this.shadowRadius;
    cam.right = this.shadowRadius;
    cam.top = this.shadowRadius;
    cam.bottom = -this.shadowRadius;
    cam.near = 1;
    cam.far = SUN_SHADOW_DISTANCE * 2;
    cam.updateProjectionMatrix();
    // Surfaces voxel = grands plans : un normalBias évite l'acné et le
    // « peter-panning » sans creuser les contacts.
    shadow.bias = -0.0006;
    shadow.normalBias = 0.6;
    shadow.needsUpdate = true;
  }

  /**
   * Recale la lumière du soleil pour que la caméra d'ombre suive le joueur.
   * `sunDirection` part du joueur vers le soleil (normalisé). On « snappe »
   * l'ancrage à la grille des texels d'ombre pour supprimer le scintillement.
   */
  updateSunShadow(anchor: THREE.Vector3, sunDirection: THREE.Vector3): void {
    if (!this.shadowsEnabled) {
      return;
    }
    const mapSize = this.sunLight.shadow.mapSize.x || 2048;
    const texel = (this.shadowRadius * 2) / mapSize;
    this.shadowAnchor.set(
      Math.round(anchor.x / texel) * texel,
      Math.round(anchor.y / texel) * texel,
      Math.round(anchor.z / texel) * texel,
    );
    this.sunLight.position.copy(this.shadowAnchor).addScaledVector(sunDirection, SUN_SHADOW_DISTANCE);
    this.sunLight.target.position.copy(this.shadowAnchor);
    this.sunLight.target.updateMatrixWorld();
  }

  setShadowQuality(quality: ShadowQuality): void {
    const mapSize = quality === "high" ? 2048 : quality === "balanced" ? 1536 : 1024;
    this.shadowRadius = quality === "high" ? 110 : quality === "balanced" ? 90 : 64;
    this.shadowsEnabled = quality !== "low";
    if (this.sunLight.shadow.mapSize.x !== mapSize) {
      this.sunLight.shadow.mapSize.set(mapSize, mapSize);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }
    this.configureSunShadow();
  }

  render(): void {
    if (this.post.enabled) {
      const input = this.post.inputTarget(this.renderer);
      if (this.frameCompositor) {
        this.frameCompositor.renderFrame(this.renderer, this.scene, this.camera, input);
      } else {
        this.renderer.setRenderTarget(input);
        this.renderer.render(this.scene, this.camera);
      }
      this.post.render(this.renderer, this.camera, this.sunWorldDir, this.sunGlow);
      return;
    }
    if (this.frameCompositor) {
      this.frameCompositor.renderFrame(this.renderer, this.scene, this.camera);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  setFrameCompositor(compositor: FrameCompositor | null): void {
    this.frameCompositor = compositor;
  }

  /** Direction monde→soleil + intensité du glow, pour les god rays (post). */
  setPostSun(direction: THREE.Vector3, glow: number): void {
    this.sunWorldDir.copy(direction);
    this.sunGlow = glow;
  }

  setPostQuality(quality: "low" | "balanced" | "high"): void {
    this.post.setQuality(quality);
  }

  setPixelRatioLimit(limit: number): void {
    Settings.maxPixelRatio = limit;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, Settings.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
    this.root.remove();
  }

  private readonly resize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, Settings.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
