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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1 font-mono text-xs uppercase tracking-[0.18em] text-muted">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(27,23,18,0.04)] ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  children,
  type = "button",
  variant = "primary",
  disabled,
  onClick,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const styles = {
    primary: "bg-amber text-ink hover:brightness-105",
    secondary: "bg-ink text-paper hover:bg-bay",
    danger: "bg-bad text-white hover:brightness-110",
    ghost: "bg-transparent text-ink border border-line hover:bg-paper",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
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
      <label htmlFor={id} className="mb-1.5 block font-medium text-ink/80">
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}

const controlClass =
  "w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm outline-none ring-amber/40 focus:ring-2";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${controlClass} ${props.className ?? ""}`} />;
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "received" ||
    status === "shipped" ||
    status === "completed" ||
    status === "posted" ||
    status === "synced" ||
    status === "ok" ||
    status === "demo"
      ? "bg-ok/15 text-ok"
      : status === "picked" || status === "inbound" || status === "pending_fulfill" || status === "live"
        ? "bg-amber/20 text-warn"
        : status === "cancelled" || status === "failed"
          ? "bg-bad/15 text-bad"
          : "bg-line text-ink";
  return (
    <span className={`rounded-full px-2.5 py-0.5 font-mono text-xs uppercase tracking-wide ${tone}`}>
      {status}
    </span>
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
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-paper/80 font-medium text-muted">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-4 py-3 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mb-4 rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
      {error}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
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
