# BlockWorld Local

BlockWorld Local is a local-only voxel sandbox engine built with Vite, TypeScript and Three.js. It is inspired by familiar block sandbox mechanics, but the code is original and no proprietary assets are committed to the project.

## Install

```powershell
npm install
npm run dev
```

Open the local Vite URL, normally:

```text
http://127.0.0.1:5173/
```

## Local Visual And Sound Packs

The game currently looks for high-resolution block textures in:

```text
public/resourcepacks/lbpr/assets/minecraft/textures/block/
```

The current local setup also includes Dynamic Surroundings weather audio:

```text
public/soundpacks/dynamic-surroundings/assets/minecraft/sounds/ambient/weather/
```

Photon is extracted for reference under:

```text
public/shaderpacks/photon/
```

Photon is a Minecraft shaderpack, so its GLSL files are not directly loaded into the Three.js terrain renderer yet. The active integration uses LBPR color textures and Dynamic Surroundings weather sounds.

The texture loader automatically tries these locations:

```text
/resourcepacks/lbpr/assets/minecraft/textures/block/
/resourcepacks/lbpr/LBPR Reload! v.6.5 for mc1.21.5/assets/minecraft/textures/block/
/resourcepack/assets/minecraft/textures/block/
/resourcepack/FaithfulPBR_256_1.1p/assets/minecraft/textures/block/
/resourcepack/FaithfulPBR/assets/minecraft/textures/block/
```

If a texture is missing, the loader logs a warning, tries aliases, then generates a canvas fallback so the world still loads.

## Controls

- Click: lock pointer
- Escape: pause or release pointer
- WASD, ZQSD or arrow keys: move
- Mouse: look
- Space: jump
- Shift: sprint
- Left click: break targeted block
- Right click: place selected block or open crafting/furnace block
- 1-9: select hotbar slot
- Mouse wheel: cycle hotbar
- E: inventory and crafting
- F3: debug overlay
- F4: creative/survival toggle
- F: creative flight
- R: rebuild loaded chunks
- `/` or T: command console
- Escape, Enter after a command, or X: close command console

## Commands

Weather:

```text
/weather clear
/weather rain 300
/weather storm 120
/weather thunderstorm
/weather snow
/weather blizzard
/weather hail
/weather fog
/weather rainbow
/weather rain intensity 0.8
/weather snow intensity 1
/weather hail intensity 1
/weather thunderstorm intensity 1
```

Time and sky:

```text
/time set day
/time set night
/time set 6000
/time add 1000
/time speed 20
/sky clouds 0.7
/sky wind 0.5
/sky fog 0.4
/sky moonphase full
```

World/player:

```text
/gamemode creative
/gamemode survival
/tp 0 80 0
/seed
/save
/load
/debug fps
```

## Implemented Features

- Vite + TypeScript + Three.js local web app
- Chunked voxel world with `Uint16Array` storage
- Procedural deterministic terrain from seed
- Plains, forest, desert, hills, mountains, beach and snow-like altitude biome behavior
- Bedrock, surface layers, sand beaches, water up to sea level
- Caves, ores and oak trees
- Chunk meshing with visible faces only, not one mesh per block
- Opaque and transparent chunk meshes
- Texture atlas from local resource-pack PNG files
- Alias and generated fallback texture system
- Expanded 256x texture palette with stone variants, decorative blocks, woods, metals, ice, wool colors and generated underground rock variants
- First-person player controller with gravity, jumping, sprinting, creative flight and AABB collisions
- Voxel raycast with targeted block outline
- Break/place blocks
- Creative and simplified survival modes
- Hotbar, inventory, basic crafting and minimal smelting action
- Item drops in survival
- Dynamic sky dome, sun, moon, stars, volumetric cloud puffs, distant storm anvils and fog
- Weather states with rain, storm, thunderstorm, snow, blizzard, hail, fog, mist and rainbow
- Moving local weather cells that can pass nearby, arrive over the player, or clear out
- Rain splashes, snow puffs, hail impacts, air motes, lightning bolts and thunder audio
- Snow accumulation decals are placed where snow particles touch the ground
- In-game command console with history
- Local save/load using IndexedDB with localStorage fallback
- Saves seed, player state, inventory, time, weather and block modifications only

## Current Limits

- Normal/specular PBR maps and Photon shader files are present locally but not yet used in the terrain renderer.
- Lighting is global/day-night plus emissive-looking materials; full block light propagation is not implemented yet.
- Water is a transparent block, not a flowing simulation.
- Crafting uses practical recipe buttons instead of a full drag-and-drop 2x2/3x3 grid.
- Furnace behavior is minimal and exposed through inventory action rather than a full furnace UI.
- Mobs are scaffolded, but passive/hostile behavior is not implemented yet.
- The production build warns that the main bundle is larger than 500 kB because Three.js is bundled locally.

## Project Structure

```text
src/
  assets/      Resource pack loader, aliases, atlas and texture manager
  entities/    Base entities and item drops
  game/        Main loop, renderer, input, camera, settings and time
  items/       Item registry, crafting and smelting
  player/      Player state, controller physics, inventory and game mode
  ui/          HUD, hotbar, inventory, menus and debug overlay
  utils/       Constants, math, noise, events and IndexedDB helper
  world/       Blocks, chunks, terrain, biomes, weather, sky, save and commands
```

## Validation

Verified locally:

```powershell
npm install
npm run build
npm run dev -- --port 5173
```

The browser test loaded the menu, started a world, generated chunks, loaded the supplied LBPR color textures, and exercised weather commands such as `/weather rain intensity 0.8` and `/weather thunderstorm intensity 1`.
