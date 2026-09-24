import { useSyncExternalStore } from "react";

function query(px: number): MediaQueryList | null {
  try {
    return window.matchMedia(`(min-width: ${px}px)`);
  } catch {
    return null;
  }
}

/** True when the viewport is at least `px` wide. Tracks resizes; assumes wide when there is no window. */
export function useMinWidth(px: number): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = query(px);
      if (!list) return () => {};
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => query(px)?.matches ?? true,
    () => true,
  );
}
