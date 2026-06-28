export type WildlifeSpecies =
  | "bird"
  | "butterfly"
  | "dragonfly"
  | "firefly"
  | "rabbit"
  | "deer"
  | "fish"
  | "frog"
  | "bat";

export type WildlifeMode = "idle" | "wander" | "flee" | "hide" | "swim" | "fly";

export interface LivingWorldDebugState {
  enabled: boolean;
  activeAnimals: number;
  visibleAnimals: number;
  species: Record<WildlifeSpecies, number>;
  ambience: string;
}
