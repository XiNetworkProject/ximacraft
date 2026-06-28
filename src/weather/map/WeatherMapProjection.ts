export interface WeatherMapViewport {
  width: number;
  height: number;
  centerX: number;
  centerZ: number;
  scale: number;
}

export class WeatherMapProjection {
  constructor(private readonly viewport: WeatherMapViewport) {}

  worldToScreen(x: number, z: number): { x: number; y: number } {
    return {
      x: this.viewport.width / 2 + (x - this.viewport.centerX) * this.viewport.scale,
      y: this.viewport.height / 2 + (z - this.viewport.centerZ) * this.viewport.scale,
    };
  }

  screenToWorld(x: number, y: number): { x: number; z: number } {
    return {
      x: this.viewport.centerX + (x - this.viewport.width / 2) / this.viewport.scale,
      z: this.viewport.centerZ + (y - this.viewport.height / 2) / this.viewport.scale,
    };
  }
}
