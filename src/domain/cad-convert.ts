import { Document, type Material, type Mesh, type Node } from "@gltf-transform/core";
import type { LinearRgb } from "./cad-lab";

/** The parts of an occt-import-js `ReadStepFile` result the lab reads. Positions are in `linearUnit`. */
export type OcctFace = { first: number; last: number; color: LinearRgb | null };
export type OcctMesh = {
  name?: string;
  color?: LinearRgb;
  brep_faces?: OcctFace[];
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
};
export type OcctNode = { name?: string; meshes?: number[]; children?: OcctNode[] };
export type OcctResult = { success: boolean; root: OcctNode; meshes: OcctMesh[] };

/**
 * Chord error as a share of each solid's bounding box, and the largest angle between facet normals.
 * Fine enough that curved aluminum reads smooth in a close-up; a desk-sized assembly lands in the low hundreds of thousands of triangles.
 */
export const STEP_TESSELLATION = {
  linearUnit: "millimeter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: 0.001,
  angularDeflection: 0.25,
} as const;

const MM_TO_M = 0.001;
/** glTF's fallback for a solid STEP left uncolored: SolidWorks' default gray, in linear RGB. */
const UNCOLORED: LinearRgb = [0.52, 0.52, 0.52];

export type ConvertedStats = { parts: number; triangles: number; sizeMm: [number, number, number] };

function cleanName(name: string | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim();
}

function colorKey(color: LinearRgb | null | undefined): string {
  return color ? color.map((c) => c.toFixed(4)).join(",") : "none";
}

/**
 * A STEP assembly as a glTF document in metres: one node per STEP node, one mesh per solid, one material
 * per distinct CAD color (its linear color kept in `extras.cadColor`, null when the CAD had none), and
 * each node's untouched CAD name in `extras.name` because loaders rewrite node names.
 */
export function occtToDocument(result: OcctResult, modelName: string): { document: Document; stats: ConvertedStats } {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene(modelName);
  const materials = new Map<string, Material>();
  const meshes = new Map<number, Mesh>();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let parts = 0;

  const materialFor = (color: LinearRgb | null) => {
    const key = colorKey(color);
    let material = materials.get(key);
    if (!material) {
      const [r, g, b] = color ?? UNCOLORED;
      material = document
        .createMaterial(color ? `CAD ${materials.size + 1}` : "Uncolored")
        .setBaseColorFactor([r, g, b, 1])
        .setMetallicFactor(0)
        .setRoughnessFactor(0.5)
        .setExtras({ cadColor: color });
      materials.set(key, material);
    }
    return material;
  };

  const meshFor = (index: number, label: string): Mesh | null => {
    const cached = meshes.get(index);
    if (cached) return cached;
    const source = result.meshes[index];
    if (!source) return null;
    const raw = source.attributes.position.array;
    const positions = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = raw[i + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
        positions[i + k] = v * MM_TO_M;
      }
    }
    const indices = Uint32Array.from(source.index.array);
    if (positions.length === 0 || indices.length === 0) return null;
    triangles += indices.length / 3;

    const position = document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer);
    const normal = source.attributes.normal
      ? document.createAccessor().setType("VEC3").setArray(Float32Array.from(source.attributes.normal.array)).setBuffer(buffer)
      : null;

    // One primitive per face color when the STEP colors faces; otherwise the solid takes its own color.
    const groups = new Map<string, { color: LinearRgb | null; indices: number[] | Uint32Array }>();
    const faces = source.brep_faces ?? [];
    if (faces.some((face) => face.color)) {
      for (const face of faces) {
        const color = face.color ?? source.color ?? null;
        const key = colorKey(color);
        const group = groups.get(key) ?? { color, indices: [] as number[] };
        const list = group.indices as number[];
        for (let t = face.first; t <= face.last; t++) list.push(indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!);
        groups.set(key, group);
      }
    } else {
      groups.set(colorKey(source.color), { color: source.color ?? null, indices });
    }

    const mesh = document.createMesh(label);
    for (const group of groups.values()) {
      if (group.indices.length === 0) continue;
      const prim = document
        .createPrimitive()
        .setAttribute("POSITION", position)
        .setIndices(document.createAccessor().setType("SCALAR").setArray(Uint32Array.from(group.indices)).setBuffer(buffer))
        .setMaterial(materialFor(group.color));
      if (normal) prim.setAttribute("NORMAL", normal);
      mesh.addPrimitive(prim);
    }
    meshes.set(index, mesh);
    return mesh;
  };

  const partNode = (meshIndex: number, name: string): Node | null => {
    const mesh = meshFor(meshIndex, name);
    if (!mesh) return null;
    parts++;
    return document.createNode(name).setMesh(mesh).setExtras({ name });
  };

  const walk = (node: OcctNode, depth: number): Node | null => {
    const label = cleanName(node.name);
    const meshList = node.meshes ?? [];
    const children = node.children ?? [];
    // A STEP part with one solid becomes a single glTF node carrying the part's name.
    if (meshList.length === 1 && children.length === 0) {
      const index = meshList[0]!;
      return partNode(index, label || cleanName(result.meshes[index]?.name) || `Part ${parts + 1}`);
    }
    const name = label || (depth === 0 ? modelName : "Assembly");
    const out = document.createNode(name).setExtras({ name });
    meshList.forEach((index, i) => {
      const meshName = cleanName(result.meshes[index]?.name) || (label ? `${label} ${i + 1}` : `Part ${parts + 1}`);
      const child = partNode(index, meshName);
      if (child) out.addChild(child);
    });
    for (const child of children) {
      const built = walk(child, depth + 1);
      if (built) out.addChild(built);
    }
    return out.listChildren().length > 0 || out.getMesh() ? out : null;
  };

  const root = walk(result.root, 0);
  if (root) {
    root.setName(modelName).setExtras({ name: modelName });
    scene.addChild(root);
  }

  const sizeMm: [number, number, number] = triangles
    ? [round1(max[0]! - min[0]!), round1(max[1]! - min[1]!), round1(max[2]! - min[2]!)]
    : [0, 0, 0];
  return { document, stats: { parts, triangles, sizeMm } };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
