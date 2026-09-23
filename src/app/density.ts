import { useCallback, useSyncExternalStore } from "react";

export type Density = "comfortable" | "compact";

const STORAGE_KEY = "rackline-density";
const listeners = new Set<() => void>();

function readStored(): Density {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

let current: Density = typeof window === "undefined" ? "comfortable" : readStored();

function apply(density: Density) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = density;
}

/** Call once before first render so the page never flashes the wrong row height. */
export function applyStoredDensity() {
  current = readStored();
  apply(current);
}

export function setDensity(density: Density) {
  current = density;
  apply(density);
  try {
    window.localStorage.setItem(STORAGE_KEY, density);
  } catch {
    /* Private windows can refuse storage; the choice still holds for this tab. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Comfortable is the default; Compact is the dense console some power users prefer. Per browser. */
export function useDensity(): [Density, (density: Density) => void] {
  const density = useSyncExternalStore(
    subscribe,
    () => current,
    () => "comfortable" as Density,
  );
  const set = useCallback((next: Density) => setDensity(next), []);
  return [density, set];
}
