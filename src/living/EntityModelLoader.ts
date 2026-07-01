import * as THREE from "three";
import { WildlifeSpecies } from "./LivingWorldTypes";

export interface WildlifeModelPart {
  kind: "ellipsoid" | "box" | "cone" | "cylinder" | "triangle";
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  colorWeight?: number;
  points?: [[number, number, number], [number, number, number], [number, number, number]];
}

export interface WildlifeModelDefinition {
  species: WildlifeSpecies;
  displayName: string;
  license: "ORIGINAL_PROCEDURAL";
  parts: WildlifeModelPart[];
}

const MODEL_DEFINITIONS: Record<WildlifeSpecies, WildlifeModelDefinition> = {
  bird: {
    species: "bird",
    displayName: "Small bird",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0.02, 0], scale: [0.5, 0.24, 0.78] },
      { kind: "ellipsoid", position: [0, 0.05, 0.55], scale: [0.22, 0.18, 0.24] },
      { kind: "cone", position: [0, 0.05, 0.82], scale: [0.11, 0.28, 0.11], rotation: [Math.PI / 2, 0, 0] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[-0.08, 0.02, 0.2], [-1.05, 0.02, -0.32], [-0.08, 0.13, -0.2]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[0.08, 0.02, 0.2], [1.05, 0.02, -0.32], [0.08, 0.13, -0.2]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[-0.18, -0.02, -0.62], [0.18, -0.02, -0.62], [0, 0.08, -1.05]] },
    ],
  },
  butterfly: {
    species: "butterfly",
    displayName: "Butterfly",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0, 0], scale: [0.08, 0.06, 0.46] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[-0.02, 0, 0.16], [-0.78, 0.04, 0.46], [-0.5, 0.03, -0.3]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[0.02, 0, 0.16], [0.78, 0.04, 0.46], [0.5, 0.03, -0.3]] },
    ],
  },
  dragonfly: {
    species: "dragonfly",
    displayName: "Dragonfly",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0, 0], scale: [0.07, 0.055, 0.9] },
      { kind: "ellipsoid", position: [0, 0.01, 0.62], scale: [0.16, 0.11, 0.18] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[-0.02, 0, 0.25], [-0.72, 0.02, 0.44], [-0.12, 0.025, 0.06]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[0.02, 0, 0.25], [0.72, 0.02, 0.44], [0.12, 0.025, 0.06]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[-0.02, 0, -0.08], [-0.66, 0.02, -0.28], [-0.12, 0.025, -0.32]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[0.02, 0, -0.08], [0.66, 0.02, -0.28], [0.12, 0.025, -0.32]] },
    ],
  },
  firefly: {
    species: "firefly",
    displayName: "Firefly",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0, -0.08], scale: [0.16, 0.12, 0.32] },
      { kind: "ellipsoid", position: [0, 0, 0.2], scale: [0.12, 0.09, 0.18] },
    ],
  },
  rabbit: {
    species: "rabbit",
    displayName: "Rabbit",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0.18, 0], scale: [0.42, 0.3, 0.66] },
      { kind: "ellipsoid", position: [0, 0.34, 0.46], scale: [0.25, 0.24, 0.28] },
      { kind: "ellipsoid", position: [-0.11, 0.72, 0.46], scale: [0.07, 0.42, 0.08] },
      { kind: "ellipsoid", position: [0.11, 0.72, 0.46], scale: [0.07, 0.42, 0.08] },
      { kind: "ellipsoid", position: [-0.18, 0.05, -0.18], scale: [0.12, 0.08, 0.38] },
      { kind: "ellipsoid", position: [0.18, 0.05, -0.18], scale: [0.12, 0.08, 0.38] },
      { kind: "ellipsoid", position: [0, 0.23, -0.58], scale: [0.16, 0.14, 0.12] },
    ],
  },
  deer: {
    species: "deer",
    displayName: "Deer",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0.72, 0], scale: [0.52, 0.48, 1.05] },
      { kind: "ellipsoid", position: [0, 1.18, 0.72], scale: [0.2, 0.42, 0.32], rotation: [-0.35, 0, 0] },
      { kind: "ellipsoid", position: [0, 1.42, 0.98], scale: [0.24, 0.2, 0.34] },
      { kind: "cylinder", position: [-0.28, 0.28, 0.56], scale: [0.08, 0.58, 0.08] },
      { kind: "cylinder", position: [0.28, 0.28, 0.56], scale: [0.08, 0.58, 0.08] },
      { kind: "cylinder", position: [-0.28, 0.28, -0.52], scale: [0.08, 0.58, 0.08] },
      { kind: "cylinder", position: [0.28, 0.28, -0.52], scale: [0.08, 0.58, 0.08] },
      { kind: "cylinder", position: [-0.16, 1.66, 1.03], scale: [0.025, 0.36, 0.025], rotation: [0.42, 0.1, -0.36] },
      { kind: "cylinder", position: [0.16, 1.66, 1.03], scale: [0.025, 0.36, 0.025], rotation: [0.42, -0.1, 0.36] },
    ],
  },
  fish: {
    species: "fish",
    displayName: "Fish",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0, 0], scale: [0.3, 0.16, 0.82] },
      { kind: "cone", position: [0, 0, 0.66], scale: [0.1, 0.28, 0.1], rotation: [Math.PI / 2, 0, 0] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[0, 0.02, -0.7], [-0.36, 0.02, -1.08], [0, 0.18, -0.95]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[0, 0.02, -0.7], [0.36, 0.02, -1.08], [0, 0.18, -0.95]] },
    ],
  },
  frog: {
    species: "frog",
    displayName: "Frog",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0.12, -0.02], scale: [0.38, 0.22, 0.46] },
      { kind: "ellipsoid", position: [0, 0.22, 0.34], scale: [0.32, 0.2, 0.26] },
      { kind: "ellipsoid", position: [-0.16, 0.34, 0.42], scale: [0.08, 0.08, 0.08] },
      { kind: "ellipsoid", position: [0.16, 0.34, 0.42], scale: [0.08, 0.08, 0.08] },
      { kind: "ellipsoid", position: [-0.32, 0.04, -0.22], scale: [0.26, 0.06, 0.18] },
      { kind: "ellipsoid", position: [0.32, 0.04, -0.22], scale: [0.26, 0.06, 0.18] },
    ],
  },
  bat: {
    species: "bat",
    displayName: "Bat",
    license: "ORIGINAL_PROCEDURAL",
    parts: [
      { kind: "ellipsoid", position: [0, 0, 0.02], scale: [0.2, 0.13, 0.3] },
      { kind: "ellipsoid", position: [0, 0.08, 0.26], scale: [0.13, 0.1, 0.14] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[-0.08, 0.02, 0.12], [-1.12, -0.02, -0.28], [-0.2, -0.05, -0.42]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[0.08, 0.02, 0.12], [1.12, -0.02, -0.28], [0.2, -0.05, -0.42]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[-0.07, 0.16, 0.35], [-0.2, 0.42, 0.32], [-0.02, 0.2, 0.3]] },
      { kind: "triangle", position: [0, 0, 0], scale: [1, 1, 1], points: [[0.07, 0.16, 0.35], [0.2, 0.42, 0.32], [0.02, 0.2, 0.3]] },
    ],
  },
};

export class EntityModelLoader {
  definitionFor(species: WildlifeSpecies): WildlifeModelDefinition {
    return MODEL_DEFINITIONS[species];
  }
}

export function geometryFromDefinition(definition: WildlifeModelDefinition): THREE.BufferGeometry {
  const geometries = definition.parts.map((part) => geometryForPart(part));
  return mergeGeometries(geometries);
}

function geometryForPart(part: WildlifeModelPart): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  switch (part.kind) {
    case "box":
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
    case "cone":
      geometry = new THREE.ConeGeometry(1, 1, 10);
      break;
    case "cylinder":
      geometry = new THREE.CylinderGeometry(1, 1, 1, 8);
      break;
    case "triangle":
      geometry = triangleGeometry(part.points ?? [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
      break;
    case "ellipsoid":
    default:
      geometry = new THREE.SphereGeometry(1, 10, 8);
      break;
  }
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Euler(...(part.rotation ?? [0, 0, 0]));
  matrix.compose(
    new THREE.Vector3(...part.position),
    new THREE.Quaternion().setFromEuler(rotation),
    new THREE.Vector3(...part.scale),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

function triangleGeometry(points: [[number, number, number], [number, number, number], [number, number, number]]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(points.flat());
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const source of geometries) {
    const geometry = source.index ? source.toNonIndexed() : source;
    const pos = geometry.getAttribute("position");
    const norm = geometry.getAttribute("normal");
    for (let i = 0; i < pos.count; i += 1) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (norm) {
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      } else {
        normals.push(0, 1, 0);
      }
      indices.push(offset + i);
    }
    offset += pos.count;
    if (geometry !== source) geometry.dispose();
    source.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  return merged;
}
