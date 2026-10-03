import type { LabModelStats } from "@/domain/cad-lab";

/** Files the page hands the conversion worker: STEP, GLB, or zips of them. */
export type ConvertRequest = { id: number; files: { name: string; bytes: ArrayBuffer }[] };

export type ConvertStage = "unzip" | "read" | "tessellate" | "compress";

export type ConvertedModel = { name: string; slug: string; glb: ArrayBuffer; stats: LabModelStats };

export type ConvertMessage =
  | { id: number; type: "queued"; total: number }
  | { id: number; type: "progress"; file: string; index: number; total: number; stage: ConvertStage }
  | { id: number; type: "model"; index: number; total: number; model: ConvertedModel; ms: number }
  | { id: number; type: "skipped"; file: string; reason: string }
  | { id: number; type: "done" }
  | { id: number; type: "error"; message: string };
