/**
 * Profiler F3 activable.
 *
 * Objectif : mesurer FPS, frametime (moyen/p95/p99), freezes (>33/50/100 ms) et
 * le temps CPU par système (génération/meshing/lumière/neige/météo/nuages/
 * brouillard/WorldMemory/faune/rendu), plus chunks et stats GPU.
 *
 * Contrainte : coûter quasiment rien quand il est désactivé. Quand `enabled` est
 * faux, `begin()` renvoie 0 sans appeler l'horloge et `add()` sort immédiatement ;
 * seul l'enregistrement du frametime (un écrit dans un buffer circulaire) tourne
 * en continu, ce qui est négligeable.
 */
export class Profiler {
  enabled = false;

  private readonly frametimes = new Float32Array(300);
  private frameIdx = 0;
  private frameCount = 0;
  private fpsEma = 1000 / 60;

  // Temps par section (ms), lissé (EMA) pour un affichage stable.
  private readonly sections = new Map<string, number>();
  private readonly sectionOrder: string[] = [];

  private readonly root: HTMLDivElement;
  private lastRender = 0;
  private readonly scratch = new Float32Array(300);

  constructor(overlay: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "debug-overlay profiler-overlay hidden";
    this.root.style.right = "8px";
    this.root.style.left = "auto";
    this.root.style.whiteSpace = "pre";
    overlay.appendChild(this.root);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.root.classList.toggle("hidden", !this.enabled);
  }

  /** Démarre un chrono de section. No-op (renvoie 0) quand désactivé. */
  begin(): number {
    return this.enabled ? performance.now() : 0;
  }

  /** Ajoute le temps écoulé depuis `start` à la section `name`. No-op si off. */
  add(name: string, start: number): void {
    if (!this.enabled || start === 0) return;
    this.addMs(name, performance.now() - start);
  }

  /** Ajoute une durée déjà mesurée (ms) à la section `name`. No-op si off. */
  addMs(name: string, dt: number): void {
    if (!this.enabled) return;
    const prev = this.sections.get(name);
    if (prev === undefined) {
      this.sections.set(name, dt);
      this.sectionOrder.push(name);
    } else {
      this.sections.set(name, prev * 0.9 + dt * 0.1);
    }
  }

  /** Enregistre le frametime de la frame (toujours actif, coût négligeable). */
  recordFrame(deltaMs: number): void {
    this.frametimes[this.frameIdx] = deltaMs;
    this.frameIdx = (this.frameIdx + 1) % this.frametimes.length;
    if (this.frameCount < this.frametimes.length) this.frameCount += 1;
    this.fpsEma = this.fpsEma * 0.92 + deltaMs * 0.08;
  }

  /** Rafraîchit le panneau (throttlé ~5 Hz). À n'appeler que si activé. */
  present(info: {
    loaded: number;
    meshed: number;
    dirty: number;
    pending: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    extra?: string[];
  }): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastRender < 200) return;
    this.lastRender = now;

    const n = this.frameCount;
    let avg = 0;
    for (let i = 0; i < n; i += 1) {
      const v = this.frametimes[i];
      this.scratch[i] = v;
      avg += v;
    }
    avg = n > 0 ? avg / n : 0;
    const sorted = this.scratch.subarray(0, n).slice().sort();
    const pct = (p: number) => (n > 0 ? sorted[Math.min(n - 1, Math.floor(p * n))] : 0);
    let over33 = 0;
    let over50 = 0;
    let over100 = 0;
    for (let i = 0; i < n; i += 1) {
      const v = this.frametimes[i];
      if (v > 33) over33 += 1;
      if (v > 50) over50 += 1;
      if (v > 100) over100 += 1;
    }

    const fps = Math.round(1000 / Math.max(0.0001, this.fpsEma));
    const lines: string[] = [];
    lines.push(`── PROFILER (F3) ──`);
    lines.push(`FPS ${fps}   frame avg ${avg.toFixed(1)}ms`);
    lines.push(`p95 ${pct(0.95).toFixed(1)}ms  p99 ${pct(0.99).toFixed(1)}ms  max ${pct(1).toFixed(1)}ms`);
    lines.push(`freezes >33:${over33} >50:${over50} >100:${over100} /${n}`);
    lines.push(`── CPU / système (ms) ──`);
    let totalCpu = 0;
    for (const name of this.sectionOrder) {
      const v = this.sections.get(name) ?? 0;
      totalCpu += v;
      lines.push(`  ${name.padEnd(11)} ${v.toFixed(2)}`);
    }
    lines.push(`  ${"TOTAL".padEnd(11)} ${totalCpu.toFixed(2)}`);
    lines.push(`── Chunks ──`);
    lines.push(`  chargés ${info.loaded}  meshés ${info.meshed}`);
    lines.push(`  dirty ${info.dirty}  attente ${info.pending}`);
    lines.push(`── GPU ──`);
    lines.push(`  draw calls ${info.drawCalls}`);
    lines.push(`  triangles ${info.triangles.toLocaleString()}`);
    lines.push(`  geoms ${info.geometries}  tex ${info.textures}  prog ${info.programs}`);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (mem) {
      lines.push(`  JS heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB`);
    }
    if (info.extra) for (const line of info.extra) lines.push(line);
    this.root.textContent = lines.join("\n");
  }
}
