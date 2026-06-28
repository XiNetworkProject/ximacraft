import { SurfaceWeatherSaveData } from "./SurfaceWeatherSaveData";

export interface RegionalWeatherSaveData {
  version: 1;
  time: number;
  wind: { x: number; z: number };
  surface?: SurfaceWeatherSaveData;
}
