import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeft, ScanLine, type LucideIcon } from "lucide-react";
import { useScanner } from "../../scanner/ScannerProvider";
import { Button, Card, EmptyState, ErrorBanner, Input } from "../../components/ui";
import type { FloorJob } from "../../api";
import { claimedByMessage, jobClaimedByOther, splitByClaim } from "../../jobs";
import { jobReasonText } from "@/domain/floor-usage";
import { cn } from "@/lib/utils";

export type ScanReport = (accepted: boolean) => void;

/**
 * `report(accepted)` answers a scan: tone, buzz, and the full-screen flash come from the scanner
 * (`emitScanResult`), and `flash` drives a ring on the field that took the scan.
 */
export function useScanFlash() {
  const { emitScanResult } = useScanner();
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const timer = useRef<number | null>(null);

  const report = useCallback<ScanReport>(
    (accepted) => {
      emitScanResult(accepted);
      setFlash(accepted ? "ok" : "bad");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFlash(null), 300);
    },
    [emitScanResult],
  );

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return { flash, report };
}

export function FloorScanBox({
  label,
  placeholder,
  onScan,
}: {
  label: string;
  placeholder: string;
  onScan: (raw: string, report?: ScanReport) => void;
}) {
  const scanner = useScanner();
  const { flash, report } = useScanFlash();
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
    onScan(scan.raw, report);
  }, [scanner.lastScan, onScan, report]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    scanner.emitScan(raw, "typed");
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      <p className="text-sm font-medium">{label}</p>
      <Input
        ref={inputRef}
        data-scan-capture
        aria-label={label}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        className={cn(
          "h-14 text-xl transition-shadow",
          flash === "ok" && "ring-2 ring-ok",
          flash === "bad" && "ring-2 ring-destructive",
        )}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11 min-w-28">
          Use scan
        </Button>
        {scanner.cameraSupported ? (
          <Button type="button" variant="secondary" className="h-11" onClick={() => scanner.openCamera()}>
            <ScanLine className="mr-1 size-4" />
            Camera
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Title, back-to-floor link, and error banner for every floor verb screen. */
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
  const { pathname } = useLocation();
  const onLauncher = pathname === "/floor" || pathname === "/floor/";
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1 print:hidden">
        {onLauncher ? null : (
          <Link
            to="/floor"
            aria-label="Back to floor"
            title="Back to floor"
            className="-ml-2.5 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-6" />
          </Link>
        )}
        <div className="min-w-0 pt-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground" title={description}>
              {description}
            </p>
          ) : null}
        </div>
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
  emptyBody = "Unassigned work stays on this screen.",
  emptyIcon,
  emptyAction,
  rows,
  userId,
  jobFor,
  onOpen,
  render,
  footer,
}: {
  title: string;
  empty: string;
  emptyBody?: string;
  emptyIcon?: LucideIcon;
  /** A next step when the list is empty, such as a link to another verb. */
  emptyAction?: ReactNode;
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
            const reason = job ? jobReasonText(job) : null;
            const key = (row as { id?: string }).id || job?.id || String(index);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                  disabled={disabled}
                  onClick={() => onOpen(row)}
                >
                  {render(row)}
                  {job?.assigneeName ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {disabled ? claimedByMessage(job) : reason ? reason : `Assigned to ${job.assigneeName}`}
                    </span>
                  ) : reason ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{reason}</span>
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
      {rows.length === 0 ? <EmptyState title={empty} body={emptyBody} icon={emptyIcon} action={emptyAction} /> : null}
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
): boolean {
  if (jobClaimedByOther(job, userId)) {
    setError(claimedByMessage(job));
    return false;
  }
  setError(null);
  onOpen(row);
  return true;
}
