import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useScanner } from "../../scanner/ScannerProvider";
import { Button, Card, ErrorBanner, Input } from "../../components/ui";
import type { FloorJob } from "../../api";
import { claimedByMessage, jobClaimedByOther, splitByClaim } from "../../jobs";

export function FloorScanBox({
  label,
  placeholder,
  onScan,
}: {
  label: string;
  placeholder: string;
  onScan: (raw: string) => void;
}) {
  const scanner = useScanner();
  const [value, setValue] = useState("");
  const handledAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const scan = scanner.lastScan;
    if (!scan || scan.at === handledAt.current) return;
    handledAt.current = scan.at;
    setValue(scan.raw);
    onScan(scan.raw);
  }, [scanner.lastScan, onScan]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onScan(value.trim());
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      <p className="text-sm font-medium">{label}</p>
      <Input
        ref={inputRef}
        data-scan-capture
        className="h-14 text-xl"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit">Use scan</Button>
    </form>
  );
}

export function FloorFrame({
  title,
  description,
  error,
  children,
}: {
  title: string;
  description: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <p className="mb-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Floor</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      <div className="print:hidden">
        <ErrorBanner error={error} />
      </div>
      {children}
    </div>
  );
}

export function ClaimList<T extends { id?: string }>({
  title,
  empty,
  rows,
  userId,
  jobFor,
  onOpen,
  render,
  footer,
}: {
  title: string;
  empty: string;
  rows: T[];
  userId: string;
  jobFor: (row: T) => FloorJob | undefined;
  onOpen: (row: T) => void;
  render: (row: T) => ReactNode;
  footer?: ReactNode;
}) {
  const { mine, pool, others } = splitByClaim(rows, userId, jobFor);

  function section(label: string, items: T[], disabled: boolean) {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <ul className="space-y-2 text-sm">
          {items.map((row, index) => {
            const job = jobFor(row);
            const key = (row as { id?: string }).id || job?.id || String(index);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={disabled}
                  onClick={() => onOpen(row)}
                >
                  {render(row)}
                  {job?.assigneeName ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {disabled ? claimedByMessage(job) : job.reason ? job.reason : `Assigned to ${job.assigneeName}`}
                    </span>
                  ) : job?.reason ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{job.reason}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <Card className="space-y-4">
      <p className="font-medium">{title}</p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      {section("Mine", mine, false)}
      {section("Unassigned", pool, false)}
      {section("Claimed by others", others, true)}
      {footer}
    </Card>
  );
}

export function openFloorRow<T>(
  row: T,
  userId: string,
  job: FloorJob | undefined,
  onOpen: (row: T) => void,
  setError: (message: string | null) => void,
): void {
  if (jobClaimedByOther(job, userId)) {
    setError(claimedByMessage(job));
    return;
  }
  setError(null);
  onOpen(row);
}
