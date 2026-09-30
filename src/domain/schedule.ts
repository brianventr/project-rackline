/**
 * Light production schedule board — sequence open kits and work orders.
 * Not finite-capacity MRP; a maker-facing day board for the bench.
 */

export type ScheduleJobKind = "kit" | "work_order";

export type ScheduleJob = {
  id: string;
  kind: ScheduleJobKind;
  number: string;
  sku: string;
  name: string;
  qty: number;
  qtyCompleted: number;
  remaining: number;
  status: string;
  createdAt: number;
  dueScore: number;
};

export function rankScheduleJobs(jobs: ScheduleJob[]): ScheduleJob[] {
  return [...jobs].sort((a, b) => {
    if (a.dueScore !== b.dueScore) return b.dueScore - a.dueScore;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.number.localeCompare(b.number);
  });
}

/** Higher score = sooner on the board. Age + remaining size. */
export function scheduleDueScore(createdAt: number, remaining: number, now = Date.now()): number {
  const ageHours = Math.max(0, (now - createdAt) / 3_600_000);
  return ageHours * 2 + Math.min(remaining, 50);
}

export function toScheduleJob(input: {
  id: string;
  kind: ScheduleJobKind;
  number: string;
  sku: string;
  name: string;
  qty: number;
  qtyCompleted: number;
  status: string;
  createdAt: number;
  now?: number;
}): ScheduleJob | null {
  const remaining = Math.max(0, input.qty - input.qtyCompleted);
  if (remaining <= 0) return null;
  if (input.status === "completed" || input.status === "cancelled" || input.status === "dekitted") return null;
  return {
    id: input.id,
    kind: input.kind,
    number: input.number,
    sku: input.sku,
    name: input.name,
    qty: input.qty,
    qtyCompleted: input.qtyCompleted,
    remaining,
    status: input.status,
    createdAt: input.createdAt,
    dueScore: scheduleDueScore(input.createdAt, remaining, input.now),
  };
}
