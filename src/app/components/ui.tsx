import {
  cloneElement,
  isValidElement,
  useId,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
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
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <UiCard className={cn("py-0", className)}>
      <CardContent className="p-5">{children}</CardContent>
    </UiCard>
  );
}

export function Button({
  children,
  type = "button",
  variant = "primary",
  disabled,
  onClick,
  className,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
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
    <UiButton type={type} variant={mapped} disabled={disabled} onClick={onClick} className={className}>
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
      <Label htmlFor={id} className="mb-1.5">
        {label}
      </Label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <UiInput {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
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
    status === "synced" ||
    status === "ok" ||
    status === "demo"
      ? "default"
      : status === "cancelled" || status === "failed"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className="uppercase">
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
    <div className="overflow-hidden rounded-xl border bg-card">
      <UiTable>
        <TableHeader>
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

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
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
