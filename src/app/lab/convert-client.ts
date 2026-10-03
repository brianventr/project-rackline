import { cadFileKind } from "@/domain/cad-lab";
import type { ConvertMessage } from "./convert-protocol";

let worker: Worker | null = null;
let nextId = 1;
const listeners = new Map<number, (message: ConvertMessage) => void>();

function conversionWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./cad-convert.worker.ts", import.meta.url), { type: "module", name: "cad-convert" });
  worker.onmessage = (event: MessageEvent<ConvertMessage>) => listeners.get(event.data.id)?.(event.data);
  worker.onerror = (event) => {
    // A crashed worker (out of memory on a huge assembly) fails every open batch; the next batch starts a fresh one.
    const message = event.message || "The converter stopped. Try fewer files at once.";
    for (const [id, listener] of listeners) listener({ id, type: "error", message });
    listeners.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/**
 * Convert dropped files (STEP, GLB, or zips of them) in the background worker. `onMessage` sees each
 * model as it finishes; the promise settles once the batch is done.
 */
export async function convertCadFiles(files: File[], onMessage: (message: ConvertMessage) => void): Promise<void> {
  const id = nextId++;
  // Read only what could be CAD, one file at a time: a dropped folder (which the browser hands over as an
  // unreadable File) or a stray document is reported and skipped instead of failing the whole drop.
  const payload: { name: string; bytes: ArrayBuffer }[] = [];
  for (const file of files) {
    if (!cadFileKind(file.name)) {
      onMessage({ id, type: "skipped", file: file.name, reason: "Not a STEP, GLB, or zip file (zip a folder before dropping it)" });
      continue;
    }
    try {
      payload.push({ name: file.name, bytes: await file.arrayBuffer() });
    } catch {
      onMessage({ id, type: "skipped", file: file.name, reason: "Could not read it. Zip a folder before dropping it" });
    }
  }
  const target = conversionWorker();
  await new Promise<void>((resolve, reject) => {
    listeners.set(id, (message) => {
      onMessage(message);
      if (message.type === "done") {
        listeners.delete(id);
        resolve();
      } else if (message.type === "error") {
        listeners.delete(id);
        reject(new Error(message.message));
      }
    });
    target.postMessage(
      { id, files: payload },
      payload.map((file) => file.bytes),
    );
  });
}
