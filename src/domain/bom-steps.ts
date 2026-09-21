import { ImageUrlError, normalizeImageUrl } from "./media";

export class BomStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BomStepError";
  }
}

export type BomStepInput = {
  id?: string | null;
  seq?: number | null;
  title?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  componentItemId?: string | null;
};

export type NormalizedBomStep = {
  id: string | null;
  seq: number;
  title: string;
  body: string;
  imageUrl: string | null;
  componentItemId: string | null;
};

export function normalizeBomSteps(steps: unknown, componentItemIds: string[]): NormalizedBomStep[] {
  if (steps == null) return [];
  if (!Array.isArray(steps)) throw new BomStepError("steps must be an array");
  const allowed = new Set(componentItemIds);
  const pending = steps.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new BomStepError("Invalid step");
    const step = raw as BomStepInput;
    const title = typeof step.title === "string" ? step.title.trim() : "";
    const body = typeof step.body === "string" ? step.body.trim() : "";
    if (!title && !body) throw new BomStepError("Each step needs a title or body");
    const componentItemId =
      typeof step.componentItemId === "string" && step.componentItemId.trim() ? step.componentItemId.trim() : null;
    if (componentItemId && !allowed.has(componentItemId)) {
      throw new BomStepError("Step component must be on the recipe");
    }
    let imageUrl: string | null;
    try {
      imageUrl = normalizeImageUrl(step.imageUrl ?? null);
    } catch (err) {
      if (err instanceof ImageUrlError) throw new BomStepError(err.message);
      throw err;
    }
    const seq = typeof step.seq === "number" && Number.isFinite(step.seq) ? step.seq : index + 1;
    const id = typeof step.id === "string" && step.id.trim() ? step.id.trim() : null;
    return { id, seq, title, body, imageUrl, componentItemId, index };
  });
  pending.sort((a, b) => a.seq - b.seq || a.index - b.index);
  return pending.map((step, index) => ({
    id: step.id,
    seq: index + 1,
    title: step.title,
    body: step.body,
    imageUrl: step.imageUrl,
    componentItemId: step.componentItemId,
  }));
}
