import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshGPUInstancing, KHRMeshQuantization } from "@gltf-transform/extensions";
import { quantize } from "@gltf-transform/functions";
import { loadModel } from "./model-loader";

/** A 10 mm square plate (two triangles, facing +Z) as a glTF mesh. */
function plate(doc: Document, name: string) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array([0, 0, 0, 0.01, 0, 0, 0.01, 0.01, 0, 0, 0.01, 0])))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])))
    .setIndices(doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Uint16Array([0, 1, 2, 0, 2, 3])))
    .setMaterial(doc.createMaterial("cad").setExtras({ cadColor: [0.5, 0.5, 0.5] }));
  return doc.createMesh(name).addPrimitive(prim);
}

async function toArrayBuffer(doc: Document): Promise<ArrayBuffer> {
  const io = new NodeIO().registerExtensions([EXTMeshGPUInstancing, KHRMeshQuantization]);
  const bytes = await io.writeBinary(doc);
  return bytes.slice().buffer;
}

describe("loadModel", () => {
  it("keeps CAD names, bakes node transforms, and dequantizes", async () => {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene("s");
    scene.addChild(doc.createNode("Screw M4 x 10").setExtras({ name: "Screw M4 x 10" }).setMesh(plate(doc, "a")).setTranslation([0.1, 0, 0]));
    scene.addChild(doc.createNode("Screw M4 x 10").setExtras({ name: "Screw M4 x 10" }).setMesh(plate(doc, "b")));
    await doc.transform(quantize());
    const model = await loadModel(await toArrayBuffer(doc));
    expect(model.parts.map((p) => p.id)).toEqual(["Screw M4 x 10#1", "Screw M4 x 10#2"]);
    expect(model.parts[0]!.name).toBe("Screw M4 x 10");
    expect(model.parts[0]!.cadColor).toEqual([0.5, 0.5, 0.5]);
    expect(model.triangles).toBe(4);
    for (const part of model.parts) {
      const position = part.mesh.geometry.getAttribute("position");
      expect(position.array).toBeInstanceOf(Float32Array);
      expect(position.normalized).toBe(false);
    }
    const box = new THREE.Box3().setFromObject(model.root);
    expect(box.max.x).toBeCloseTo(0.11, 4);
  });

  it("turns each GPU instance into its own part", async () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const instancing = doc.createExtension(EXTMeshGPUInstancing).setRequired(true);
    const translations = new Float32Array(6 * 3);
    for (let i = 0; i < 6; i++) translations[i * 3] = i * 0.1;
    const batch = instancing.createInstancedMesh().setAttribute("TRANSLATION", doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(translations));
    doc.createScene("s").addChild(doc.createNode("Washer").setExtras({ name: "Washer" }).setMesh(plate(doc, "washer")).setExtension("EXT_mesh_gpu_instancing", batch));
    const model = await loadModel(await toArrayBuffer(doc));
    expect(model.parts).toHaveLength(6);
    expect(model.parts.map((p) => p.id)).toContain("Washer#6");
    const box = new THREE.Box3().setFromObject(model.root);
    expect(box.max.x - box.min.x).toBeCloseTo(0.51, 4);
  });

  it("keeps a mirrored part facing outward", async () => {
    const doc = new Document();
    doc.createBuffer();
    doc.createScene("s").addChild(doc.createNode("Mirror").setMesh(plate(doc, "m")).setScale([-1, 1, 1]));
    const model = await loadModel(await toArrayBuffer(doc));
    const geometry = model.parts[0]!.mesh.geometry;
    const p = geometry.getAttribute("position");
    const i = geometry.index!;
    const [a, b, c] = [i.getX(0), i.getX(1), i.getX(2)].map((k) => new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)));
    const faceNormal = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!));
    // The plate faces +Z before and after the mirror; the winding must agree with that.
    expect(faceNormal.z).toBeGreaterThan(0);
  });
});
