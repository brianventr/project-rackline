import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusLabel } from "@/domain/status";
import { useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "./ui";
import { api, type Movement } from "../api";
import { formatCatchWeight } from "@/domain/catch-weight";
import { formatExpiresOn } from "@/domain/expiry";

export function StatusStepper({
  steps,
  current,
}: {
  steps: readonly string[];
  current: string;
}) {
  const value = current === "draft" && steps[0] === "open" ? "open" : current;
  const currentIndex = steps.indexOf(value);
  return (
    <ol className="flex min-w-0 flex-wrap overflow-hidden rounded-md border text-[10px] font-medium uppercase tracking-wide">
      {steps.map((step, index) => {
        const done = currentIndex >= 0 && index <= currentIndex;
        const active = step === value;
        return (
          <li
            key={step}
            className={cn(
              "border-r px-2 py-0.5 last:border-r-0",
              active
                ? "bg-primary text-primary-foreground"
                : done
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {statusLabel(step)}
          </li>
        );
      })}
    </ol>
  );
}

export function DocumentHeader({
  eyebrow,
  title,
  description,
  status,
  steps,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  status: string;
  steps: readonly string[];
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <PageHeader eyebrow={eyebrow} title={title} description={description} />
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium uppercase tracking-normal">
          {statusLabel(status)}
        </Badge>
        {status !== "cancelled" ? <StatusStepper steps={steps} current={status} /> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function DocumentRail({ children }: { children: ReactNode }) {
  return <aside className="w-full min-w-0 space-y-2 xl:w-96">{children}</aside>;
}

export function DocumentFrame({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  return (
    <div className={cn("grid min-h-0 flex-1 gap-3", rail ? "xl:grid-cols-[minmax(0,1fr)_24rem]" : "")}>
      <div className="min-w-0 space-y-3">{children}</div>
      {rail}
    </div>
  );
}

export function DocumentFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm">{children}</span>
    </div>
  );
}

export function DocumentActionGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0 [&>*]:w-full [&>*:last-child:nth-child(odd)]:col-span-2">
      {children}
    </div>
  );
}

export function DocumentActivity({ refId, refreshKey }: { refId: string; refreshKey?: string | number }) {
  const [rows, setRows] = useState<Movement[]>([]);
  useEffect(() => {
    api<Movement[]>(`/api/movements?refId=${encodeURIComponent(refId)}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [refId, refreshKey]);
  return (
    <div className="rounded-md border bg-card p-2.5">
      <p className="mb-1.5 text-xs font-medium">Activity</p>
      {rows.length ? (
        <ul className="space-y-1 text-xs">
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between gap-3">
              <span>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">{row.type}</span> {row.sku}
                {row.createdByName ? ` · ${row.createdByName}` : ""}
              </span>
              <span className="font-mono tabular-nums">
                {row.qty}
                {row.weightGrams ? ` · ${formatCatchWeight(row.weightGrams)}` : ""}
                {row.lotCode ? ` · ${row.lotCode}` : ""}
                {row.expiresOn ? ` · ${formatExpiresOn(row.expiresOn)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No ledger lines for this document yet.</p>
      )}
    </div>
  );
}

export function ComingSoonPage({
  eyebrow,
  title,
  body,
  backTo,
  backLabel,
}: {
  eyebrow: string;
  title: string;
  body: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} description={body} />
      <p className="text-xs text-muted-foreground">
        This slot is reserved in the menu so it has a home when the shop outgrows the current loop.{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={backTo}>
          {backLabel}
        </Link>
      </p>
    </div>
  );
}
