/**
 * Off the main thread: unzip, tessellate STEP with OpenCascade (WASM), and write compressed GLB.
 * A 7 MB assembly takes about 20 seconds to tessellate, so the page stays responsive meanwhile.
 */
import occtimportjs from "occt-import-js";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import { WebIO, type Document } from "@gltf-transform/core";
import { EXTMeshGPUInstancing, EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { dedup, getBounds, meshopt, prune, uninstance, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { unzipSync } from "three/examples/jsm/libs/fflate.module.js";
import { STEP_TESSELLATION, occtToDocument, type OcctResult } from "@/domain/cad-convert";
import { cadFileKind, uniqueModelNames, zipEntryName } from "@/domain/cad-lab";
import type { ConvertMessage, ConvertRequest, ConvertStage } from "./convert-protocol";

/** The worker scope, typed here because the app compiles against the DOM lib, not the webworker one. */
const scope = globalThis as unknown as {
  postMessage(message: ConvertMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null;
};

let occtReady: ReturnType<typeof occtimportjs> | null = null;
let ioReady: Promise<WebIO> | null = null;

// A failed start (the 7.6 MB .wasm did not download, or a deploy replaced it) is not kept: the next file retries.
function occt() {
  occtReady ??= occtimportjs({ locateFile: () => occtWasmUrl }).catch((err: unknown) => {
    occtReady = null;
    throw err;
  });
  return occtReady;
}

function io() {
  ioReady ??= Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
    .then(() =>
      new WebIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTMeshGPUInstancing]).registerDependencies({
        "meshopt.encoder": MeshoptEncoder,
        "meshopt.decoder": MeshoptDecoder,
      }),
    )
    .catch((err: unknown) => {
      ioReady = null;
      throw err;
    });
  return ioReady;
}

function post(message: ConvertMessage, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

type Entry = { name: string; bytes: Uint8Array };

/** Zips open to the STEP and GLB files inside them; macOS resource forks and dotfiles are dropped. */
function expand(files: ConvertRequest["files"], id: number): Entry[] {
  const out: Entry[] = [];
  for (const file of files) {
    const kind = cadFileKind(file.name);
    if (kind === "zip") {
      post({ id, type: "progress", file: file.name, index: 0, total: files.length, stage: "unzip" });
      try {
        const inside = unzipSync(new Uint8Array(file.bytes), {
          filter: (entry) => {
            const base = entry.name.split("/").pop() ?? "";
            return !entry.name.startsWith("__MACOSX/") && !base.startsWith(".") && (cadFileKind(base) === "step" || cadFileKind(base) === "glb");
          },
        });
        const keys = Object.keys(inside).sort((a, b) => zipEntryName(a).localeCompare(zipEntryName(b), undefined, { numeric: true }));
        if (keys.length === 0) post({ id, type: "skipped", file: file.name, reason: "No .stp, .step, or .glb files inside" });
        for (const key of keys) out.push({ name: zipEntryName(key), bytes: inside[key]! });
      } catch {
        post({ id, type: "skipped", file: file.name, reason: "Could not open the zip" });
      }
    } else if (kind) {
      out.push({ name: file.name, bytes: new Uint8Array(file.bytes) });
    } else {
      post({ id, type: "skipped", file: file.name, reason: "Not a STEP, GLB, or zip file" });
    }
  }
  return out;
}

function countDocument(document: Document) {
  let triangles = 0;
  let parts = 0;
  const root = document.getRoot();
  for (const node of root.listNodes()) if (node.getMesh()) parts++;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const count = prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION")?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  const scene = root.listScenes()[0];
  const sizeMm: [number, number, number] = [0, 0, 0];
  if (scene) {
    const { min, max } = getBounds(scene);
    for (let k = 0; k < 3; k++) sizeMm[k] = Number.isFinite(max[k]! - min[k]!) ? Math.round((max[k]! - min[k]!) * 10000) / 10 : 0;
  }
  return { parts, triangles, sizeMm };
}

async function convertOne(entry: Entry, name: string, slug: string, index: number, total: number, id: number) {
  const started = performance.now();
  const stage = (s: ConvertStage) => post({ id, type: "progress", file: entry.name, index, total, stage: s });
  const writer = await io();
  let glb: Uint8Array;
  let stats: { parts: number; triangles: number; sizeMm: [number, number, number] };

  if (cadFileKind(entry.name) === "glb") {
    stage("read");
    let document: Document;
    try {
      document = await writer.readBinary(entry.bytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      throw new Error(/draco/i.test(message) ? "Uses Draco compression; export it without Draco, or send the STEP" : "Not a readable GLB");
    }
    // GPU instancing (one mesh placed by many transforms) would collapse to a single part: expand it.
    if (document.getRoot().listNodes().some((node) => node.getExtension("EXT_mesh_gpu_instancing"))) {
      await document.transform(uninstance());
      glb = await writer.writeBinary(document);
    } else {
      glb = entry.bytes;
    }
    stats = countDocument(document);
  } else {
    stage("read");
    const reader = await occt();
    stage("tessellate");
    const result = reader.ReadStepFile(entry.bytes, { ...STEP_TESSELLATION }) as OcctResult;
    if (!result?.success) throw new Error("OpenCascade could not read this STEP file");
    const converted = occtToDocument(result, name);
    if (converted.stats.triangles === 0) throw new Error("The STEP file has no solids to show");
    stage("compress");
    await converted.document.transform(weld(), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    glb = await writer.writeBinary(converted.document);
    stats = converted.stats;
  }

  if (stats.triangles === 0) throw new Error("Nothing to show: the model has no triangles");
  // Copy into a standalone buffer so it can be transferred without dragging the zip along.
  const buffer = glb.slice().buffer;
  post(
    {
      id,
      type: "model",
      index,
      total,
      ms: Math.round(performance.now() - started),
      model: {
        name,
        slug,
        glb: buffer,
        stats: { name, ...stats, sourceName: entry.name.split("/").pop() ?? entry.name, sourceBytes: entry.bytes.byteLength },
      },
    },
    [buffer],
  );
}

scope.onmessage = async (event) => {
  const { id, files } = event.data;
  try {
    const entries = expand(files, id);
    const names = uniqueModelNames(entries.map((entry) => entry.name));
    post({ id, type: "queued", total: entries.length });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      try {
        await convertOne(entry, names[i]!.name, names[i]!.slug, i, entries.length, id);
      } catch (err) {
        post({ id, type: "skipped", file: entry.name, reason: err instanceof Error ? err.message : "Could not convert" });
      }
      entries[i] = { name: entry.name, bytes: new Uint8Array(0) };
    }
    post({ id, type: "done" });
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : "Conversion failed" });
  }
};
