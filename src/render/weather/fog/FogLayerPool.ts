import * as THREE from "three";
import type { FogVolumeLayer } from "./FogDensitySampler";

export class FogLayerPool {
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.IcosahedronGeometry(1, 3);
  private readonly pool: THREE.Mesh[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "FogVolumeRenderer";
    this.scene.add(this.group);
  }

  setLayers(layers: FogVolumeLayer[], time: number): void {
    this.ensure(layers.length);
    for (let i = 0; i < this.pool.length; i += 1) {
      const mesh = this.pool[i];
      const layer = layers[i];
      if (!layer) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(layer.x, layer.y, layer.z);
      mesh.scale.set(layer.scaleX, layer.scaleY, layer.scaleZ);
      mesh.rotation.set(0, layer.rotationY, 0);
      mesh.renderOrder = -6 + i * 0.001;
      const material = mesh.material as THREE.ShaderMaterial;
      material.uniforms.uTime.value = time;
      material.uniforms.uOpacity.value = layer.opacity;
      material.uniforms.uSeed.value = layer.seed;
      (material.uniforms.uColor.value as THREE.Color).setHex(layer.color);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.geometry.dispose();
    for (const mesh of this.pool) {
      (mesh.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
  }

  private ensure(count: number): void {
    while (this.pool.length < count) {
      const mesh = new THREE.Mesh(this.geometry, createFogMaterial());
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = true;
      this.pool.push(mesh);
      this.group.add(mesh);
    }
  }
}

function createFogMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uSeed: { value: 0 },
      uColor: { value: new THREE.Color(0xdce5ec) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorld;

      void main() {
        vLocal = position;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorld = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uSeed;
      uniform vec3 uColor;
      varying vec3 vLocal;
      varying vec3 vWorld;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = hash(i + vec3(0.0, 0.0, 0.0));
        float n100 = hash(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash(i + vec3(1.0, 1.0, 1.0));
        float x00 = mix(n000, n100, f.x);
        float x10 = mix(n010, n110, f.x);
        float x01 = mix(n001, n101, f.x);
        float x11 = mix(n011, n111, f.x);
        return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
      }

      float fbm(vec3 p) {
        float value = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 4; i++) {
          value += noise(p) * amp;
          p *= 2.03;
          amp *= 0.52;
        }
        return value;
      }

      void main() {
        vec3 local = vLocal;
        float radial = length(local.xz);
        float shell = 1.0 - smoothstep(0.42, 1.05, radial);
        float vertical = smoothstep(-0.98, -0.28, local.y) * (1.0 - smoothstep(0.18, 0.98, local.y));
        float breakup = fbm(vWorld * 0.018 + vec3(uSeed * 13.7 + uTime * 0.015, uSeed * 4.1, -uTime * 0.011));
        float streaks = fbm(vec3(vWorld.xz * 0.035, vWorld.y * 0.09 + uSeed * 9.0));
        float alpha = uOpacity * shell * vertical * (0.28 + breakup * 0.82) * smoothstep(0.12, 0.88, streaks);
        if (alpha < 0.01) discard;
        vec3 color = mix(uColor * 0.78, vec3(1.0), clamp(breakup * 0.42, 0.0, 0.55));
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}
