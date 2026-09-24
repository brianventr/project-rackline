import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { shouldAutoOpenTour, tourSeenKey, type TourStepId } from "@/domain/tour";
import { isGarageMode } from "@/domain/operating-mode";
import { useOnboarding } from "./onboarding";
import { useSession } from "./session";

export type { TourStepId } from "@/domain/tour";

/* ------------------------------------------------------------------ seen (per person, per org, per browser) */

const listeners = new Set<() => void>();

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

function readSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSeen(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* Without storage the tour can open again next visit; it is one click to close. */
  }
}

/** `[seen, markSeen]` for this person's tour in this org. */
export function useTourSeen(): [boolean, () => void] {
  const me = useSession();
  const key = tourSeenKey(me.organization.id, me.user.id);
  const seen = useSyncExternalStore(
    subscribe,
    () => readSeen(key),
    () => true,
  );
  const markSeen = useCallback(() => {
    writeSeen(key);
    notify();
  }, [key]);
  return [seen, markSeen];
}

/* ------------------------------------------------------------------ open state (one dialog, opened from anywhere) */

type TourRequest = { open: boolean; step: TourStepId | null; /** Bumps on every open so the dialog restarts at `step`. */ nonce: number };

let request: TourRequest = { open: false, step: null, nonce: 0 };
const openListeners = new Set<() => void>();

function subscribeOpen(listener: () => void) {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

function setRequest(next: TourRequest) {
  request = next;
  for (const listener of openListeners) listener();
}

/** Open the tour, at a step when one is named (a step this person does not have starts at the top). */
export function openTour(step?: TourStepId): void {
  setRequest({ open: true, step: step ?? null, nonce: request.nonce + 1 });
}

export function closeTour(): void {
  if (request.open) setRequest({ ...request, open: false });
}

export function useTourRequest(): TourRequest {
  return useSyncExternalStore(
    subscribeOpen,
    () => request,
    () => request,
  );
}

/* ------------------------------------------------------------------ opening on its own */

/**
 * Open the tour once for a new person on their home screen: an owner on Today while the Getting
 * started card is still open, an operator on the floor. Mount once, inside the app shell.
 */
export function useTourAutoOpen(): void {
  const me = useSession();
  const location = useLocation();
  const [seen] = useTourSeen();
  const owner = me.role === "owner";
  const onboarding = useOnboarding({ enabled: owner });
  const loaded = !!onboarding.data;
  const incomplete = onboarding.incomplete;

  useEffect(() => {
    if (
      !shouldAutoOpenTour({
        seen,
        role: me.role,
        pathname: location.pathname,
        onboarding: owner ? { loaded, incomplete } : null,
      })
    ) {
      return;
    }
    if (request.open) return;
    // Let the page paint first, so the dialog opens over Today or the floor rather than a blank shell.
    const handle = window.setTimeout(() => openTour(), 400);
    return () => window.clearTimeout(handle);
  }, [seen, me.role, owner, loaded, incomplete, location.pathname]);
}

/** What the tour needs to know about the person looking at it. */
export function useTourViewer(): { role: string; garage: boolean; owner: boolean } {
  const me = useSession();
  return { role: me.role, garage: isGarageMode(me.organization.operatingMode), owner: me.role === "owner" };
}
