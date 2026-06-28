/**
 * Grille météo : pavage infini et paresseux du monde en cellules de CELL_SIZE.
 *
 * Les cellules sont créées à la demande (quand un événement les touche ou
 * qu'on les interroge), jamais à l'avance — le monde voxel est infini, on ne
 * peut pas tout pré-allouer. Le climat de fond de chaque cellule est fourni par
 * un `baselineProvider` (point d'extension futur pour les biomes).
 */

import { WeatherCell } from "./WeatherCell";
import { CellBaseline, CELL_SIZE, DEFAULT_BASELINE } from "./WeatherTypes";
import { cellNoise } from "./WeatherMath";

/** Fournit le climat de fond d'une cellule à partir de ses indices. */
export type BaselineProvider = (cellX: number, cellZ: number) => CellBaseline;

/** Baseline par défaut : tempéré + légère variation déterministe par cellule. */
export function defaultBaselineProvider(cellX: number, cellZ: number): CellBaseline {
  const n = cellNoise(cellX, cellZ, 1337);
  const m = cellNoise(cellX, cellZ, 7331);
  return {
    ...DEFAULT_BASELINE,
    temperature: DEFAULT_BASELINE.temperature + (n - 0.5) * 6, // ±3 °C
    humidity: DEFAULT_BASELINE.humidity + (m - 0.5) * 0.2, // ±0.1
    cloudCover: DEFAULT_BASELINE.cloudCover + (n - 0.5) * 0.1,
  };
}

export class WeatherGrid {
  private readonly cells = new Map<string, WeatherCell>();

  constructor(private readonly baselineProvider: BaselineProvider = defaultBaselineProvider) {}

  /** Indice de cellule pour une coordonnée monde (sur un axe). */
  static toCellCoord(world: number): number {
    return Math.floor(world / CELL_SIZE);
  }

  private static key(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`;
  }

  /** Nombre de cellules actuellement instanciées (debug/perf). */
  get size(): number {
    return this.cells.size;
  }

  clear(): void {
    this.cells.clear();
  }

  clone(): WeatherGrid {
    const copy = new WeatherGrid(this.baselineProvider);
    this.cells.forEach((cell) => {
      copy.cells.set(WeatherGrid.key(cell.cellX, cell.cellZ), cell.clone());
    });
    return copy;
  }

  /** Récupère (ou crée) la cellule contenant la coordonnée monde donnée. */
  getCell(worldX: number, worldZ: number): WeatherCell {
    return this.ensureCell(WeatherGrid.toCellCoord(worldX), WeatherGrid.toCellCoord(worldZ));
  }

  /** Récupère (ou crée) une cellule par ses indices. */
  ensureCell(cellX: number, cellZ: number): WeatherCell {
    const key = WeatherGrid.key(cellX, cellZ);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new WeatherCell(cellX, cellZ, this.baselineProvider(cellX, cellZ));
      this.cells.set(key, cell);
    }
    return cell;
  }

  /** Cellule déjà existante (sans création), ou undefined. */
  peekCell(worldX: number, worldZ: number): WeatherCell | undefined {
    return this.cells.get(
      WeatherGrid.key(WeatherGrid.toCellCoord(worldX), WeatherGrid.toCellCoord(worldZ)),
    );
  }

  /**
   * Toutes les cellules dont le centre est dans un rayon (en blocs) autour d'un
   * point monde. Crée les cellules manquantes par défaut (les événements ont
   * besoin d'agir sur des cellules même "vierges").
   */
  getCellsInRadius(worldX: number, worldZ: number, radius: number, createMissing = true): WeatherCell[] {
    const result: WeatherCell[] = [];
    const minCX = WeatherGrid.toCellCoord(worldX - radius);
    const maxCX = WeatherGrid.toCellCoord(worldX + radius);
    const minCZ = WeatherGrid.toCellCoord(worldZ - radius);
    const maxCZ = WeatherGrid.toCellCoord(worldZ + radius);

    for (let cx = minCX; cx <= maxCX; cx += 1) {
      for (let cz = minCZ; cz <= maxCZ; cz += 1) {
        const key = WeatherGrid.key(cx, cz);
        let cell = this.cells.get(key);
        if (!cell) {
          if (!createMissing) continue;
          cell = this.ensureCell(cx, cz);
        }
        const dx = cell.centerX - worldX;
        const dz = cell.centerZ - worldZ;
        if (dx * dx + dz * dz <= radius * radius) {
          result.push(cell);
        }
      }
    }
    return result;
  }

  /** Itère sur toutes les cellules instanciées. */
  forEach(callback: (cell: WeatherCell) => void): void {
    this.cells.forEach(callback);
  }

  /** Avance toutes les cellules d'un pas (relaxation + dérivations). */
  update(dt: number): void {
    this.cells.forEach((cell) => cell.update(dt));
  }
}
