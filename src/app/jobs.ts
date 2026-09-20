import { useCallback, useEffect, useState } from "react";
import { api, type FloorJob } from "./api";
import { useWarehouse } from "./warehouse";
import { suggestionRefId } from "@/domain/jobs";

export function jobForRef(jobs: FloorJob[], refType: string, refId: string, verb?: string): FloorJob | undefined {
  return jobs.find((job) => job.refType === refType && job.refId === refId && (!verb || job.verb === verb));
}

export function jobForSuggestion(
  jobs: FloorJob[],
  kind: "putawaySuggestion" | "replenishSuggestion",
  fromLocationId: string,
  itemId: string,
  toLocationId: string,
): FloorJob | undefined {
  const refId = suggestionRefId(fromLocationId, itemId, toLocationId);
  return jobForRef(jobs, kind, refId);
}

export function jobClaimedByOther(job: FloorJob | undefined, userId: string): job is FloorJob {
  return Boolean(job?.assigneeId && job.assigneeId !== userId);
}

export function claimedByMessage(job: FloorJob): string {
  return `This job is claimed by ${job.assigneeName || "another teammate"}`;
}

export function splitByClaim<T>(
  rows: T[],
  userId: string,
  jobFor: (row: T) => FloorJob | undefined,
): { mine: T[]; pool: T[]; others: T[] } {
  const mine: T[] = [];
  const pool: T[] = [];
  const others: T[] = [];
  for (const row of rows) {
    const job = jobFor(row);
    if (job?.assigneeId === userId) mine.push(row);
    else if (job?.assigneeId) others.push(row);
    else pool.push(row);
  }
  return { mine, pool, others };
}

export function useOpenJobs(verb?: string): { jobs: FloorJob[]; reload: () => Promise<FloorJob[]> } {
  const { warehouseId } = useWarehouse();
  const [jobs, setJobs] = useState<FloorJob[]>([]);

  const reload = useCallback(async () => {
    const query = new URLSearchParams({ open: "1" });
    if (warehouseId) query.set("warehouseId", warehouseId);
    if (verb) query.set("verb", verb);
    const next = await api<FloorJob[]>(`/api/jobs?${query}`);
    setJobs(next);
    return next;
  }, [warehouseId, verb]);

  useEffect(() => {
    reload().catch(() => setJobs([]));
  }, [reload]);

  return { jobs, reload };
}
