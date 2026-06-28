import { worldToChunk } from "../../utils/MathUtils";
import { SurfaceWeatherSaveData } from "../persistence/SurfaceWeatherSaveData";
import { WeatherChunkColumnData, WeatherChunkData } from "../persistence/WeatherChunkData";

/**
 * État météo du SOL, persistant par colonne (x,z).
 *
 * C'est ce qui fait que la neige "tient", que la grêle blanchit puis fond, que
 * le sol reste mouillé : chaque colonne mémorise ses profondeurs de neige/grêle,
 * son humidité et sa glace. La hauteur de surface est mise en cache (lookup
 * heightmap, pas de parcours de colonne par frame).
 *
 * Borné en mémoire : seules les colonnes proches du joueur sont simulées et
 * conservées (cf. prune). La persistance par chunk dans la sauvegarde est une
 * étape ultérieure (voir feuille de route).
 */

export interface SurfaceColumn {
  x: number;
  z: number;
  /** Y du bloc de surface (haut), mis en cache à la création. */
  surfaceY: number;
  /** Épaisseur de neige 0..~1.5 (en "couches" visuelles). */
  snowDepth: number;
  /** Épaisseur de grêle 0..~0.8 (temporaire, fond en eau). */
  hailDepth: number;
  /** Humidité de surface 0..1 (mouillé → flaques → séchage). */
  wetness: number;
  /** Glace de surface 0..1 (pluie verglaçante / regel). */
  iceDepth: number;
  /** Temps sim du dernier contact (pour le prune). */
  lastTouched: number;
}

export type HeightFn = (x: number, z: number) => number;

export class SurfaceWeatherState {
  private readonly columns = new Map<string, SurfaceColumn>();

  constructor(private readonly heightFn: HeightFn) {}

  get size(): number {
    return this.columns.size;
  }

  private static key(x: number, z: number): string {
    return `${x | 0},${z | 0}`;
  }

  get(x: number, z: number): SurfaceColumn | undefined {
    return this.columns.get(SurfaceWeatherState.key(x | 0, z | 0));
  }

  /** Récupère (ou crée) la colonne ; met en cache la hauteur de surface. */
  ensure(x: number, z: number, now: number): SurfaceColumn {
    const ix = x | 0;
    const iz = z | 0;
    const key = SurfaceWeatherState.key(ix, iz);
    let col = this.columns.get(key);
    if (!col) {
      col = {
        x: ix,
        z: iz,
        surfaceY: this.heightFn(ix, iz),
        snowDepth: 0,
        hailDepth: 0,
        wetness: 0,
        iceDepth: 0,
        lastTouched: now,
      };
      this.columns.set(key, col);
    }
    return col;
  }

  forEach(callback: (col: SurfaceColumn) => void): void {
    this.columns.forEach(callback);
  }

  clear(): void {
    this.columns.clear();
  }

  serialize(): SurfaceWeatherSaveData {
    const chunks = new Map<string, WeatherChunkData>();
    this.columns.forEach((col) => {
      const chunkX = worldToChunk(col.x);
      const chunkZ = worldToChunk(col.z);
      const key = `${chunkX},${chunkZ}`;
      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = { chunkX, chunkZ, columns: [] };
        chunks.set(key, chunk);
      }
      chunk.columns.push({
        x: col.x,
        z: col.z,
        surfaceY: col.surfaceY,
        groundWetness: col.wetness,
        puddleAmount: Math.max(0, col.wetness - 0.72),
        snowDepth: col.snowDepth,
        hailDepth: col.hailDepth,
        iceAmount: col.iceDepth,
        lastPrecipitationTime: col.lastTouched,
        surfaceTemperature: 0,
      });
    });
    return { version: 1, chunks: [...chunks.values()] };
  }

  restore(data?: SurfaceWeatherSaveData): void {
    this.columns.clear();
    if (!data) return;
    for (const chunk of data.chunks) {
      for (const saved of chunk.columns) {
        const col = this.fromSave(saved);
        this.columns.set(SurfaceWeatherState.key(col.x, col.z), col);
      }
    }
  }

  /** Retire les colonnes lointaines ET vides (rien à mémoriser). */
  prune(centerX: number, centerZ: number, radius: number): void {
    const r2 = radius * radius;
    for (const [key, col] of this.columns) {
      const dx = col.x - centerX;
      const dz = col.z - centerZ;
      const empty = col.snowDepth <= 0 && col.hailDepth <= 0 && col.wetness <= 0.001 && col.iceDepth <= 0;
      if (dx * dx + dz * dz > r2 && empty) {
        this.columns.delete(key);
      }
    }
  }

  /** Total de neige au sol (debug). */
  totalSnow(): number {
    let s = 0;
    this.columns.forEach((c) => (s += c.snowDepth));
    return s;
  }

  private fromSave(saved: WeatherChunkColumnData): SurfaceColumn {
    return {
      x: saved.x,
      z: saved.z,
      surfaceY: saved.surfaceY,
      snowDepth: saved.snowDepth,
      hailDepth: saved.hailDepth,
      wetness: saved.groundWetness,
      iceDepth: saved.iceAmount,
      lastTouched: saved.lastPrecipitationTime,
    };
  }
}
