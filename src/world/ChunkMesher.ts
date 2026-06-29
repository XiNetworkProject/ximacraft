import * as THREE from "three";
import { TextureAtlas } from "../assets/TextureAtlas";
import { CHUNK_SIZE } from "../utils/Constants";
import { worldToChunk } from "../utils/MathUtils";
import { BlockRegistry } from "./BlockRegistry";
import { BlockFace, BlockId, isPlant, isSnowLayer, snowLayerLevel } from "./BlockTypes";
import { Chunk } from "./Chunk";
import { World } from "./World";
import { BlockConnectionState, NO_CONNECTIONS } from "./BlockConnections";
import { BlockGeometryBuilder, GeometryBox } from "./BlockGeometryBuilder";
import { BlockShape, isConnectedShape } from "./blockstate/BlockShape";

type FaceBuild = {
  name: BlockFace;
  dir: [number, number, number];
  normal: [number, number, number];
  corners: [number, number, number][];
};

const FACES: FaceBuild[] = [
  { name: "top", dir: [0, 1, 0], normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { name: "bottom", dir: [0, -1, 0], normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { name: "north", dir: [0, 0, -1], normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { name: "south", dir: [0, 0, 1], normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { name: "east", dir: [1, 0, 0], normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { name: "west", dir: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
];

// Luminosité par niveau d'occlusion ambiante voxel (0 = coin le plus encaissé,
// 3 = aucun voisin occultant). C'est l'effet « coins sombres » à la Minecraft
// qui donne du relief au terrain. Multiplié dans la vertex color de chaque coin.
const AO_BRIGHTNESS = [0.88, 0.94, 0.98, 1.0];

type MeshBuffers = {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  windWeights: number[];
  waterDepths: number[];
  indices: number[];
};

export type ChunkMeshResult = {
  opaque: THREE.BufferGeometry | null;
  transparent: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
  triangles: number;
};

export class ChunkMesher {
  constructor(
    private readonly world: World,
    private readonly blockRegistry: BlockRegistry,
    private readonly atlas: TextureAtlas,
  ) {}

  build(chunk: Chunk): ChunkMeshResult {
    const opaque = this.createBuffers();
    const transparent = this.createBuffers();
    const water = this.createBuffers();
    const originX = chunk.cx * CHUNK_SIZE;
    const originZ = chunk.cz * CHUNK_SIZE;

    for (let y = 0; y < 128; y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const blockId = chunk.getLocal(x, y, z);
          if (blockId === BlockId.AIR) {
            continue;
          }
          const block = this.blockRegistry.get(blockId);
          const target = block.liquid ? water : block.transparent ? transparent : opaque;

          if (block.renderStyle === "cross") {
            const textureName = this.blockRegistry.getTextureForFace(blockId, "north");
            this.pushCrossPlant(target, originX + x, y, originZ + z, textureName, blockId);
            continue;
          }

          const shape = this.shapeFor(block);
          const connections = isConnectedShape(shape) ? this.connectionStateFor(originX + x, y, originZ + z, shape) : NO_CONNECTIONS;
          const boxes = BlockGeometryBuilder.boxesFor(shape, connections, block.renderHeight ?? 1);
          for (const box of boxes) {
            for (const face of FACES) {
              if (!this.shouldRenderBoxFace(originX + x, y, originZ + z, box, face, blockId, !!(block.transparent || block.liquid))) {
                continue;
              }
              const textureName = this.blockRegistry.getTextureForFace(blockId, face.name);
              this.pushBoxFace(target, originX + x, y, originZ + z, box, face, textureName, blockId);
            }
          }
          continue;

          for (const face of FACES) {
            const nx = originX + x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = originZ + z + face.dir[2];
            if (blockId === BlockId.WATER && face.name !== "top" && !this.world.getChunk(worldToChunk(nx), worldToChunk(nz))) {
              continue;
            }
            const neighborId = this.world.getBlock(nx, ny, nz);
            const neighbor = this.blockRegistry.get(neighborId);

            if (!this.shouldRenderFace(blockId, neighborId, face.name, !!(block.transparent || block.liquid), !!(neighbor.transparent || neighbor.liquid))) {
              continue;
            }

            const textureName = this.blockRegistry.getTextureForFace(blockId, face.name);
            this.pushFace(target, originX + x, y, originZ + z, face, textureName, blockId, block.renderHeight ?? 1);
          }
        }
      }
    }

    const opaqueGeometry = this.toGeometry(opaque);
    const transparentGeometry = this.toGeometry(transparent);
    const waterGeometry = this.toGeometry(water);
    return {
      opaque: opaqueGeometry,
      transparent: transparentGeometry,
      water: waterGeometry,
      triangles: opaque.indices.length / 3 + transparent.indices.length / 3 + water.indices.length / 3,
    };
  }

  private createBuffers(): MeshBuffers {
    return { positions: [], normals: [], uvs: [], colors: [], windWeights: [], waterDepths: [], indices: [] };
  }

  private shouldRenderFace(
    blockId: BlockId,
    neighborId: BlockId,
    face: BlockFace,
    currentTransparent: boolean,
    neighborTransparent: boolean,
  ): boolean {
    if (isSnowLayer(blockId) && isSnowLayer(neighborId) && face !== "top" && face !== "bottom") {
      return snowLayerLevel(blockId) > snowLayerLevel(neighborId);
    }
    if (neighborId === BlockId.AIR) {
      return true;
    }
    if (blockId === BlockId.WATER && neighborId === BlockId.WATER) {
      return false;
    }
    if (currentTransparent && neighborId === blockId) {
      return false;
    }
    return neighborTransparent || !this.blockRegistry.isOpaque(neighborId);
  }

  private shouldRenderBoxFace(
    x: number,
    y: number,
    z: number,
    box: GeometryBox,
    face: FaceBuild,
    blockId: BlockId,
    currentTransparent: boolean,
  ): boolean {
    const boundary = this.isBoxBoundaryFace(box, face.name);
    if (!boundary) return true;
    const nx = x + face.dir[0];
    const ny = y + face.dir[1];
    const nz = z + face.dir[2];
    if (blockId === BlockId.WATER && face.name !== "top" && !this.world.getChunk(worldToChunk(nx), worldToChunk(nz))) {
      return false;
    }
    const neighborId = this.world.getBlock(nx, ny, nz);
    const neighbor = this.blockRegistry.get(neighborId);
    return this.shouldRenderFace(blockId, neighborId, face.name, currentTransparent, !!(neighbor.transparent || neighbor.liquid));
  }

  private isBoxBoundaryFace(box: GeometryBox, face: BlockFace): boolean {
    switch (face) {
      case "top":
        return box.maxY >= 0.999;
      case "bottom":
        return box.minY <= 0.001;
      case "north":
        return box.minZ <= 0.001;
      case "south":
        return box.maxZ >= 0.999;
      case "east":
        return box.maxX >= 0.999;
      case "west":
        return box.minX <= 0.001;
    }
  }

  private shapeFor(block: ReturnType<BlockRegistry["get"]>): BlockShape {
    if (block.shape) return block.shape;
    if (block.renderHeight !== undefined) return "cube";
    return "cube";
  }

  private connectionStateFor(x: number, y: number, z: number, shape: BlockShape): BlockConnectionState {
    return {
      north: this.connectsTo(x, y, z - 1, shape),
      south: this.connectsTo(x, y, z + 1, shape),
      east: this.connectsTo(x + 1, y, z, shape),
      west: this.connectsTo(x - 1, y, z, shape),
    };
  }

  private connectsTo(x: number, y: number, z: number, shape: BlockShape): boolean {
    const neighborId = this.world.getBlock(x, y, z);
    if (neighborId === BlockId.AIR || neighborId === BlockId.WATER) return false;
    const neighbor = this.blockRegistry.get(neighborId);
    if (shape === "pane") return neighbor.shape === "pane" || this.blockRegistry.isOpaque(neighborId);
    if (shape === "fence") return neighbor.shape === "fence" || neighbor.shape === "wall" || this.blockRegistry.isOpaque(neighborId);
    if (shape === "wall") return neighbor.shape === "wall" || neighbor.shape === "fence" || this.blockRegistry.isOpaque(neighborId);
    return false;
  }

  private pushBoxFace(
    buffers: MeshBuffers,
    x: number,
    y: number,
    z: number,
    box: GeometryBox,
    face: FaceBuild,
    textureName: string,
    blockId: BlockId,
  ): void {
    const baseIndex = buffers.positions.length / 3;
    const uv = this.atlas.getUv(textureName);
    const color = this.faceColor(blockId, face.name, x, y, z);
    const liquid = blockId === BlockId.WATER;
    const depth = liquid ? this.waterDepthAt(x, y, z) : 0;
    const windWeight = this.blockWindWeight(blockId);

    const ao = [1, 1, 1, 1];
    if (!liquid) {
      for (let i = 0; i < 4; i += 1) {
        const corner = face.corners[i];
        ao[i] = AO_BRIGHTNESS[this.cornerAO(face.normal, corner, x, y, z)];
      }
    }

    for (let i = 0; i < 4; i += 1) {
      const corner = face.corners[i];
      buffers.positions.push(
        x + (corner[0] === 1 ? box.maxX : box.minX),
        y + (corner[1] === 1 ? box.maxY : box.minY),
        z + (corner[2] === 1 ? box.maxZ : box.minZ),
      );
      buffers.normals.push(face.normal[0], face.normal[1], face.normal[2]);
      const a = ao[i];
      buffers.colors.push(color.r * a, color.g * a, color.b * a);
      buffers.windWeights.push(windWeight);
      buffers.waterDepths.push(depth);
    }

    buffers.uvs.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      buffers.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
    } else {
      buffers.indices.push(baseIndex + 1, baseIndex + 2, baseIndex + 3, baseIndex + 1, baseIndex + 3, baseIndex);
    }
  }

  private pushFace(
    buffers: MeshBuffers,
    x: number,
    y: number,
    z: number,
    face: FaceBuild,
    textureName: string,
    blockId: BlockId,
    renderHeight: number,
  ): void {
    const baseIndex = buffers.positions.length / 3;
    const uv = this.atlas.getUv(textureName);
    const color = this.faceColor(blockId, face.name, x, y, z);
    const liquid = blockId === BlockId.WATER;
    const depth = liquid ? this.waterDepthAt(x, y, z) : 0;
    const waterLevel = liquid ? 0.88 : renderHeight;
    const windWeight = this.blockWindWeight(blockId);

    // Occlusion ambiante par coin. L'eau (surface plate translucide) n'en a pas.
    const ao = [1, 1, 1, 1];
    if (!liquid) {
      for (let i = 0; i < 4; i += 1) {
        const corner = face.corners[i];
        ao[i] = AO_BRIGHTNESS[this.cornerAO(face.normal, corner, x, y, z)];
      }
    }

    for (let i = 0; i < 4; i += 1) {
      const corner = face.corners[i];
      const cy = corner[1] === 1 ? waterLevel : corner[1];
      buffers.positions.push(x + corner[0], y + cy, z + corner[2]);
      buffers.normals.push(face.normal[0], face.normal[1], face.normal[2]);
      const a = ao[i];
      buffers.colors.push(color.r * a, color.g * a, color.b * a);
      buffers.windWeights.push(windWeight);
      buffers.waterDepths.push(depth);
    }

    buffers.uvs.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
    // Triangulation choisie selon la diagonale la plus claire : évite les
    // cassures d'AO en escalier sur les quads (anisotropie).
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      buffers.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
    } else {
      buffers.indices.push(baseIndex + 1, baseIndex + 2, baseIndex + 3, baseIndex + 1, baseIndex + 3, baseIndex);
    }
  }

  private pushCrossPlant(
    buffers: MeshBuffers,
    x: number,
    y: number,
    z: number,
    textureName: string,
    blockId: BlockId,
  ): void {
    const uv = this.atlas.getUv(textureName);
    const color = this.plantColor(blockId, x, z);
    const seed = hash2(x * 0.173, z * 0.173);
    const dims = this.plantDimensions(blockId, seed);
    const cx = x + 0.5;
    const cz = z + 0.5;
    const width = dims.width;
    const height = dims.height;
    const planes: Array<{ nx: number; nz: number; corners: [number, number, number, number][] }> = [
      {
        nx: 0.707,
        nz: 0.707,
        corners: [
          [-width, 0, -width, 0],
          [width, 0, width, 1],
          [width, height, width, 2],
          [-width, height, -width, 3],
        ],
      },
      {
        nx: -0.707,
        nz: 0.707,
        corners: [
          [-width, 0, width, 0],
          [width, 0, -width, 1],
          [width, height, -width, 2],
          [-width, height, width, 3],
        ],
      },
    ];

    for (const plane of planes) {
      const baseIndex = buffers.positions.length / 3;
      for (const [ox, oy, oz, cornerIndex] of plane.corners) {
        buffers.positions.push(cx + ox, y + oy, cz + oz);
        buffers.normals.push(plane.nx, 0.12, plane.nz);
        buffers.colors.push(color.r, color.g, color.b);
        buffers.windWeights.push(cornerIndex >= 2 ? dims.wind : dims.wind * 0.22);
        buffers.waterDepths.push(0);
      }
      buffers.uvs.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
      buffers.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
    }
  }

  /**
   * Niveau d'occlusion ambiante (0..3) d'un coin de face. On regarde les deux
   * voisins latéraux et le voisin diagonal dans la couche « devant » la face :
   * plus ils sont pleins, plus le coin est sombre. Algorithme voxel classique.
   */
  private cornerAO(
    normal: [number, number, number],
    corner: [number, number, number],
    blockX: number,
    blockY: number,
    blockZ: number,
  ): number {
    const fx = blockX + normal[0];
    const fy = blockY + normal[1];
    const fz = blockZ + normal[2];
    // Axes tangents = les deux axes différents de la normale (x=0, y=1, z=2).
    let axisU: number;
    let axisV: number;
    if (normal[0] !== 0) {
      axisU = 1;
      axisV = 2;
    } else if (normal[1] !== 0) {
      axisU = 0;
      axisV = 2;
    } else {
      axisU = 0;
      axisV = 1;
    }
    const du = corner[axisU] === 1 ? 1 : -1;
    const dv = corner[axisV] === 1 ? 1 : -1;
    const offU = [0, 0, 0];
    offU[axisU] = du;
    const offV = [0, 0, 0];
    offV[axisV] = dv;
    const side1 = this.occludes(fx + offU[0], fy + offU[1], fz + offU[2]) ? 1 : 0;
    const side2 = this.occludes(fx + offV[0], fy + offV[1], fz + offV[2]) ? 1 : 0;
    if (side1 && side2) {
      return 0;
    }
    const cornerOcc = this.occludes(
      fx + offU[0] + offV[0],
      fy + offU[1] + offV[1],
      fz + offU[2] + offV[2],
    )
      ? 1
      : 0;
    return 3 - (side1 + side2 + cornerOcc);
  }

  private occludes(wx: number, wy: number, wz: number): boolean {
    return this.blockRegistry.isOpaque(this.world.getBlock(wx, wy, wz));
  }

  private toGeometry(buffers: MeshBuffers): THREE.BufferGeometry | null {
    if (buffers.positions.length === 0) {
      return null;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buffers.uvs, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
    geometry.setAttribute("aWindWeight", new THREE.Float32BufferAttribute(buffers.windWeights, 1));
    geometry.setAttribute("aWaterDepth", new THREE.Float32BufferAttribute(buffers.waterDepths, 1));
    geometry.setIndex(buffers.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private faceColor(blockId: BlockId, face: BlockFace, x: number, y: number, z: number): THREE.Color {
    const shade = this.faceShade(face);
    let color: THREE.Color;
    if (blockId === BlockId.GRASS && face === "top") {
      color = this.textureTint(this.grassTint(x, z), 0.9);
      return color.multiplyScalar(shade);
    }
    if (blockId === BlockId.GRASS && face !== "bottom") {
      return this.textureTint(this.grassTint(x, z), 0.42).multiplyScalar(shade);
    }
    if (blockId === BlockId.OAK_LEAVES || blockId === BlockId.DARK_OAK_LEAVES) {
      const tint = this.textureTint(this.foliageTint(x, z, false), 0.88);
      if (isSnowLayer(this.world.getBlock(x, y + 1, z))) tint.lerp(new THREE.Color(0xe3ebee), face === "top" ? 0.78 : 0.42);
      return tint.multiplyScalar(shade);
    }
    if (blockId === BlockId.BIRCH_LEAVES) {
      const tint = this.textureTint(this.foliageTint(x, z, true), 0.78);
      if (isSnowLayer(this.world.getBlock(x, y + 1, z))) tint.lerp(new THREE.Color(0xe5edf0), face === "top" ? 0.78 : 0.42);
      return tint.multiplyScalar(shade);
    }
    if (blockId === BlockId.SPRUCE_LEAVES) {
      const tint = this.textureTint(new THREE.Color(0x3f7a5d), 0.86);
      if (isSnowLayer(this.world.getBlock(x, y + 1, z))) tint.lerp(new THREE.Color(0xdce8e9), face === "top" ? 0.72 : 0.36);
      return tint.multiplyScalar(shade);
    }
    if (blockId === BlockId.WATER) {
      const depth = this.waterDepthAt(x, y, z);
      const shore = this.waterNearShore(x, y, z);
      const shallow = new THREE.Color(0x58d0cb);
      const mid = new THREE.Color(0x1f73a8);
      const deep = new THREE.Color(0x062b55);
      const t = Math.min(1, depth / 12);
      const top = shallow.lerp(mid, Math.min(1, t * 1.45)).lerp(deep, Math.max(0, t - 0.45) * 1.35);
      top.lerp(new THREE.Color(0x8bdcca), shore * 0.22 * (1 - t));
      if (face !== "top") {
        top.multiplyScalar(0.72);
      }
      return top.multiplyScalar(Math.max(shade, 0.82));
    }
    if (isPlant(blockId)) {
      return this.plantColor(blockId, x, z).multiplyScalar(Math.max(shade, 0.9));
    }
    if (blockId === BlockId.SNOW_BLOCK || isSnowLayer(blockId)) {
      return new THREE.Color(face === "top" ? 0xd7dde0 : 0xc1c9cc).multiplyScalar(Math.max(shade, 0.9));
    }
    return new THREE.Color(0xffffff).multiplyScalar(shade);
  }

  private faceShade(face: BlockFace): number {
    // Ombrage de face DOUX : la vraie lumière directionnelle + l'AO font déjà
    // le relief. Un ombrage trop fort (ancienne valeur) écrasait les faces
    // verticales (troncs, côtés) en noir une fois la vraie lumière ajoutée.
    switch (face) {
      case "top":
        return 1;
      case "bottom":
        return 0.84;
      case "east":
        return 0.98;
      case "west":
        return 0.94;
      case "south":
        return 0.96;
      case "north":
      default:
        return 0.95;
    }
  }

  private textureTint(tint: THREE.Color, strength: number): THREE.Color {
    return new THREE.Color(0xffffff).lerp(tint, strength);
  }

  private grassTint(x: number, z: number): THREE.Color {
    const biome = this.world.getBiomeAt(x, z);
    switch (biome.id) {
      case "forest":
      case "young_forest":
      case "old_forest":
      case "birch_forest":
        return new THREE.Color(0x63b84d);
      case "dark_forest":
        return new THREE.Color(0x4f8f3e);
      case "pine_forest":
      case "taiga":
      case "snow_forest":
        return new THREE.Color(0x6fa96a);
      case "flower_meadow":
        return new THREE.Color(0x79c45a);
      case "dry_prairie":
      case "bocage":
        return new THREE.Color(0x88b95e);
      case "marsh":
      case "bog":
      case "riverbank":
        return new THREE.Color(0x5fa85a);
      case "hills":
      case "plateau":
        return new THREE.Color(0x78b85a);
      case "mountains":
      case "alpine_mountain":
      case "cliffs":
        return new THREE.Color(0x8cae6b);
      case "snow":
      case "tundra":
      case "glacial_valley":
      case "high_mountain":
        return new THREE.Color(0xb9cfa6);
      case "desert":
      case "dunes":
      case "rocky_desert":
      case "canyon":
      case "beach":
        return new THREE.Color(0xb9b66b);
      default:
        return new THREE.Color(0x70c850);
    }
  }

  private foliageTint(x: number, z: number, birch: boolean): THREE.Color {
    const biome = this.world.getBiomeAt(x, z);
    if (birch) {
      return new THREE.Color(biome.id === "snow" || biome.id === "snow_forest" || biome.id === "tundra" ? 0xaecb76 : 0x94c95f);
    }
    switch (biome.id) {
      case "forest":
      case "young_forest":
      case "old_forest":
      case "birch_forest":
        return new THREE.Color(0x4fa83f);
      case "snow":
      case "snow_forest":
      case "tundra":
      case "glacial_valley":
        return new THREE.Color(0x789b62);
      case "dark_forest":
        return new THREE.Color(0x2f6e36);
      case "pine_forest":
      case "taiga":
        return new THREE.Color(0x4f8060);
      case "marsh":
      case "bog":
        return new THREE.Color(0x4b8d4c);
      case "hills":
      case "mountains":
      case "plateau":
      case "alpine_mountain":
      case "cliffs":
        return new THREE.Color(0x5f9f48);
      default:
        return new THREE.Color(0x59b143);
    }
  }

  private plantColor(blockId: BlockId, x: number, z: number): THREE.Color {
    if (blockId === BlockId.DANDELION || blockId === BlockId.POPPY || blockId === BlockId.BLUE_FLOWER || blockId === BlockId.WHITE_FLOWER) {
      return new THREE.Color(0xffffff);
    }
    if (blockId === BlockId.LILY_PAD || blockId === BlockId.MOSS_CARPET) {
      return this.textureTint(this.foliageTint(x, z, false), 0.72);
    }
    if (blockId === BlockId.ANIMAL_TRACKS) {
      return new THREE.Color(0x8b7a62);
    }
    const base = blockId === BlockId.FERN || blockId === BlockId.WILD_BUSH
      ? this.foliageTint(x, z, false)
      : this.grassTint(x, z);
    return this.textureTint(base, blockId === BlockId.WILD_BUSH ? 0.74 : 0.82);
  }

  private plantDimensions(blockId: BlockId, seed: number): { width: number; height: number; wind: number } {
    switch (blockId) {
      case BlockId.TALL_GRASS:
        return { width: 0.44 + seed * 0.08, height: 1.05 + seed * 0.34, wind: 1 };
      case BlockId.FERN:
        return { width: 0.45 + seed * 0.08, height: 0.8 + seed * 0.22, wind: 0.82 };
      case BlockId.WILD_BUSH:
        return { width: 0.55 + seed * 0.12, height: 0.68 + seed * 0.2, wind: 0.52 };
      case BlockId.REEDS:
        return { width: 0.42 + seed * 0.08, height: 1.45 + seed * 0.65, wind: 1.08 };
      case BlockId.DANDELION:
      case BlockId.POPPY:
      case BlockId.BLUE_FLOWER:
      case BlockId.WHITE_FLOWER:
        return { width: 0.34 + seed * 0.07, height: 0.62 + seed * 0.2, wind: 0.9 };
      case BlockId.SHORT_GRASS:
      default:
        return { width: 0.36 + seed * 0.08, height: 0.46 + seed * 0.18, wind: 0.76 };
    }
  }

  private blockWindWeight(blockId: BlockId): number {
    if (blockId === BlockId.OAK_LEAVES || blockId === BlockId.BIRCH_LEAVES) return 0.16;
    if (blockId === BlockId.LILY_PAD || blockId === BlockId.MOSS_CARPET || blockId === BlockId.ANIMAL_TRACKS || blockId === BlockId.CAMPFIRE) return 0;
    if (isPlant(blockId)) return 0.85;
    return 0;
  }

  private waterDepthAt(x: number, y: number, z: number): number {
    let depth = 0;
    for (let dy = 0; dy < 14; dy += 1) {
      if (this.world.getBlock(x, y - dy, z) !== BlockId.WATER) break;
      depth += 1;
    }
    return depth;
  }

  private waterNearShore(x: number, y: number, z: number): number {
    let solid = 0;
    const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [ox, oz] of offsets) {
      const side = this.world.getBlock(x + ox, y, z + oz);
      const below = this.world.getBlock(x + ox, y - 1, z + oz);
      if (side !== BlockId.WATER || this.blockRegistry.isOpaque(below)) solid += 1;
    }
    return Math.min(1, solid / 4);
  }
}

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
