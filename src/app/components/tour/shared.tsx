import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pathOnly } from "@/domain/operating-mode";

/** What the pictures need to know about the person looking at them (`useTourViewer()`). */
export type TourViewer = { role: string; garage: boolean; owner: boolean };

/** Closes the tour, marks it seen, then navigates. The dialog supplies it. */
export type NavigateTo = (path: string) => void;

/** Interactive things inside a picture: 44px tall on phones, compact from md up. */
export const TAP = "min-h-11 md:min-h-8";

export const FOCUS_RING = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** A key cap, like the shortcuts cheat sheet draws them. */
export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

/** A small phone outline for the floor pictures. */
export function MiniPhone({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn("mx-auto w-full max-w-[14rem] rounded-[1.25rem] border-2 bg-background p-1.5 shadow-xs", className)}
    >
      <div aria-hidden className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
      <div className="overflow-hidden rounded-[0.875rem] border bg-card">{children}</div>
    </div>
  );
}

/** "Open Locations", "Open Shelf map": the page name behind a hierarchy or flow link. */
export function pageLabel(path: string, garage: boolean): string {
  if (path.includes("edit=1")) return "Build floor";
  switch (pathOnly(path)) {
    case "/setup/team":
      return "Team";
    case "/setup/warehouse":
      return garage ? "Bench setup" : "Warehouse settings";
    case "/map":
      return garage ? "Shelf map" : "Map";
    case "/stock/locations":
      return "Locations";
    case "/stock/items":
      return "Items";
    case "/stock":
      return "On hand";
    case "/stock/ledger":
      return "Ledger";
    case "/outbound/orders":
      return "Orders";
    case "/inbound/receipts":
      return "Receipts";
    case "/make/recipes":
      return "Recipes";
    case "/floor":
      return "the floor";
    default:
      return "page";
  }
}
