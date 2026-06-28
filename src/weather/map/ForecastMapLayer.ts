import { WeatherMapEvent } from "./WeatherMapData";

export function eventTrackEnd(event: WeatherMapEvent, seconds: number): { x: number; z: number } {
  return {
    x: event.x + event.dirX * event.speed * seconds,
    z: event.z + event.dirZ * event.speed * seconds,
  };
}
