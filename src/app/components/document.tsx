import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusLabel } from "@/domain/status";
import { useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "./ui";
import { api, type Movement } from "../api";

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
    <ol className="flex flex-wrap gap-2">
      {steps.map((step, index) => {
        const done = currentIndex >= 0 && index <= currentIndex;
        const active = step === value;
        return (
          <li
            key={step}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide",
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
    <div className="space-y-4">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="uppercase">
              {statusLabel(status)}
            </Badge>
            {actions}
          </div>
        }
      />
      {status !== "cancelled" ? <StatusStepper steps={steps} current={status} /> : null}
    </div>
  );
}

export function DocumentRail({ children }: { children: ReactNode }) {
  return <aside className="space-y-4 lg:w-80">{children}</aside>;
}

export function DocumentFrame({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  return (
    <div className={cn("grid gap-6", rail ? "xl:grid-cols-[minmax(0,1fr)_20rem]" : "")}>
      <div className="space-y-4">{children}</div>
      {rail}
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
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-2 text-sm font-medium">Activity</p>
      {rows.length ? (
        <ul className="space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between gap-3">
              <span>
                <span className="font-mono text-xs uppercase text-muted-foreground">{row.type}</span> {row.sku}
              </span>
              <span className="font-mono tabular-nums">{row.qty}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No ledger lines for this document yet.</p>
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
      <p className="text-sm text-muted-foreground">
        This slot is reserved in the menu so it has a home when the shop outgrows the current loop.{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={backTo}>
          {backLabel}
        </Link>
      </p>
    </div>
  );
}
