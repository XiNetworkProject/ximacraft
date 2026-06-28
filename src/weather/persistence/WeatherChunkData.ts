export interface WeatherChunkColumnData {
  x: number;
  z: number;
  surfaceY: number;
  groundWetness: number;
  puddleAmount: number;
  snowDepth: number;
  hailDepth: number;
  iceAmount: number;
  mudAmount?: number;
  lastPrecipitationTime: number;
  surfaceTemperature: number;
}

export interface WeatherChunkData {
  chunkX: number;
  chunkZ: number;
  columns: WeatherChunkColumnData[];
}
