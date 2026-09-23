import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  Cog,
  Hammer,
  Loader2,
  MoreHorizontal,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  SlidersHorizontal,
  Trash2,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { statusLabel } from "@/domain/status";
import { relativeTime } from "@/domain/relative-time";
import { stepStamps, type StepRule, type StepStamp } from "@/domain/step-stamps";
import { toast } from "sonner";
import { PageHeader, StatusBadge } from "./ui";
import { type Movement } from "../api";
import { useApiQuery } from "../query";
import { useConfirm, type ConfirmOptions } from "./confirm";
import { formatCatchWeight } from "@/domain/catch-weight";
import { formatExpiresOn } from "@/domain/expiry";

function formatStamp(stamp: StepStamp): string {
  const time = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(stamp.at),
  );
  return stamp.by ? `${stamp.by} · ${time}` : time;
}

export function StatusStepper({
  steps,
  current,
  stamps,
}: {
  steps: readonly string[];
  current: string;
  stamps?: Record<string, StepStamp>;
}) {
  const value = current === "draft" && steps[0] === "open" ? "open" : current;
  const currentIndex = steps.indexOf(value);
  return (
    <ol aria-label="Progress" className="flex min-w-0 items-start overflow-x-auto pb-1">
      {steps.map((step, index) => {
        const done = currentIndex >= 0 && index < currentIndex;
        const active = index === currentIndex;
        const finalDone = active && index === steps.length - 1;
        const stamp = stamps?.[step];
        return (
          <li key={step} className="flex min-w-[5.5rem] flex-1 items-start last:flex-none" aria-current={active ? "step" : undefined}>
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    done || finalDone
                      ? "border-tone-success bg-tone-success text-white dark:text-background"
                      : active
                        ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/15"
                        : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {done || finalDone ? <Check className="size-3" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap text-xs font-medium capitalize",
                    active ? "text-foreground" : done ? "text-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {statusLabel(step)}
                </span>
              </div>
              {stamp ? (
                <span className="pl-7 text-[11px] whitespace-nowrap text-muted-foreground" title={new Date(stamp.at).toLocaleString()}>
                  {formatStamp(stamp)}
                </span>
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn("mx-2 mt-2.5 h-px min-w-4 flex-1", done ? "bg-tone-success" : "bg-border")}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** One thing a person can do from a record header or its More menu. */
export type DocumentAction = {
  label: string;
  icon?: LucideIcon;
  /** Navigate instead of running a handler. */
  to?: string;
  onSelect?: () => unknown;
  /** Danger items render red and sit at the bottom of the menu. */
  tone?: "danger";
  /** Ask before running. Danger actions should always confirm. */
  confirm?: ConfirmOptions;
  disabled?: boolean;
  /** Toast shown after `onSelect` resolves. */
  success?: string;
};

function useRunAction() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(action: DocumentAction) {
    if (action.confirm && !(await confirm(action.confirm))) return;
    if (action.to) {
      navigate(action.to);
      return;
    }
    if (!action.onSelect) return;
    setBusy(action.label);
    try {
      await action.onSelect();
      if (action.success) toast.success(action.success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action.label} failed`);
    } finally {
      setBusy(null);
    }
  }
  return { run, busy };
}

export function ActionButton({
  action,
  variant = "default",
  size = "sm",
  className,
}: {
  action: DocumentAction;
  variant?: "default" | "outline" | "secondary" | "destructive" | "ghost";
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const { run, busy } = useRunAction();
  const Icon = action.icon;
  const content = (
    <>
      {busy ? <Loader2 className="animate-spin" /> : Icon ? <Icon /> : null}
      {action.label}
    </>
  );
  if (action.to && !action.confirm) {
    return (
      <Button asChild size={size} variant={action.tone === "danger" ? "destructive" : variant} className={className}>
        <Link to={action.to}>{content}</Link>
      </Button>
    );
  }
  return (
    <Button
      size={size}
      variant={action.tone === "danger" ? "destructive" : variant}
      className={className}
      disabled={action.disabled || !!busy}
      onClick={() => void run(action)}
    >
      {content}
    </Button>
  );
}

export function ActionMenu({ actions, label = "More actions" }: { actions: DocumentAction[]; label?: string }) {
  const { run, busy } = useRunAction();
  const safe = actions.filter((action) => action.tone !== "danger");
  const danger = actions.filter((action) => action.tone === "danger");
  if (!actions.length) return null;
  const item = (action: DocumentAction) => {
    const Icon = action.icon;
    return (
      <DropdownMenuItem
        key={action.label}
        disabled={action.disabled || !!busy}
        variant={action.tone === "danger" ? "destructive" : "default"}
        // Let the menu finish closing before a confirm dialog takes focus.
        onSelect={() => window.setTimeout(() => void run(action), 0)}
        className="cursor-pointer"
      >
        {Icon ? <Icon /> : null}
        {action.label}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" aria-label={label}>
          {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          <span className="hidden sm:inline">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {safe.map(item)}
        {safe.length && danger.length ? <DropdownMenuSeparator /> : null}
        {danger.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {items.map((item, index) => (
        <span key={`${item.label}:${index}`} className="flex min-w-0 items-center gap-1">
          {index > 0 ? <ChevronRight className="size-3 shrink-0 opacity-60" /> : null}
          {item.to ? (
            <Link to={item.to} className="truncate hover:text-foreground hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="truncate">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Ledger lines for a document. Shared by the stepper stamps and the activity timeline (one fetch). */
export function useDocumentMovements(refId: string | null | undefined) {
  return useApiQuery<Movement[]>(refId ? `/api/movements?refId=${encodeURIComponent(refId)}` : null);
}

export function DocumentHeader({
  eyebrow,
  title,
  description,
  status,
  steps,
  actions,
  list,
  primary,
  menu,
  refId,
  stampRules,
  meta,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  status: string;
  steps: readonly string[];
  /** Legacy free-form buttons. Prefer `primary` + `menu`. */
  actions?: ReactNode;
  /** The list this record belongs to, shown as a breadcrumb. */
  list?: { label: string; to: string };
  /** The one next step. Renders as the only filled button. */
  primary?: DocumentAction | null;
  /** Everything else, in a More menu. Danger items sit last, in red. */
  menu?: (DocumentAction | null | false | undefined)[];
  /** Document id whose ledger lines stamp the stepper with who and when. */
  refId?: string;
  stampRules?: Partial<Record<string, StepRule>>;
  /** Small facts beside the title (channel, client, due date). */
  meta?: ReactNode;
}) {
  const movements = useDocumentMovements(refId && stampRules ? refId : null);
  const current = status === "draft" && steps[0] === "open" ? "open" : status;
  const stamps = stampRules ? stepStamps(steps, current, movements.data ?? [], stampRules) : undefined;
  const menuActions = (menu ?? []).filter(Boolean) as DocumentAction[];
  const inSteps = steps.includes(current);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {list ? <Breadcrumbs items={[{ label: eyebrow }, { label: list.label, to: list.to }, { label: title }]} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <PageHeader eyebrow={list ? undefined : eyebrow} title={title} />
            {!inSteps ? <StatusBadge status={status} /> : null}
            {meta}
          </div>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          {menuActions.length ? <ActionMenu actions={menuActions} /> : null}
          {primary ? <ActionButton action={primary} /> : null}
        </div>
      </div>
      {inSteps && status !== "cancelled" ? (
        <div className="rounded-lg border bg-card px-4 py-3 shadow-xs">
          <StatusStepper steps={steps} current={current} stamps={stamps} />
        </div>
      ) : null}
    </div>
  );
}

/** Placeholder while a record loads, shaped like header + stepper + body + rail. */
export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-56" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function DocumentRail({ children }: { children: ReactNode }) {
  return <aside className="w-full min-w-0 space-y-3 xl:w-96">{children}</aside>;
}

export function DocumentFrame({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  return (
    <div className={cn("grid min-h-0 flex-1 gap-4", rail ? "xl:grid-cols-[minmax(0,1fr)_24rem]" : "")}>
      <div className="min-w-0 space-y-4">{children}</div>
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

const MOVEMENT_ICON: Record<string, LucideIcon> = {
  receive: ArrowDownToLine,
  unreceive: Undo2,
  move: ArrowRightLeft,
  pick: PackageMinus,
  unpick: Undo2,
  ship: Truck,
  adjust: SlidersHorizontal,
  scrap: Trash2,
  rtv: ArrowUpFromLine,
  wo_consume: Cog,
  wo_produce: Hammer,
  kit_consume: Cog,
  kit_produce: PackagePlus,
  pack: PackageCheck,
};

const MOVEMENT_VERB: Record<string, string> = {
  receive: "Received",
  unreceive: "Unreceived",
  move: "Moved",
  pick: "Picked",
  unpick: "Unpicked",
  ship: "Shipped",
  adjust: "Adjusted",
  scrap: "Scrapped",
  rtv: "Returned to vendor",
  wo_consume: "Consumed",
  wo_produce: "Produced",
  kit_consume: "Consumed",
  kit_produce: "Built",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function MovementTimeline({ rows, empty }: { rows: Movement[]; empty?: string }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">{empty ?? "No ledger lines yet."}</p>;
  }
  const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-3 before:w-px before:bg-border">
      {sorted.map((row) => {
        const Icon = MOVEMENT_ICON[row.type] ?? ArrowRightLeft;
        const route = [row.fromLocationCode, row.toLocationCode].filter(Boolean).join(" → ");
        const extras = [
          row.lotCode,
          row.weightGrams ? formatCatchWeight(row.weightGrams) : null,
          row.expiresOn ? formatExpiresOn(row.expiresOn) : null,
          row.equipmentCode,
        ].filter(Boolean);
        return (
          <li key={row.id} className="relative flex gap-3">
            <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="leading-snug">
                <span className="font-medium">{MOVEMENT_VERB[row.type] ?? statusLabel(row.type)}</span>{" "}
                <span className="font-mono tabular-nums">{Math.abs(row.qty)}</span> × <span className="font-mono">{row.sku}</span>
                {route ? <span className="text-muted-foreground"> · {route}</span> : null}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                {row.createdByName ? (
                  <>
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-foreground">
                      {initials(row.createdByName)}
                    </span>
                    <span>{row.createdByName}</span>
                    <span aria-hidden>·</span>
                  </>
                ) : null}
                <time dateTime={new Date(row.createdAt).toISOString()} title={new Date(row.createdAt).toLocaleString()}>
                  {relativeTime(row.createdAt)}
                </time>
                {extras.length ? <span className="font-mono">· {extras.join(" · ")}</span> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function DocumentActivity({ refId, refreshKey }: { refId: string; refreshKey?: string | number }) {
  const movements = useDocumentMovements(refId);
  const { refetch } = movements;
  useEffect(() => {
    if (refreshKey !== undefined) void refetch();
  }, [refreshKey, refetch]);
  return (
    <div className="rounded-lg border bg-card p-4 shadow-xs">
      <p className="mb-3 text-sm font-medium">Activity</p>
      {movements.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <MovementTimeline rows={movements.data ?? []} empty="No ledger lines for this document yet." />
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
