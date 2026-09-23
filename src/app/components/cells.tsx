import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/domain/relative-time";
import { SkuThumb } from "./sku-thumb";

/** Document number link in the first column. Mono so numbers line up. */
export function DocLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn("whitespace-nowrap font-mono font-medium text-foreground hover:text-primary hover:underline", className)}
    >
      {children}
    </Link>
  );
}

/** `LAMP ×2` chips, then `+3 more`. */
export function LineChips({
  lines,
  max = 2,
}: {
  lines?: { sku: string; qty: number }[] | null;
  max?: number;
}) {
  if (!lines?.length) return <span className="text-muted-foreground">—</span>;
  const shown = lines.slice(0, max);
  const rest = lines.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1" title={lines.map((line) => `${line.sku} × ${line.qty}`).join(", ")}>
      {shown.map((line, index) => (
        <span
          key={`${line.sku}:${index}`}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-px font-mono text-[11px] leading-4"
        >
          {line.sku}
          <span className="text-muted-foreground">×{line.qty}</span>
        </span>
      ))}
      {rest > 0 ? <span className="text-[11px] text-muted-foreground">+{rest} more</span> : null}
    </span>
  );
}

/** `3/8` with a thin bar. Complete turns green; nothing done stays grey. */
export function ProgressCell({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const complete = total > 0 && done >= total;
  return (
    <span className={cn("flex min-w-20 items-center gap-2", className)} title={`${done} of ${total}`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", complete ? "bg-tone-success" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
    </span>
  );
}

/** Label, `done/total`, and a full-width bar. For record side panels (picked, received, completed). */
export function ProgressRow({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">
          {done}/{total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-tone-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function RelativeTime({ at, className }: { at: number | null | undefined; className?: string }) {
  if (!at) return <span className="text-muted-foreground">—</span>;
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={new Date(at).toLocaleString()}
      className={cn("whitespace-nowrap text-muted-foreground", className)}
    >
      {relativeTime(at)}
    </time>
  );
}

/** Thumbnail, SKU, and name in one cell. */
export function SkuCell({
  sku,
  name,
  imageUrl,
  to,
}: {
  sku: string;
  name?: string | null;
  imageUrl?: string | null;
  to?: string;
}) {
  const label = (
    <span className="min-w-0">
      <span className="block truncate font-mono text-[13px] font-medium">{sku}</span>
      {name ? <span className="block truncate text-xs text-muted-foreground">{name}</span> : null}
    </span>
  );
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SkuThumb sku={sku} name={name} imageUrl={imageUrl} size="sm" />
      {to ? (
        <Link to={to} className="min-w-0 hover:text-primary hover:underline">
          {label}
        </Link>
      ) : (
        label
      )}
    </span>
  );
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Round initials badge for a person. */
export function PersonAvatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      title={name ?? "Unassigned"}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        name ? "bg-secondary text-secondary-foreground" : "border border-dashed text-muted-foreground",
        className,
      )}
    >
      {name ? initialsOf(name) : "?"}
    </span>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
