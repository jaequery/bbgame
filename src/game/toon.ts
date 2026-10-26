import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Cel shading: three flat tone bands (shadow / mid / lit).
let gradient: THREE.DataTexture | null = null;

function gradientMap(): THREE.DataTexture {
  if (!gradient) {
    const data = new Uint8Array([90, 170, 255].flatMap((v) => [v, v, v, 255]));
    gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toon(
  color: THREE.ColorRepresentation,
  opts: Omit<THREE.MeshToonMaterialParameters, "color" | "gradientMap"> = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

// Ink outlines: inverted hull pushed out along the normal in clip space, so the
// line stays a constant pixel width from every camera distance.
const outlineUniforms = {
  resolution: { value: new THREE.Vector2(1280, 720) },
};

const outlineMaterials = new Map<string, THREE.ShaderMaterial>();

function outlineMaterial(px: number): THREE.ShaderMaterial {
  const key = px.toFixed(2);
  let mat = outlineMaterials.get(key);
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      uniforms: {
        resolution: outlineUniforms.resolution,
        thickness: { value: px },
        color: { value: new THREE.Color(0x1a1410) },
      },
      vertexShader: /* glsl */ `
        uniform vec2 resolution;
        uniform float thickness;
        void main() {
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vec3 vn = normalize(normalMatrix * normal);
          vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
          float len = length(dir);
          if (len > 1e-5) dir /= len;
          clip.xy += dir * thickness * clip.w * 2.0 / resolution;
          gl_Position = clip;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() { gl_FragColor = vec4(color, 1.0); }
      `,
      side: THREE.BackSide,
    });
    outlineMaterials.set(key, mat);
  }
  return mat;
}

const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function hullGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let hull = hullCache.get(geometry);
  if (!hull) {
    // Smooth normals on welded vertices so hard-edged boxes don't crack open.
    const positionOnly = new THREE.BufferGeometry();
    positionOnly.setAttribute("position", geometry.getAttribute("position"));
    if (geometry.index) positionOnly.setIndex(geometry.index);
    hull = mergeVertices(positionOnly, 1e-4);
    hull.computeVertexNormals();
    hullCache.set(geometry, hull);
  }
  return hull;
}

/** Adds an ink outline hull as a child of `mesh`. Thickness in CSS pixels. */
export function outline<T extends THREE.Mesh>(mesh: T, px = 2.5): T {
  const hull = new THREE.Mesh(hullGeometry(mesh.geometry), outlineMaterial(px));
  hull.name = `${mesh.name || "mesh"}:outline`;
  hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

export function setOutlineResolution(width: number, height: number) {
  outlineUniforms.resolution.value.set(width, height);
}

/** Toon mesh with an outline in one call. */
export function inked(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  px = 2.5,
): THREE.Mesh {
  return outline(new THREE.Mesh(geometry, material), px);
}
