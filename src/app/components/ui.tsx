import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Link } from "react-router-dom";
import { Button as UiButton } from "@/components/ui/button";
import { Card as UiCard, CardContent } from "@/components/ui/card";
import { Input as UiInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table as UiTable,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const heading = eyebrow ? `${eyebrow} · ${title}` : title;
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
      <h1 className="text-sm font-semibold tracking-tight" title={description}>
        {heading}
      </h1>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <UiCard className={cn("py-0", className)}>
      <CardContent className="p-3">{children}</CardContent>
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
}: {
  children: ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  asChild?: boolean;
}) {
  const mapped =
    variant === "primary"
      ? "default"
      : variant === "danger"
        ? "destructive"
        : variant === "ghost"
          ? "outline"
          : "secondary";
  return (
    <UiButton
      type={asChild ? undefined : type}
      variant={mapped}
      size={size}
      disabled={disabled}
      onClick={onClick}
      className={className}
      asChild={asChild}
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
        "border-input h-7 w-full rounded-md border bg-transparent px-2 py-0.5 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        props.className,
      )}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "received" ||
    status === "shipped" ||
    status === "completed" ||
    status === "posted" ||
    status === "packed" ||
    status === "synced" ||
    status === "ok" ||
    status === "demo"
      ? "default"
      : status === "cancelled" || status === "failed"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className="h-5 px-1.5 text-[10px] uppercase">
      {status}
    </Badge>
  );
}

export function Table({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:px-2.5">
      <UiTable className="text-xs">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col}>{col}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </UiTable>
    </div>
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
    <div className={cn("flex flex-nowrap items-stretch overflow-x-auto border-b bg-card", className)}>
      {items.map((item) => {
        const quiet = item.value === 0 || item.value === "—" || item.value === "0";
        const toneClass =
          quiet || !item.tone || item.tone === "default"
            ? "text-foreground"
            : item.tone === "bad"
              ? "text-destructive"
              : item.tone === "ok"
                ? "text-ok"
                : "text-amber-600 dark:text-chart-4";
        const content = (
          <div className="min-w-[4.75rem] shrink-0 px-2.5 py-1.5">
            <p className="whitespace-nowrap text-[10px] leading-none uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p className={cn("mt-0.5 text-sm font-semibold tabular-nums leading-tight", toneClass)}>{item.value}</p>
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

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
      {error}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed px-4 py-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
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
