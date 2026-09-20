import type { FloorVerb } from "./jobs";

export const PIN_SCORE = 1_000_000;
export const STARVE_SCORE = 400_000;
export const FEFO_BASE = 200_000;
export const DWELL_PER_HOUR = 2_000;
export const SHOPIFY_SCORE = 15_000;
export const DUE_PER_HOUR = 500;
export const AGE_PER_HOUR = 200;
export const WALK_PENALTY = 50;
export const SAME_AISLE_BONUS = 80;
export const SAME_VERB_BONUS = 40;

export type RankInput = {
  id: string;
  verb: FloorVerb;
  pinned: boolean;
  createdAt: number;
  dueAt: number | null;
  fromX: number | null;
  fromY: number | null;
  aisle: string | null;
  starved: boolean;
  expiringDays: number | null;
  shopify: boolean;
  dockDwellMs: number;
};

export type RankContext = {
  now: number;
  fromX?: number | null;
  fromY?: number | null;
  lastVerb?: FloorVerb | null;
  lastAisle?: string | null;
};

export type RankedJob = RankInput & { score: number; reason: string };

export function walkDistance(
  fromX: number | null | undefined,
  fromY: number | null | undefined,
  toX: number | null | undefined,
  toY: number | null | undefined,
): number {
  if (fromX == null || fromY == null || toX == null || toY == null) return 0;
  return Math.abs(fromX - toX) + Math.abs(fromY - toY);
}

function hoursBetween(later: number, earlier: number): number {
  return Math.max(0, (later - earlier) / 3_600_000);
}

export function jobReason(job: RankInput, now: number): string {
  if (job.pinned) return "Pinned";
  if (job.starved) return "Pick face is starving open picks";
  if (job.expiringDays != null && job.expiringDays <= 14) {
    if (job.expiringDays <= 0) return "Expired lot on the path";
    return `Expires in ${job.expiringDays} day${job.expiringDays === 1 ? "" : "s"}`;
  }
  if (job.dockDwellMs >= 2 * 3_600_000) return "Waiting on the dock";
  if (job.dueAt != null && job.dueAt <= now) return "Due now";
  if (job.shopify) return "Shopify order";
  return "Oldest open work";
}

export function scoreJob(job: RankInput, ctx: RankContext): number {
  let score = 0;
  if (job.pinned) score += PIN_SCORE;
  if (job.starved) score += STARVE_SCORE;
  if (job.expiringDays != null && job.expiringDays <= 14) {
    score += Math.max(0, FEFO_BASE - job.expiringDays * 5_000);
  }
  if (job.dockDwellMs > 0) {
    score += Math.min(48, hoursBetween(ctx.now, ctx.now - job.dockDwellMs)) * DWELL_PER_HOUR;
  }
  if (job.shopify) score += SHOPIFY_SCORE;
  if (job.dueAt != null) {
    score += Math.min(72, hoursBetween(ctx.now, Math.min(job.dueAt, ctx.now))) * DUE_PER_HOUR;
  }
  score += Math.min(72, hoursBetween(ctx.now, job.createdAt)) * AGE_PER_HOUR;
  score -= walkDistance(ctx.fromX, ctx.fromY, job.fromX, job.fromY) * WALK_PENALTY;
  if (ctx.lastAisle && job.aisle && ctx.lastAisle === job.aisle) score += SAME_AISLE_BONUS;
  if (ctx.lastVerb && ctx.lastVerb === job.verb) score += SAME_VERB_BONUS;
  return score;
}

export function rankJobs(jobs: RankInput[], ctx: RankContext): RankedJob[] {
  return jobs
    .map((job) => ({
      ...job,
      score: scoreJob(job, ctx),
      reason: jobReason(job, ctx.now),
    }))
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
