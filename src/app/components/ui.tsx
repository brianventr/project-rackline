import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type ComponentProps,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Inbox, type LucideIcon } from "lucide-react";
import { Button as UiButton } from "@/components/ui/button";
import { Card as UiCard } from "@/components/ui/card";
import { Input as UiInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table as UiTable,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { statusText, statusTone, type StatusTone } from "@/domain/status";
import { splitErrorText } from "../api";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  /** A sentence on what the page is for. May hold a `<Term>`. */
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground print:text-[10px] print:tracking-wide">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-(length:--density-title) font-semibold leading-tight tracking-tight">{title}</h1>
        {description ? (
          <p
            className="mt-0.5 line-clamp-2 max-w-3xl text-(length:--density-meta) text-muted-foreground"
            title={typeof description === "string" ? description : undefined}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A padded surface. `className` lands on the card itself, so both layout (`col-span-2`) and spacing (`space-y-3`) work. */
export function Card({ children, className = "", ...props }: ComponentProps<"div">) {
  return (
    <UiCard {...props} className={cn("block gap-0 p-(--density-gap)", className)}>
      {children}
    </UiCard>
  );
}

export function Button({
  children,
  type = "button",
  variant = "primary",
  size = "default",
  disabled,
  onClick,
  className,
  asChild,
  title,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  /** `secondary` renders as an outline so only the primary action is filled. */
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  asChild?: boolean;
  title?: string;
  "aria-label"?: string;
}) {
  const mapped =
    variant === "primary" ? "default" : variant === "danger" ? "destructive" : "outline";
  return (
    <UiButton
      type={asChild ? undefined : type}
      variant={mapped}
      size={size}
      disabled={disabled}
      onClick={onClick}
      className={className}
      asChild={asChild}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </UiButton>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="block text-sm">
      <Label htmlFor={id} className="mb-1">
        {label}
      </Label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <UiInput ref={ref} className={cn("h-8 text-sm", className)} {...props} />;
});

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "border-input h-8 w-full rounded-md border bg-card px-2 py-0.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        props.className,
      )}
    />
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral",
  info: "bg-tone-info-bg text-tone-info",
  progress: "bg-tone-progress-bg text-tone-progress",
  success: "bg-tone-success-bg text-tone-success",
  warning: "bg-tone-warning-bg text-tone-warning",
  danger: "bg-tone-danger-bg text-tone-danger",
};

export function toneClass(tone: StatusTone): string {
  return TONE_CLASS[tone];
}

/** A soft pill with a dot. Colour comes from the status family, so finished work reads green. */
export function ToneBadge({
  tone,
  children,
  className,
  dot = true,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-medium leading-none",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {/* Sentence case without title-casing names like "West shop". */}
      {typeof children === "string" ? children.charAt(0).toUpperCase() + children.slice(1) : children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <ToneBadge tone={statusTone(status)} className={cn("normal-case", className)}>
      {statusText(status)}
    </ToneBadge>
  );
}

/** Container classes shared by every data table so density applies everywhere. */
export const TABLE_FRAME =
  "min-h-0 flex-1 overflow-auto rounded-lg border bg-card shadow-xs [&_td]:px-(--density-cell) [&_td]:py-(--density-row) [&_td]:text-(length:--density-text) [&_th]:h-auto [&_th]:px-(--density-cell) [&_th]:py-(--density-row)";

export function Table({
  columns,
  children,
  loading,
}: {
  columns: string[];
  children: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className={TABLE_FRAME}>
      <UiTable>
        <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
          <TableRow className="hover:bg-transparent">
            {columns.map((col, index) => (
              <TableHead key={`${col}:${index}`} className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{loading ? <SkeletonRows columns={columns.length} /> : children}</TableBody>
      </UiTable>
    </div>
  );
}

export function SkeletonRows({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <TableRow key={row} className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, col) => (
            <td key={col}>
              <Skeleton className={cn("h-4", col === 0 ? "w-20" : col % 3 === 0 ? "w-12" : "w-full max-w-40")} />
            </td>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function StatStrip({
  items,
  className,
}: {
  items: {
    label: string;
    value: ReactNode;
    to?: string;
    tone?: "default" | "warn" | "bad" | "ok";
  }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-nowrap items-stretch divide-x overflow-x-auto rounded-lg border bg-card shadow-xs", className)}>
      {items.map((item) => {
        const quiet = item.value === 0 || item.value === "—" || item.value === "0";
        const toneClass =
          quiet || !item.tone || item.tone === "default"
            ? "text-foreground"
            : item.tone === "bad"
              ? "text-destructive"
              : item.tone === "ok"
                ? "text-ok"
                : "text-tone-warning";
        const content = (
          <div className="min-w-[5.5rem] shrink-0 px-3 py-2">
            <p className="whitespace-nowrap text-[11px] leading-none uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p className={cn("mt-1 text-lg font-semibold tabular-nums leading-tight", toneClass)}>{item.value}</p>
          </div>
        );
        return item.to ? (
          <Link key={item.label} to={item.to} className="hover:bg-muted/60">
            {content}
          </Link>
        ) : (
          <div key={item.label}>{content}</div>
        );
      })}
    </div>
  );
}

/** Shows a failure. When the text came from an `ApiError` with a fix, the fix gets its own line. */
export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  const { message, hint } = splitErrorText(error);
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      {hint ? (
        <span className="min-w-0">
          <span className="block font-medium">{message}</span>
          <span className="block">{hint}</span>
        </span>
      ) : (
        <span className="min-w-0">{error}</span>
      )}
    </div>
  );
}

export function DoneBanner({ children, className }: { children?: ReactNode; className?: string }) {
  if (children == null || children === false || children === "") return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-tone-success/25 bg-tone-success-bg px-3 py-2 text-sm text-tone-success",
        className,
      )}
    >
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed bg-card/50 px-6 py-10 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function onSubmit(handler: () => Promise<void>) {
  return async (event: FormEvent) => {
    event.preventDefault();
    await handler();
  };
}

export function summarizeLines(lines?: { sku: string; qty: number }[]): string {
  if (!lines?.length) return "—";
  return lines.map((line) => `${line.sku} × ${line.qty}`).join(", ");
}
