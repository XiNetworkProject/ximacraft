/**
 * Fond de menu vivant : une scène procédurale dessinée au canvas (ciel dégradé,
 * soleil, nuages dérivants, collines en parallaxe, particules) qui change
 * lentement d'ambiance (aube → jour → coucher → nuit) en fondu. Léger parallax
 * à la souris. Aucune dépendance au monde de jeu → performant et toujours dispo.
 *
 * S'anime uniquement quand le menu est visible (start()/stop()).
 */

interface Palette {
  skyTop: [number, number, number];
  skyHorizon: [number, number, number];
  sun: [number, number, number];
  sunGlow: [number, number, number];
  hills: [number, number, number];
  cloud: [number, number, number];
  particle: [number, number, number];
  sunY: number; // 0 haut .. 1 bas (hauteur du soleil)
  stars: number; // 0..1 densité d'étoiles
}

const PALETTES: Palette[] = [
  // Aube
  { skyTop: [40, 54, 92], skyHorizon: [240, 168, 130], sun: [255, 224, 170], sunGlow: [255, 196, 140], hills: [46, 58, 74], cloud: [250, 210, 190], particle: [255, 240, 210], sunY: 0.74, stars: 0.25 },
  // Jour
  { skyTop: [58, 132, 214], skyHorizon: [186, 222, 248], sun: [255, 250, 232], sunGlow: [255, 244, 210], hills: [70, 104, 92], cloud: [255, 255, 255], particle: [255, 255, 240], sunY: 0.3, stars: 0 },
  // Coucher
  { skyTop: [54, 48, 96], skyHorizon: [255, 138, 84], sun: [255, 196, 120], sunGlow: [255, 150, 96], hills: [52, 44, 60], cloud: [255, 188, 150], particle: [255, 220, 180], sunY: 0.82, stars: 0.2 },
  // Nuit
  { skyTop: [10, 16, 38], skyHorizon: [32, 44, 78], sun: [196, 214, 255], sunGlow: [120, 150, 220], hills: [22, 28, 44], cloud: [120, 132, 168], particle: [200, 218, 255], sunY: 0.24, stars: 1 },
];

const SCENE_SECONDS = 16; // durée d'une ambiance avant fondu

interface HillLayer {
  amp: number;
  base: number; // hauteur de base (fraction de l'écran)
  freq: number;
  speed: number;
  shade: number; // 0..1 assombrit la couleur des collines
  phase: number;
}

interface Particle {
  x: number;
  y: number;
  speed: number;
  drift: number;
  size: number;
  twinkle: number;
}

export class MainMenuBackground {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private time = 0;
  private last = 0;
  private width = 0;
  private height = 0;
  private pointerX = 0.5;
  private pointerY = 0.5;
  private targetPointerX = 0.5;
  private targetPointerY = 0.5;
  private readonly layers: HillLayer[] = [
    { amp: 0.05, base: 0.6, freq: 1.7, speed: 5, shade: 0.55, phase: 12.3 },
    { amp: 0.08, base: 0.72, freq: 1.15, speed: 9, shade: 0.78, phase: 4.1 },
    { amp: 0.12, base: 0.86, freq: 0.8, speed: 15, shade: 1, phase: 31.7 },
  ];
  private readonly clouds: { x: number; y: number; scale: number; speed: number; opacity: number }[] = [];
  private readonly particles: Particle[] = [];
  private readonly starSeeds: { x: number; y: number; phase: number; size: number }[] = [];

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "main-menu-bg";
    this.ctx = this.canvas.getContext("2d")!;
    for (let i = 0; i < 7; i += 1) {
      this.clouds.push({
        x: Math.random(),
        y: 0.12 + Math.random() * 0.32,
        scale: 0.6 + Math.random() * 1.1,
        speed: 0.004 + Math.random() * 0.01,
        opacity: 0.4 + Math.random() * 0.5,
      });
    }
    for (let i = 0; i < 70; i += 1) {
      this.particles.push({
        x: Math.random(),
        y: Math.random(),
        speed: 0.01 + Math.random() * 0.04,
        drift: (Math.random() - 0.5) * 0.02,
        size: 0.6 + Math.random() * 1.8,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
    for (let i = 0; i < 220; i += 1) {
      this.starSeeds.push({ x: Math.random(), y: Math.random() * 0.6, phase: Math.random() * Math.PI * 2, size: 0.5 + Math.random() * 1.4 });
    }
    window.addEventListener("pointermove", this.onPointerMove);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.remove();
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.targetPointerX = event.clientX / Math.max(1, window.innerWidth);
    this.targetPointerY = event.clientY / Math.max(1, window.innerHeight);
  };

  private resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * ratio);
    this.canvas.height = Math.floor(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    if (Math.floor(this.width) !== window.innerWidth || Math.floor(this.height) !== window.innerHeight) {
      this.resize();
    }
    this.pointerX += (this.targetPointerX - this.pointerX) * Math.min(1, dt * 3);
    this.pointerY += (this.targetPointerY - this.pointerY) * Math.min(1, dt * 3);
    try {
      this.draw(dt);
    } catch (error) {
      console.error("[menubg] draw error", error);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private currentPalette(): { p: Palette } {
    const cycle = (this.time / SCENE_SECONDS) % PALETTES.length;
    const i = Math.floor(cycle);
    const t = smooth(cycle - i);
    const a = PALETTES[i];
    const b = PALETTES[(i + 1) % PALETTES.length];
    return { p: lerpPalette(a, b, t) };
  }

  private draw(dt: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const { p } = this.currentPalette();
    const parX = (this.pointerX - 0.5) * 28;
    const parY = (this.pointerY - 0.5) * 16;

    // Ciel
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, rgb(p.skyTop));
    sky.addColorStop(1, rgb(p.skyHorizon));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Étoiles
    if (p.stars > 0.01) {
      for (const s of this.starSeeds) {
        const tw = 0.5 + 0.5 * Math.sin(this.time * 1.7 + s.phase);
        ctx.globalAlpha = p.stars * tw * 0.9;
        ctx.fillStyle = rgb(p.particle);
        ctx.fillRect(s.x * w + parX * 0.3, s.y * h + parY * 0.3, s.size, s.size);
      }
      ctx.globalAlpha = 1;
    }

    // Soleil + halo
    const sunX = w * 0.5 + parX * 1.4 + Math.sin(this.time * 0.05) * w * 0.06;
    const sunY = h * p.sunY + parY * 0.6;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.min(w, h) * 0.55);
    glow.addColorStop(0, rgba(p.sunGlow, 0.55));
    glow.addColorStop(0.25, rgba(p.sunGlow, 0.22));
    glow.addColorStop(1, rgba(p.sunGlow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.min(w, h) * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = rgb(p.sun);
    ctx.fill();

    // Nuages
    for (const cloud of this.clouds) {
      cloud.x += cloud.speed * dt;
      if (cloud.x > 1.25) cloud.x = -0.25;
      const cx = cloud.x * (w + 200) - 100 + parX * 0.6;
      const cy = cloud.y * h + parY * 0.4;
      this.drawCloud(cx, cy, cloud.scale * Math.min(w, h) * 0.12, rgba(p.cloud, cloud.opacity * 0.5));
    }

    // Collines en parallaxe
    for (let li = 0; li < this.layers.length; li += 1) {
      const layer = this.layers[li];
      const yBase = h * layer.base + parY * (0.4 + li * 0.5);
      const offset = this.time * layer.speed + parX * (0.6 + li * 0.6);
      ctx.beginPath();
      ctx.moveTo(0, h);
      const step = Math.max(6, w / 160);
      for (let x = 0; x <= w + step; x += step) {
        const n =
          Math.sin((x * layer.freq) / 220 + offset * 0.02 + layer.phase) * 0.6 +
          Math.sin((x * layer.freq) / 90 - offset * 0.013 + layer.phase * 1.7) * 0.3 +
          Math.sin((x * layer.freq) / 47 + offset * 0.03) * 0.1;
        const y = yBase - n * h * layer.amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = rgb(scaleColor(p.hills, layer.shade));
      ctx.fill();
    }

    // Particules (poussière / lucioles / flocons selon ambiance)
    for (const part of this.particles) {
      part.y -= part.speed * dt * 0.4;
      part.x += part.drift * dt;
      if (part.y < -0.02) {
        part.y = 1.02;
        part.x = Math.random();
      }
      const tw = 0.55 + 0.45 * Math.sin(this.time * 2 + part.twinkle);
      ctx.globalAlpha = 0.5 * tw;
      ctx.fillStyle = rgb(p.particle);
      ctx.fillRect(part.x * w + parX, part.y * h, part.size, part.size);
    }
    ctx.globalAlpha = 1;

    // Vignette douce
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.35, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  private drawCloud(x: number, y: number, scale: number, fill: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = fill;
    const puffs: [number, number, number][] = [
      [0, 0, 1],
      [-0.7, 0.12, 0.68],
      [0.7, 0.1, 0.72],
      [-0.32, -0.22, 0.7],
      [0.34, -0.2, 0.66],
    ];
    ctx.beginPath();
    for (const [dx, dy, r] of puffs) {
      ctx.moveTo(x + dx * scale + r * scale, y + dy * scale);
      ctx.arc(x + dx * scale, y + dy * scale, r * scale, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpTriple(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function lerpPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    skyTop: lerpTriple(a.skyTop, b.skyTop, t),
    skyHorizon: lerpTriple(a.skyHorizon, b.skyHorizon, t),
    sun: lerpTriple(a.sun, b.sun, t),
    sunGlow: lerpTriple(a.sunGlow, b.sunGlow, t),
    hills: lerpTriple(a.hills, b.hills, t),
    cloud: lerpTriple(a.cloud, b.cloud, t),
    particle: lerpTriple(a.particle, b.particle, t),
    sunY: lerp(a.sunY, b.sunY, t),
    stars: lerp(a.stars, b.stars, t),
  };
}

function scaleColor(c: [number, number, number], s: number): [number, number, number] {
  return [c[0] * s, c[1] * s, c[2] * s];
}

function rgb(c: [number, number, number]): string {
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
}
