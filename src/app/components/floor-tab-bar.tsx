import type { ComponentType, MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ClipboardList, ListChecks, ScanLine, Search } from "lucide-react";
import { useScanner } from "@/app/scanner/ScannerProvider";
import { focusScanCapture } from "@/app/scanner/scan-capture";
import { cn } from "@/lib/utils";

export { focusScanCapture };

/** Anchors on the floor launcher the bar jumps to. */
export const FLOOR_ANCHORS = { next: "next", mine: "mine" } as const;
export type FloorAnchor = (typeof FLOOR_ANCHORS)[keyof typeof FLOOR_ANCHORS];

/** Height of the bar without the safe area, for spacers and toasts. */
export const FLOOR_TAB_BAR_HEIGHT = "4rem";

export function isFloorPath(pathname: string): boolean {
  return pathname === "/floor" || pathname.startsWith("/floor/");
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** Scroll a launcher anchor into view under the sticky header. Returns false when it is not on screen yet. */
export function scrollToFloorAnchor(id: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  return true;
}

type TabId = "next" | "scan" | "mine" | "lookup";

type Tab = {
  id: TabId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  to?: string;
};

const TABS: Tab[] = [
  { id: "next", label: "Next job", icon: ListChecks, to: `/floor#${FLOOR_ANCHORS.next}` },
  { id: "scan", label: "Scan", icon: ScanLine },
  { id: "mine", label: "My jobs", icon: ClipboardList, to: `/floor#${FLOOR_ANCHORS.mine}` },
  { id: "lookup", label: "Lookup", icon: Search, to: "/floor/lookup" },
];

function activeTab(pathname: string, hash: string, cameraOpen: boolean): TabId | null {
  if (cameraOpen) return "scan";
  if (pathname === "/floor" || pathname === "/floor/") return hash === `#${FLOOR_ANCHORS.mine}` ? "mine" : "next";
  if (pathname.startsWith("/floor/lookup")) return "lookup";
  return null;
}

/**
 * Persistent floor dock: reachable on a phone, an iPad in either orientation, or a workbench.
 */
export function FloorTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const scanner = useScanner();

  if (!isFloorPath(location.pathname)) return null;
  const active = activeTab(location.pathname, location.hash, scanner.cameraOpen);
  // Only a camera that can open: none on the device, or access denied, goes to the scan field.
  const camera = scanner.inputMode !== "accessory" && scanner.cameraSupported && !scanner.cameraBlocked;

  function onScan() {
    if (camera) {
      scanner.openCamera();
      return;
    }
    if (focusScanCapture()) return;
    // No camera and no scan field here: Lookup has one and focuses it on open.
    navigate("/floor/lookup");
  }

  function onAnchor(event: MouseEvent<HTMLAnchorElement>, anchor: FloorAnchor) {
    const onLauncher = location.pathname === "/floor" || location.pathname === "/floor/";
    // Same URL: the router will not re-render, so scroll here.
    if (onLauncher && location.hash === `#${anchor}`) {
      event.preventDefault();
      scrollToFloorAnchor(anchor);
    }
  }

  const itemClass = (on: boolean) =>
    cn(
      "relative flex h-16 w-full touch-manipulation flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none transition-colors sm:flex-row sm:gap-2 sm:text-sm",
      "focus-visible:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
      on ? "text-primary" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <nav
      aria-label="Floor"
      data-slot="floor-tab-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur supports-[backdrop-filter]:bg-background/85 print:hidden"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-4">
        {TABS.map((tab) => {
          const on = active === tab.id;
          const indicator = on ? (
            <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-primary" />
          ) : null;
          const icon =
            tab.id === "scan" ? (
              <span
                aria-hidden
                className={cn(
                  "flex h-7 w-11 items-center justify-center rounded-full",
                  on ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                )}
              >
                <tab.icon className="size-5" />
              </span>
            ) : (
              <span aria-hidden className="flex h-7 items-center justify-center">
                <tab.icon className="size-5" />
              </span>
            );
          return (
            <li key={tab.id}>
              {tab.to ? (
                <Link
                  to={tab.to}
                  aria-current={on ? "page" : undefined}
                  className={itemClass(on)}
                  onClick={
                    tab.id === "next" || tab.id === "mine" ? (event) => onAnchor(event, tab.id as FloorAnchor) : undefined
                  }
                >
                  {indicator}
                  {icon}
                  <span>{tab.label}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onScan}
                  aria-label={camera ? "Scan with the camera" : "Scan"}
                  className={itemClass(on)}
                >
                  {indicator}
                  {icon}
                  <span aria-hidden>{tab.label}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
