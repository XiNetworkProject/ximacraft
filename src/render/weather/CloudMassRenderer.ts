/**
 * Rendu (temporaire, "basique") des masses nuageuses discrètes.
 *
 * Chaque {@link CloudMass} est dessinée comme un petit amas de "puffs"
 * (billboards doux). Un seul InstancedMesh (1 draw call) avec un shader de
 * billboard ; couleur et opacité par puff via attributs instanciés.
 *
 * Effets demandés :
 *  - densité/opacité selon la maturité (cloudCover) ;
 *  - base plus sombre si risque d'orage (darkness) ;
 *  - développement vertical pour les cumulonimbus ;
 *  - enclume étirée dans la direction du vent d'altitude (anvilStretch/anvilDir).
 *
 * Le placement des puffs est déterministe (graine de la masse) → pas de
 * scintillement d'une frame à l'autre.
 */

import * as THREE from "three";
import { CloudSystem } from "../../weather/clouds/CloudSystem";
import { CloudMass } from "../../weather/clouds/CloudMass";
import { CloudType, isStorm } from "../../weather/clouds/CloudType";
import { WeatherEvent } from "../../weather/events/WeatherEvent";
import { SquallLineEvent } from "../../weather/events/SquallLineEvent";
import { WeatherEventType } from "../../weather/WeatherTypes";

const MAX_INSTANCES = 640;

function puffCount(type: CloudType): number {
  switch (type) {
    case CloudType.CIRRUS:
      return 5;
    case CloudType.STRATUS:
      return 8;
    case CloudType.FOG:
      return 6;
    case CloudType.CUMULUS:
      return 6;
    case CloudType.CUMULUS_CONGESTUS:
      return 9;
    case CloudType.CUMULONIMBUS:
      return 42;
    case CloudType.ANVIL:
      return 46;
  }
}

function baseOpacity(type: CloudType): number {
  switch (type) {
    case CloudType.CIRRUS:
      return 0.25;
    case CloudType.STRATUS:
    case CloudType.FOG:
      return 0.5;
    default:
      return 0.72;
  }
}

/** Pseudo-aléatoire déterministe dans [0,1) pour un puff donné. */
function rand(seed: number, i: number, salt: number): number {
  let h = (Math.imul(seed, 73856093) ^ Math.imul(i, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class CloudMassRenderer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aOpacity: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  // Scratch (zéro allocation par frame).
  private readonly mat = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly litColor = new THREE.Color();
  private readonly baseShadow = new THREE.Color();
  private readonly darkColor = new THREE.Color();
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, private readonly clouds: CloudSystem) {
    const colors = new Float32Array(MAX_INSTANCES * 3);
    const opacities = new Float32Array(MAX_INSTANCES);
    this.aColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.aOpacity = new THREE.InstancedBufferAttribute(opacities, 1);
    this.aColor.setUsage(THREE.DynamicDrawUsage);
    this.aOpacity.setUsage(THREE.DynamicDrawUsage);

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("aColor", this.aColor);
    geometry.setAttribute("aOpacity", this.aOpacity);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: { uMap: { value: this.createPuffTexture() } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aOpacity;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          vUv = uv;
          vColor = aColor;
          vOpacity = aOpacity;
          // Translation et échelle (non-uniforme) extraites de instanceMatrix.
          vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float sx = length(vec3(instanceMatrix[0]));
          float sy = length(vec3(instanceMatrix[1]));
          // Billboard : quad orienté vers la caméra (axes droite/haut de la vue).
          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 world = instPos + camRight * position.x * sx + camUp * position.y * sy;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          float a = texture2D(uMap, vUv).a * vOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_INSTANCES);
    this.mesh.frustumCulled = false; // billboard custom : on gère la visibilité nous-mêmes
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** À appeler chaque frame, après CloudSystem.update(). */
  update(dayFactor: number, events: readonly WeatherEvent[], cameraPosition: THREE.Vector3): void {
    const bright = 0.45 + 0.55 * Math.max(0, Math.min(1, dayFactor));
    this.litColor.setRGB(bright, bright, bright); // sommet éclairé
    this.baseShadow.setRGB(0.52 * bright, 0.57 * bright, 0.68 * bright); // base bleutée ombrée
    this.darkColor.setRGB(0.32 * bright, 0.35 * bright, 0.43 * bright); // base orageuse (bleu-gris, pas brun)

    let n = 0;
    // Cumulus/stratus/cirrus proches (les orages, eux, sont pilotés par les
    // événements pour rester visibles même très loin).
    for (const mass of this.clouds.masses) {
      if (n >= MAX_INSTANCES) break;
      if (isStorm(mass.type)) continue;
      n = this.writeMass(mass, n);
    }
    // Les cumulonimbus sont désormais rendus par le système CONVECTIF
    // (ConvectiveCloudRenderer, puffs simulés). On ne dessine plus de taches
    // billboard d'orage ici pour éviter les doublons.
    void events;
    void cameraPosition;

    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aOpacity.needsUpdate = true;
  }

  /** Cumulus/stratus/cirrus/brouillard : amas ellipsoïdal ombré verticalement. */
  private writeMass(mass: CloudMass, start: number): number {
    const count = puffCount(mass.type);
    const opacity = mass.density * baseOpacity(mass.type);
    if (opacity < 0.01) return start;
    const flat = mass.type === CloudType.STRATUS || mass.type === CloudType.CIRRUS || mass.type === CloudType.FOG;
    const vertical = mass.type === CloudType.CUMULUS_CONGESTUS;

    let idx = start;
    for (let i = 0; i < count && idx < MAX_INSTANCES; i += 1) {
      const r1 = rand(mass.seed, i, 1);
      const r2 = rand(mass.seed, i, 2);
      const r3 = rand(mass.seed, i, 3);
      const r4 = rand(mass.seed, i, 4);
      const r5 = rand(mass.seed, i, 5);

      const ox = (r1 - 0.5) * mass.width;
      const oz = (r2 - 0.5) * mass.width;
      const oy = vertical ? r3 * mass.height : (r3 - 0.5) * mass.height + mass.height * 0.4;
      const size = mass.width * 0.45 * (0.7 + 0.5 * r4);
      const sizeY = flat ? size * 0.45 : size;

      const hf = Math.max(0, Math.min(1, oy / Math.max(mass.height, 1)));
      const darkAmt = mass.darkness * (oy < mass.height * 0.4 ? 1 : 0.5);
      this.writePuff(idx, mass.x + ox, mass.y + oy, mass.z + oz, size, sizeY, opacity * (0.8 + 0.2 * r5), hf, darkAmt);
      idx += 1;
    }
    return idx;
  }

  /** Construit un cumulonimbus billboard à partir d'un événement orageux. */
  private writeStormFromEvent(event: WeatherEvent, cam: THREE.Vector3, start: number): number {
    const distance = Math.hypot(event.x - cam.x, event.z - cam.z);
    if (distance > 9000) return start;
    const farFade = 1 - THREE.MathUtils.smoothstep(distance, 6000, 9000);
    const life = Math.max(0, Math.min(1, Math.min(event.age / 8, (event.maxAge - event.age) / 12)));
    const opacity = baseOpacity(CloudType.CUMULONIMBUS) * event.intensity * farFade * life;
    if (opacity < 0.02) return start;

    const squall = event instanceof SquallLineEvent;
    const width = squall
      ? Math.max(260, Math.min(event.length * 0.3, 1700))
      : Math.max(180, Math.min(event.radius * 0.78, 640));
    const height = 320 + event.intensity * 300;
    const darkness = Math.min(1, 0.5 + event.intensity * 0.45);
    const len = Math.hypot(event.dirX, event.dirZ);
    const adx = len > 0.01 ? event.dirX / len : 1;
    const adz = len > 0.01 ? event.dirZ / len : 0;
    const count = squall ? 40 : puffCount(CloudType.CUMULONIMBUS);
    return this.writeStormCluster(event.x, event.z, event.cloudBaseY, width, height, adx, adz, 0.85, darkness, opacity, count, (event.id * 131) >>> 0, start);
  }

  /** Tour bombée + enclume évasée vers l'aval, en puffs billboards. */
  private writeStormCluster(
    cx: number,
    cz: number,
    baseY: number,
    width: number,
    height: number,
    adx: number,
    adz: number,
    stretch: number,
    darkness: number,
    opacity: number,
    count: number,
    seed: number,
    start: number,
  ): number {
    let idx = start;
    for (let i = 0; i < count && idx < MAX_INSTANCES; i += 1) {
      const r1 = rand(seed, i, 1);
      const r2 = rand(seed, i, 2);
      const r3 = rand(seed, i, 3);
      const r5 = rand(seed, i, 5);
      const t = rand(seed, i, 6);
      let ox: number, oz: number, oy: number, sizeX: number, sizeY: number, darkAmt: number;

      if (t < 0.2) {
        // BASE : galette large et sombre, puffs qui se chevauchent.
        ox = (r1 - 0.5) * 1.3 * width;
        oz = (r2 - 0.5) * 1.3 * width;
        oy = r3 * 0.07 * height;
        sizeX = width * (0.8 + 0.4 * r3);
        sizeY = sizeX * 0.6;
        darkAmt = darkness;
      } else if (t < 0.72) {
        // TOUR : colonne DENSE, gros puffs ronds qui se chevauchent (masse solide).
        const h2 = (t - 0.2) / 0.52;
        const towerR = width * (0.5 - h2 * 0.12);
        ox = (r1 - 0.5) * 1.4 * towerR;
        oz = (r2 - 0.5) * 1.4 * towerR;
        oy = (0.1 + h2 * 0.56) * height;
        sizeX = towerR * (1.3 + 0.4 * r3); // gros → recouvrement, pas de trous
        sizeY = sizeX * 0.9;
        darkAmt = darkness * (1.0 - h2) * 0.5;
      } else {
        // ENCLUME : chapeau LARGE et plat, concentré au sommet, étalé vers l'aval.
        const a = (t - 0.72) / 0.28;
        const flare = width * (1.0 + 1.3 * a);
        const downwind = (0.5 + a * 0.8) * width * stretch * 1.2;
        ox = (r1 - 0.5) * 2.0 * flare + adx * downwind;
        oz = (r2 - 0.5) * 1.1 * flare + adz * downwind;
        oy = (0.72 + r3 * 0.12) * height; // couche fine en haut (pas étalée verticalement)
        sizeX = flare * (0.6 + 0.3 * r3);
        sizeY = sizeX * 0.5;
        darkAmt = 0.0;
      }

      const hf = Math.max(0, Math.min(1, oy / Math.max(height, 1)));
      this.writePuff(idx, cx + ox, baseY + oy, cz + oz, sizeX, sizeY, opacity * (0.8 + 0.2 * r5), hf, darkAmt);
      idx += 1;
    }
    return idx;
  }

  /** Écrit un puff : couleur (base ombrée → sommet éclairé + orage) puis instance. */
  private writePuff(
    idx: number,
    x: number,
    y: number,
    z: number,
    sizeX: number,
    sizeY: number,
    opacity: number,
    hf: number,
    darkAmt: number,
  ): void {
    this.tmpColor.copy(this.baseShadow).lerp(this.litColor, 0.3 + Math.max(0, Math.min(1, hf)) * 0.7);
    if (darkAmt > 0) this.tmpColor.lerp(this.darkColor, Math.min(1, darkAmt));
    this.pos.set(x, y, z);
    this.scl.set(sizeX, sizeY, 1);
    this.mat.compose(this.pos, this.quat, this.scl);
    this.mesh.setMatrixAt(idx, this.mat);
    const base = idx * 3;
    (this.aColor.array as Float32Array)[base] = this.tmpColor.r;
    (this.aColor.array as Float32Array)[base + 1] = this.tmpColor.g;
    (this.aColor.array as Float32Array)[base + 2] = this.tmpColor.b;
    (this.aOpacity.array as Float32Array)[idx] = opacity;
  }

  private createPuffTexture(): THREE.CanvasTexture {
    // Puff "fluffy" : amas de petits lobes doux → bord grumeleux de nuage,
    // pas un simple cercle flou. Généré une seule fois (coût nul par frame).
    const size = 128;
    const r = size / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 30; i += 1) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * r * 0.55;
      const px = r + Math.cos(ang) * rad;
      const py = r + Math.sin(ang) * rad;
      const pr = r * (0.16 + Math.random() * 0.34);
      const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, "rgba(255,255,255,0.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Masque circulaire : fond progressif vers le bord (jamais de coupe nette).
    ctx.globalCompositeOperation = "destination-in";
    const mask = ctx.createRadialGradient(r, r, r * 0.2, r, r, r);
    mask.addColorStop(0, "rgba(255,255,255,1)");
    mask.addColorStop(0.72, "rgba(255,255,255,0.9)");
    mask.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    (this.material.uniforms.uMap.value as THREE.Texture).dispose();
    this.mesh.dispose();
  }
}
