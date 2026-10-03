import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { defaultFinishFor, partLabel, type LinearRgb } from "@/domain/cad-lab";

export type LabPart = {
  id: string;
  /** The CAD name as modelled, before the loader rewrote it. */
  name: string;
  label: { primary: string; secondary: string | null };
  cadColor: LinearRgb | null;
  defaultFinish: string;
  triangles: number;
  mesh: THREE.Mesh;
};

export type LoadedModel = {
  root: THREE.Group;
  parts: LabPart[];
  triangles: number;
  /** The GLB's own materials; parts wear finish materials instead, so these are only kept to dispose. */
  sourceMaterials: THREE.Material[];
};

/** Normalized integer attributes become plain floats: the path tracer merges every mesh into one buffer. */
function toFloatAttributes(geometry: THREE.BufferGeometry) {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    if (attribute instanceof THREE.InterleavedBufferAttribute || !(attribute.array instanceof Float32Array) || attribute.normalized) {
      const out = new Float32Array(attribute.count * attribute.itemSize);
      for (let i = 0; i < attribute.count; i++) {
        for (let k = 0; k < attribute.itemSize; k++) out[i * attribute.itemSize + k] = attribute.getComponent(i, k);
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(out, attribute.itemSize));
    }
  }
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
}

function flipWinding(geometry: THREE.BufferGeometry) {
  const index = geometry.index;
  if (index) {
    const array = index.array;
    for (let i = 0; i + 2 < array.length; i += 3) {
      const b = array[i + 1]!;
      array[i + 1] = array[i + 2]!;
      array[i + 2] = b;
    }
    index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
    const size = attribute.itemSize;
    const array = attribute.array;
    for (let v = 0; v + 2 < attribute.count; v += 3) {
      for (let k = 0; k < size; k++) {
        const b = array[(v + 1) * size + k]!;
        array[(v + 1) * size + k] = array[(v + 2) * size + k]!;
        array[(v + 2) * size + k] = b;
      }
    }
    attribute.needsUpdate = true;
  }
}

function cadNameOf(object: THREE.Object3D): string {
  let node: THREE.Object3D | null = object;
  while (node) {
    const name = typeof node.userData?.name === "string" ? node.userData.name : "";
    if (name) return name;
    node = node.parent;
  }
  return object.name.replace(/_/g, " ");
}

function cadColorOf(material: THREE.Material): LinearRgb | null {
  const value = (material.userData as { cadColor?: unknown }).cadColor;
  if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number")) return value as LinearRgb;
  return null;
}

/** Parse a GLB (as the lab stores it) into one group of parts, every geometry baked into world space. */
export async function loadModel(glb: ArrayBuffer): Promise<LoadedModel> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(glb.slice(0), "");
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const root = new THREE.Group();
  root.name = "cad-model";
  const parts: LabPart[] = [];
  const sourceMaterials = new Set<THREE.Material>();
  let triangles = 0;

  const seen = new Map<string, number>();
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });

  for (const source of meshes) {
    const geometry = source.geometry.clone();
    toFloatAttributes(geometry);
    // Quantized positions carry their dequantization scale on the node; baking the world matrix keeps every part in metres.
    geometry.applyMatrix4(source.matrixWorld);
    // A mirrored node turns faces inside out once baked; swap the winding back.
    if (source.matrixWorld.determinant() < 0) flipWinding(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = Array.isArray(source.material) ? source.material[0]! : source.material;
    sourceMaterials.add(material);
    const cadColor = cadColorOf(material);
    // Clicking a part raycasts through a BVH instead of every triangle of a 300k-triangle stand.
    // drei pins an older three-mesh-bvh whose typing of `boundsTree` clashes with this one's.
    (geometry as unknown as { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.raycast = acceleratedRaycast;
    const name = cadNameOf(source);
    // Ids follow the CAD name and its occurrence, not the position in the file, so remembered finishes
    // stay on the right parts when a re-exported assembly gains or loses a solid elsewhere.
    const occurrence = (seen.get(name) ?? 0) + 1;
    seen.set(name, occurrence);
    const id = `${name}#${occurrence}`;
    mesh.name = name;
    mesh.userData.partId = id;
    root.add(mesh);
    const count = Math.floor((geometry.index?.count ?? geometry.getAttribute("position").count) / 3);
    triangles += count;
    parts.push({ id, name, label: partLabel(name), cadColor, defaultFinish: defaultFinishFor(name, cadColor), triangles: count, mesh });
    source.geometry.dispose();
  }
  return { root, parts, triangles, sourceMaterials: [...sourceMaterials] };
}

/**
 * Free a model's GPU buffers. Safe to call while it is still drawn (three uploads it again), so React's
 * double-run effects in development cannot break picking; the BVHs go with the garbage collector.
 */
export function disposeModel(model: LoadedModel) {
  for (const part of model.parts) part.mesh.geometry.dispose();
  for (const material of model.sourceMaterials) material.dispose();
}
