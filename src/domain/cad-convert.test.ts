import { describe, expect, it } from "vitest";
import { occtToDocument, type OcctResult } from "./cad-convert";

/** A unit cube's worth of triangles is not needed; two triangles per "solid" is enough to check the mapping. */
function quad(offsetMm: number) {
  return {
    position: { array: [0, 0, offsetMm, 10, 0, offsetMm, 10, 20, offsetMm, 0, 20, offsetMm] },
    normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] },
  };
}

const gray: [number, number, number] = [0.521, 0.521, 0.521];
const black: [number, number, number] = [0.07, 0.07, 0.07];

function sample(): OcctResult {
  return {
    success: true,
    root: {
      name: "",
      children: [
        {
          name: "AX-1000",
          meshes: [],
          children: [
            { name: "桌腿", meshes: [0], children: [] },
            { name: "ISO 4762 - M4 x 10", meshes: [1], children: [] },
            { name: "侧面卡扣-3", meshes: [2, 3], children: [] },
          ],
        },
      ],
    },
    meshes: [
      { name: "", color: gray, attributes: quad(0), index: { array: [0, 1, 2, 0, 2, 3] } },
      { name: "", color: black, attributes: quad(5), index: { array: [0, 1, 2, 0, 2, 3] } },
      { name: "slot a", attributes: quad(10), index: { array: [0, 1, 2, 0, 2, 3] } },
      {
        name: "",
        color: gray,
        attributes: quad(1000),
        index: { array: [0, 1, 2, 0, 2, 3] },
        brep_faces: [
          { first: 0, last: 0, color: [1, 0, 0] },
          { first: 1, last: 1, color: null },
        ],
      },
    ],
  };
}

describe("occtToDocument", () => {
  it("keeps the assembly tree and the CAD names", () => {
    const { document } = occtToDocument(sample(), "AX-1000");
    const scene = document.getRoot().listScenes()[0]!;
    const [root] = scene.listChildren();
    expect(root!.getName()).toBe("AX-1000");
    const children = root!.listChildren()[0]!.listChildren();
    expect(children.map((n) => n.getExtras().name)).toEqual(["桌腿", "ISO 4762 - M4 x 10", "侧面卡扣-3"]);
    // A one-solid part is a single node with the mesh on it; two solids become two child nodes.
    expect(children[0]!.getMesh()).not.toBeNull();
    expect(children[2]!.getMesh()).toBeNull();
    expect(children[2]!.listChildren().map((n) => n.getExtras().name)).toEqual(["slot a", "侧面卡扣-3 2"]);
  });

  it("writes metres and reports the size in millimetres", () => {
    const { document, stats } = occtToDocument(sample(), "AX-1000");
    const positions = document.getRoot().listAccessors().find((a) => a.getType() === "VEC3")!.getArray()!;
    expect(positions[3]).toBeCloseTo(0.01);
    expect(positions[7]).toBeCloseTo(0.02);
    expect(stats).toEqual({ parts: 4, triangles: 8, sizeMm: [10, 20, 1000] });
  });

  it("shares one material per CAD color and remembers when there was none", () => {
    const { document } = occtToDocument(sample(), "AX-1000");
    const materials = document.getRoot().listMaterials();
    const colors = materials.map((m) => m.getExtras().cadColor);
    expect(colors).toContainEqual(gray);
    expect(colors).toContainEqual(black);
    expect(colors).toContainEqual(null);
    expect(colors).toContainEqual([1, 0, 0]);
    expect(materials).toHaveLength(4);
  });

  it("splits a solid by face color, falling back to the solid's color", () => {
    const { document } = occtToDocument(sample(), "AX-1000");
    const faceColored = document
      .getRoot()
      .listMeshes()
      .find((mesh) => mesh.listPrimitives().length === 2)!;
    const prims = faceColored.listPrimitives();
    expect(prims.map((p) => p.getMaterial()!.getExtras().cadColor)).toEqual([[1, 0, 0], gray]);
    expect(prims.map((p) => Array.from(p.getIndices()!.getArray()!))).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });

  it("names unnamed solids and skips empty ones", () => {
    const result: OcctResult = {
      success: true,
      root: { name: "", meshes: [0, 1], children: [] },
      meshes: [
        { attributes: quad(0), index: { array: [0, 1, 2] } },
        { attributes: { position: { array: [] } }, index: { array: [] } },
      ],
    };
    const { document, stats } = occtToDocument(result, "Bracket");
    const root = document.getRoot().listScenes()[0]!.listChildren()[0]!;
    expect(root.getName()).toBe("Bracket");
    expect(root.listChildren().map((n) => n.getName())).toEqual(["Part 1"]);
    expect(stats.parts).toBe(1);
  });

  it("returns an empty scene for a file with no solids", () => {
    const { document, stats } = occtToDocument({ success: true, root: { name: "", children: [] }, meshes: [] }, "Empty");
    expect(document.getRoot().listScenes()[0]!.listChildren()).toHaveLength(0);
    expect(stats).toEqual({ parts: 0, triangles: 0, sizeMm: [0, 0, 0] });
  });
});
