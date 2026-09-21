import {
  canCompleteKit,
  canCompleteWorkOrder,
  canPostCount,
  canPostReplenishment,
  canPostTransfer,
  canPostVendorReturn,
  canReceive,
  canReceivePurchase,
  canReceiveReturn,
  canReleaseHold,
  normalizeOrderStatus,
} from "./status";

export const FLOOR_VERBS = [
  "receive",
  "putaway",
  "replenish",
  "pick",
  "pack",
  "ship",
  "return",
  "rtv",
  "count",
  "assemble",
  "kit",
  "hold",
] as const;

export type FloorVerb = (typeof FLOOR_VERBS)[number];

export const JOB_REF_TYPES = [
  "order",
  "receipt",
  "purchase",
  "transfer",
  "replenishment",
  "rma",
  "vendorReturn",
  "cycleCount",
  "workOrder",
  "kit",
  "hold",
  "putawaySuggestion",
  "replenishSuggestion",
] as const;

export type JobRefType = (typeof JOB_REF_TYPES)[number];

export const JOB_STATUSES = ["open", "claimed", "done", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ORDER_VERBS = ["pick", "pack", "ship"] as const;

export const VERB_LABELS: Record<FloorVerb, string> = {
  receive: "Receive",
  putaway: "Put away",
  replenish: "Replenish",
  pick: "Pick",
  pack: "Pack",
  ship: "Ship",
  return: "Return",
  rtv: "Vendor return",
  count: "Count",
  assemble: "Assemble",
  kit: "Kit",
  hold: "Hold",
};

export class JobClaimedError extends Error {
  constructor(
    public claimedById: string,
    public claimedByName: string,
  ) {
    super(`This job is claimed by ${claimedByName}`);
    this.name = "JobClaimedError";
  }
}

export class JobNotReadyError extends Error {
  constructor(public notBefore: number) {
    super("This job is scheduled for later");
    this.name = "JobNotReadyError";
  }
}

export class JobVerbDeniedError extends Error {
  constructor(public verb: FloorVerb) {
    super(`You are not assigned the ${VERB_LABELS[verb]} verb`);
    this.name = "JobVerbDeniedError";
  }
}

export function isFloorVerb(value: string): value is FloorVerb {
  return (FLOOR_VERBS as readonly string[]).includes(value);
}

export function isJobRefType(value: string): value is JobRefType {
  return (JOB_REF_TYPES as readonly string[]).includes(value);
}

export function parseFloorVerbs(raw: string | null | undefined, role: string): FloorVerb[] {
  if (role === "client") return [];
  if (role === "owner") return [...FLOOR_VERBS];
  if (!raw || !raw.trim() || raw.trim() === "*") return [...FLOOR_VERBS];
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw.split(",");
  }
  if (!Array.isArray(parsed)) return [...FLOOR_VERBS];
  const allowed = [...new Set(parsed.map((row) => (typeof row === "string" ? row.trim() : "")).filter(isFloorVerb))];
  return allowed.length > 0 ? allowed : [...FLOOR_VERBS];
}

export function serializeFloorVerbs(verbs: FloorVerb[] | null | undefined): string | null {
  if (!verbs || verbs.length === 0 || verbs.length === FLOOR_VERBS.length) return null;
  return JSON.stringify(verbs.filter(isFloorVerb));
}

export function verbAllowed(verbs: FloorVerb[], verb: FloorVerb): boolean {
  return verbs.includes(verb);
}

export function assertVerbAllowed(verbs: FloorVerb[], verb: FloorVerb): void {
  if (!verbAllowed(verbs, verb)) throw new JobVerbDeniedError(verb);
}

export function suggestionRefId(fromLocationId: string, itemId: string, toLocationId?: string | null): string {
  return toLocationId ? `${fromLocationId}:${itemId}:${toLocationId}` : `${fromLocationId}:${itemId}`;
}

export function materializeSuggestionTarget(refType: JobRefType): { refType: JobRefType } | null {
  if (refType === "putawaySuggestion") return { refType: "transfer" };
  if (refType === "replenishSuggestion") return { refType: "replenishment" };
  return null;
}

export function desiredVerb(refType: JobRefType, status: string): FloorVerb | null {
  switch (refType) {
    case "order": {
      const value = normalizeOrderStatus(status);
      if (value === "open" || value === "picking") return "pick";
      if (value === "picked" || value === "packing") return "pack";
      if (value === "packed") return "ship";
      return null;
    }
    case "receipt":
      return canReceive(status) ? "receive" : null;
    case "purchase":
      return canReceivePurchase(status) ? "receive" : null;
    case "transfer":
    case "putawaySuggestion":
      return refType === "putawaySuggestion" || canPostTransfer(status) ? "putaway" : null;
    case "replenishment":
    case "replenishSuggestion":
      return refType === "replenishSuggestion" || canPostReplenishment(status) ? "replenish" : null;
    case "rma":
      return canReceiveReturn(status) ? "return" : null;
    case "vendorReturn":
      return canPostVendorReturn(status) ? "rtv" : null;
    case "cycleCount":
      return canPostCount(status) ? "count" : null;
    case "workOrder":
      return canCompleteWorkOrder(status) ? "assemble" : null;
    case "kit":
      return canCompleteKit(status) ? "kit" : null;
    case "hold":
      return canReleaseHold(status) ? "hold" : null;
    default:
      return null;
  }
}

export function terminalJobOutcome(refType: JobRefType, status: string): "done" | "cancelled" | null {
  if (status === "cancelled" || status === "dekitted") return "cancelled";
  if (desiredVerb(refType, status) === null) return "done";
  return null;
}

export type ExistingJob = {
  id: string;
  verb: FloorVerb;
  status: JobStatus;
};

export type JobPlanOp =
  | { op: "create"; verb: FloorVerb }
  | { op: "complete"; id: string }
  | { op: "cancel"; id: string };

function orderVerbIndex(verb: FloorVerb): number {
  return (ORDER_VERBS as readonly string[]).indexOf(verb);
}

function activeJobs(existing: ExistingJob[]): ExistingJob[] {
  return existing.filter((job) => job.status === "open" || job.status === "claimed");
}

export function planJobSync(existing: ExistingJob[], desired: FloorVerb | null, terminal: "done" | "cancelled" | null): JobPlanOp[] {
  const active = activeJobs(existing);
  if (terminal === "cancelled") {
    return active.map((job) => ({ op: "cancel" as const, id: job.id }));
  }
  if (terminal === "done" || !desired) {
    return active.map((job) => ({ op: "complete" as const, id: job.id }));
  }

  const ops: JobPlanOp[] = [];
  const desiredIndex = orderVerbIndex(desired);
  for (const job of active) {
    if (job.verb === desired) continue;
    const jobIndex = orderVerbIndex(job.verb);
    if (desiredIndex >= 0 && jobIndex >= 0 && jobIndex > desiredIndex) {
      ops.push({ op: "cancel", id: job.id });
    } else {
      ops.push({ op: "complete", id: job.id });
    }
  }
  if (!active.some((job) => job.verb === desired)) {
    ops.push({ op: "create", verb: desired });
  }
  return ops;
}

export type ClaimableJob = {
  status: JobStatus;
  assigneeId: string | null;
  notBefore: number | null;
};

export function jobReservedByOther(job: ClaimableJob, userId: string): string | null {
  if (!job.assigneeId || job.assigneeId === userId) return null;
  if (job.status === "open" || job.status === "claimed") return job.assigneeId;
  return null;
}

export function applyClaim(
  job: ClaimableJob,
  userId: string,
  now: number,
  claimedByName = "someone",
  steal = false,
): ClaimableJob & { claimedAt: number } {
  if (job.status === "done" || job.status === "cancelled") {
    throw new Error("This job is no longer open");
  }
  if (job.notBefore && now < job.notBefore) {
    throw new JobNotReadyError(job.notBefore);
  }
  const other = jobReservedByOther(job, userId);
  if (other && !steal) throw new JobClaimedError(other, claimedByName);
  return { status: "claimed", assigneeId: userId, notBefore: job.notBefore, claimedAt: now };
}

export function applyRelease(job: ClaimableJob, userId: string, role: string, now: number): ClaimableJob & { releasedAt: number } {
  if (job.status !== "claimed" && job.status !== "open") {
    throw new Error("This job is not claimed");
  }
  if (job.assigneeId && job.assigneeId !== userId && role !== "owner") {
    throw new JobClaimedError(job.assigneeId, "another teammate");
  }
  return { status: "open", assigneeId: null, notBefore: job.notBefore, releasedAt: now };
}

export function applyAssign(
  job: ClaimableJob,
  userId: string | null,
  actorRole: string,
  actorId: string,
): ClaimableJob {
  const reserved = job.assigneeId && job.status === "claimed" ? job.assigneeId : job.assigneeId;
  if (reserved && reserved !== actorId && actorRole !== "owner") {
    throw new JobClaimedError(reserved, "another teammate");
  }
  if (!userId) {
    return { status: "open", assigneeId: null, notBefore: job.notBefore };
  }
  if (job.status === "claimed") {
    return { status: "claimed", assigneeId: userId, notBefore: job.notBefore };
  }
  return { status: "open", assigneeId: userId, notBefore: job.notBefore };
}

export function eligibleForNext(
  job: ClaimableJob & { verb: FloorVerb },
  userId: string,
  now: number,
  allowed: FloorVerb[],
): boolean {
  if (job.status === "done" || job.status === "cancelled") return false;
  if (job.notBefore && job.notBefore > now) return false;
  if (!allowed.includes(job.verb)) return false;
  const other = jobReservedByOther(job, userId);
  return !other;
}

export function jobFloorPath(job: {
  verb: FloorVerb;
  refType: JobRefType;
  refId: string;
  fromBarcode?: string | null;
}): string {
  switch (job.verb) {
    case "pick":
      return `/floor/pick?id=${job.refId}`;
    case "pack":
      return `/floor/pack?id=${job.refId}`;
    case "ship":
      return `/floor/ship?id=${job.refId}`;
    case "receive":
      return job.refType === "purchase" ? `/floor/receive?purchase=${job.refId}` : `/floor/receive?id=${job.refId}`;
    case "putaway":
      if (job.refType === "putawaySuggestion") {
        return job.fromBarcode
          ? `/floor/putaway?from=${encodeURIComponent(job.fromBarcode)}`
          : "/floor/putaway";
      }
      return `/floor/putaway?id=${job.refId}`;
    case "replenish":
      return job.refType === "replenishSuggestion" ? "/floor/replenish" : `/floor/replenish?id=${job.refId}`;
    case "return":
      return `/floor/return?id=${job.refId}`;
    case "rtv":
      return `/floor/rtv?id=${job.refId}`;
    case "count":
      return `/floor/count?id=${job.refId}`;
    case "assemble":
      return `/floor/assemble?id=${job.refId}`;
    case "kit":
      return `/floor/kit?id=${job.refId}`;
    case "hold":
      return `/floor/hold?id=${job.refId}`;
  }
}

export function jobOfficePath(job: { verb: FloorVerb; refType: JobRefType; refId: string }): string {
  switch (job.refType) {
    case "order":
      return `/outbound/orders/${job.refId}`;
    case "receipt":
      return `/inbound/receipts/${job.refId}`;
    case "purchase":
      return `/inbound/purchases/${job.refId}`;
    case "transfer":
      return `/inbound/putaway/${job.refId}`;
    case "replenishment":
      return `/stock/replenish/${job.refId}`;
    case "rma":
      return `/outbound/returns/${job.refId}`;
    case "vendorReturn":
      return `/inbound/vendor-returns/${job.refId}`;
    case "cycleCount":
      return `/stock/counts/${job.refId}`;
    case "workOrder":
      return `/make/work-orders/${job.refId}`;
    case "kit":
      return `/make/kits/${job.refId}`;
    case "hold":
      return `/stock/holds/${job.refId}`;
    case "putawaySuggestion":
      return "/inbound/putaway";
    case "replenishSuggestion":
      return "/stock/replenish";
  }
}

export function verbForOrderStatus(status: string): FloorVerb | null {
  return desiredVerb("order", status);
}
