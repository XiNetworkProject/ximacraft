import { WeatherChunkData } from "./WeatherChunkData";

export interface SurfaceWeatherSaveData {
  version: 1;
  chunks: WeatherChunkData[];
}
