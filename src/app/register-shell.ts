/** Register the floor shell worker. Dev stays on the network so the dev server is not cached. */
export function registerAppShell(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
