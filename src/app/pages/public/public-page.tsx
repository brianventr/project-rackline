import { useEffect, type ReactNode } from "react";
import { Package } from "lucide-react";
import type { PublicTrackingEvent } from "../../api";
import { brandInk } from "@/domain/branding";
import type { StatusTone } from "@/domain/status";
import { cn } from "@/lib/utils";

/** Keeps customer pages out of search results; the token in the URL is the only key. */
export function useNoIndex(title: string | null) {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

export type PublicShop = { name: string; brandColor: string | null; logoUrl: string | null };

/** The shop's header bar and a narrow column, for pages customers open from a link. */
export function PublicShell({ shop, children }: { shop: PublicShop | null; children: ReactNode }) {
  const color = shop?.brandColor ?? null;
  return (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <header
        className={cn("border-b print:hidden", color ? "" : "bg-card")}
        style={color ? { backgroundColor: color, color: brandInk(color) } : undefined}
      >
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-4">
          {shop?.logoUrl ? (
            <img
              src={shop.logoUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-9 max-w-40 object-contain"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <span className="truncate text-base font-semibold">{shop?.name ?? ""}</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}

export function PublicMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-card p-6 text-center shadow-xs">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function PublicLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 text-muted-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  );
}

export function trackerTone(status: string | null): StatusTone {
  if (status === "delivered") return "success";
  if (status === "exception") return "danger";
  if (status === "in_transit") return "progress";
  return "info";
}

/** Carrier updates, newest first. */
export function EventTimeline({ events }: { events: PublicTrackingEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="space-y-3 border-l pl-4">
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="relative">
          <span
            aria-hidden
            className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card ${index === 0 ? "bg-primary" : "bg-muted-foreground/40"}`}
          />
          <p className="text-sm font-medium">{event.label}</p>
          {event.message && event.message !== event.label ? (
            <p className="text-sm text-muted-foreground">{event.message}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {formatMoment(event.at)}
            {event.place ? ` · ${event.place}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ItemList({
  items,
  title,
  bare = false,
  className,
}: {
  items: { name: string; qty: number }[];
  title: string;
  bare?: boolean;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className={cn(bare ? "space-y-2 border-t pt-3" : "space-y-2 rounded-lg border bg-card p-4 shadow-xs", className)}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Package className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </h2>
      <ul className="divide-y text-sm">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate">{item.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">× {item.qty}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function formatDay(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function formatMoment(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
