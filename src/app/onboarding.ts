import { useCallback, useMemo, useSyncExternalStore } from "react";
import { api } from "./api";
import { refreshApi, useApiQuery } from "./query";
import { useSession } from "./session";
import { useWarehouse } from "./warehouse";
import {
  ONBOARDING_STEPS,
  nextOnboardingStep,
  onboardingProgress,
  type OnboardingStepId,
  type OnboardingStepMeta,
  type OnboardingStepState,
} from "@/domain/onboarding";

export type { OnboardingStepId, OnboardingStepMeta, OnboardingStepState } from "@/domain/onboarding";

/** `GET /api/onboarding` */
export type OnboardingResponse = { steps: OnboardingStepState[]; sampleAvailable: boolean };

/** `POST /api/onboarding/sample` */
export type SampleDataResult = {
  warehouseId: string;
  bomId: string;
  locations: { id: string; code: string; name: string; type: string }[];
  items: { id: string; sku: string; name: string; type: string }[];
};

/** A step as the checklist shows it: its copy, what the server counted, and whether this browser skipped it. */
export type OnboardingStepView = OnboardingStepMeta & { done: boolean; count: number; skipped: boolean };

/* ------------------------------------------------------------------ local flags (per org, per browser) */

const DISMISSED_KEY = (orgId: string) => `rackline.onboarding.dismissed:${orgId}`;
const SKIPPED_KEY = (orgId: string) => `rackline.onboarding.skipped:${orgId}`;

const listeners = new Set<() => void>();
/** Orgs whose checklist was reopened on purpose this session, so it shows even once it is complete. */
const reopened = new Set<string>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* Hiding and skipping are conveniences; without storage they last until reload. */
  }
}

/** Skipped ids are kept as a sorted, comma-joined string so the snapshot compares by value. */
function readSkipped(orgId: string): string {
  const raw = readFlag(SKIPPED_KEY(orgId));
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return "";
    return parsed
      .filter((id): id is OnboardingStepId => ONBOARDING_STEPS.some((step) => step.id === id && step.optional))
      .sort()
      .join(",");
  } catch {
    return "";
  }
}

/** `[dismissed, setDismissed]` for this org's checklist, kept in localStorage and shared across the page. */
export function useOnboardingDismissed(): [boolean, (dismissed: boolean) => void] {
  const orgId = useSession().organization.id;
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readFlag(DISMISSED_KEY(orgId)) === "1",
    () => false,
  );
  const setDismissed = useCallback(
    (next: boolean) => {
      if (next) reopened.delete(orgId);
      writeFlag(DISMISSED_KEY(orgId), next ? "1" : null);
      notify();
    },
    [orgId],
  );
  return [dismissed, setDismissed];
}

/** True while the checklist was reopened on purpose (palette, sidebar) and not hidden again. */
export function useOnboardingReopened(): boolean {
  const orgId = useSession().organization.id;
  return useSyncExternalStore(
    subscribe,
    () => reopened.has(orgId),
    () => false,
  );
}

/** Clear the hidden flag so the checklist shows on Today again, and tell every mounted checklist. */
export function reopenOnboarding(orgId: string): void {
  reopened.add(orgId);
  writeFlag(DISMISSED_KEY(orgId), null);
  notify();
}

/** Optional steps this browser skipped, with setters. Required steps cannot be skipped. */
export function useOnboardingSkipped(): {
  skipped: ReadonlySet<OnboardingStepId>;
  skip: (id: OnboardingStepId) => void;
  unskipAll: () => void;
} {
  const orgId = useSession().organization.id;
  const raw = useSyncExternalStore(
    subscribe,
    () => readSkipped(orgId),
    () => "",
  );
  const skipped = useMemo(() => new Set(raw ? (raw.split(",") as OnboardingStepId[]) : []), [raw]);
  const skip = useCallback(
    (id: OnboardingStepId) => {
      const next = new Set(readSkipped(orgId).split(",").filter(Boolean));
      next.add(id);
      writeFlag(SKIPPED_KEY(orgId), JSON.stringify([...next]));
      notify();
    },
    [orgId],
  );
  const unskipAll = useCallback(() => {
    writeFlag(SKIPPED_KEY(orgId), null);
    notify();
  }, [orgId]);
  return { skipped, skip, unskipAll };
}

/* ------------------------------------------------------------------ server state */

export function onboardingPath(warehouseId: string | null | undefined): string {
  return warehouseId ? `/api/onboarding?warehouseId=${encodeURIComponent(warehouseId)}` : "/api/onboarding";
}

/**
 * The checklist for the current org and warehouse. Owners only by default (operators never see the
 * checklist); pass `{ enabled: true }` to read it for anyone. Every write's `refreshApi()` refetches it,
 * so steps tick as soon as the work lands.
 */
export function useOnboarding(options?: { enabled?: boolean }) {
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const enabled = options?.enabled ?? me.role === "owner";
  const query = useApiQuery<OnboardingResponse>(enabled ? onboardingPath(warehouseId) : null);
  const { skipped, skip, unskipAll } = useOnboardingSkipped();
  const data = query.data;

  const steps = useMemo<OnboardingStepView[]>(() => {
    if (!data) return [];
    const byId = new Map(data.steps.map((step) => [step.id, step]));
    return ONBOARDING_STEPS.map((meta) => {
      const state = byId.get(meta.id);
      return {
        ...meta,
        done: !!state?.done,
        count: state?.count ?? 0,
        skipped: meta.optional && !state?.done && skipped.has(meta.id),
      };
    });
  }, [data, skipped]);

  const progress = useMemo(() => onboardingProgress(steps), [steps]);
  const next = useMemo(() => nextOnboardingStep(steps), [steps]);

  return {
    data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    /** Every step in order, including skipped ones (flagged). Empty until the first load. */
    steps,
    progress,
    /** Loaded and every required step done. */
    complete: !!data && progress.complete,
    /** Loaded, and at least one required step still open. */
    incomplete: !!data && !progress.complete,
    next,
    sampleAvailable: !!data?.sampleAvailable,
    skip,
    unskipAll,
  };
}

/** Load the sample catalog into a warehouse, then refresh whatever is on screen. */
export async function loadSampleData(warehouseId: string): Promise<SampleDataResult> {
  const result = await api<SampleDataResult>("/api/onboarding/sample", {
    method: "POST",
    body: JSON.stringify({ warehouseId }),
  });
  await refreshApi();
  return result;
}
