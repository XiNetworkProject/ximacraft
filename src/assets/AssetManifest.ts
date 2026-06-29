export type AssetLicense = "original" | "CC0" | "CC-BY" | "MIT" | "local-user-pack";

export interface GameAssetEntry {
  id: string;
  kind: "model" | "texture" | "audio" | "particle" | "shader";
  path: string;
  license: AssetLicense;
  author: string;
  source: string;
  fallback?: string;
}

export const GAME_ASSET_MANIFEST: GameAssetEntry[] = [
  {
    id: "wildlife.procedural_fallbacks",
    kind: "model",
    path: "src/living/LivingWorldSystem.ts",
    license: "original",
    author: "XimaCraft",
    source: "Generated in-engine low-poly instanced wildlife until licensed GLB assets are added.",
  },
  {
    id: "ambience.procedural_layers",
    kind: "audio",
    path: "src/living/AmbientBiomeAudioSystem.ts",
    license: "original",
    author: "XimaCraft",
    source: "Generated WebAudio ambience fallback; replaceable through public/assets/audio/*.",
  },
];

export function assetsByKind(kind: GameAssetEntry["kind"]): GameAssetEntry[] {
  return GAME_ASSET_MANIFEST.filter((asset) => asset.kind === kind);
}
