import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { api, errorText, type Location, type Order, type ScanHit, type Wave } from "../../api";
import { BarcodeLabel } from "../../components/BarcodeLabel";
import { Button, Card, EmptyState, ErrorBanner, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox, type ScanReport } from "./floor-ui";
import {
  isHtmlPrintKind,
  jobsForScan,
  packSlipJobs,
  pickListJobs,
  printJobButtonLabel,
  shippingLabelJobs,
  wavePickListJobs,
  type PrintJob,
} from "@/domain/print-station";
import { usePrint } from "../../print/PrintProvider";
import { useScanner } from "../../scanner/ScannerProvider";

const PRINTABLE_KINDS = new Set<ScanHit["kind"]>(["location", "item", "equipment", "order", "wave"]);

const listLink =
  "inline-flex min-h-11 items-center rounded-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FloorPrintPage() {
  const [params] = useSearchParams();
  const printer = usePrint();
  const scanner = useScanner();
  const [hit, setHit] = useState<ScanHit | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      setMessage(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((next) => {
          setHit(next);
          setJobs(jobsForScan(next));
          report?.(PRINTABLE_KINDS.has(next.kind));
        })
        .catch((err) => {
          setHit(null);
          setJobs([]);
          setError(errorText(err, "That barcode did not scan. Try again."));
          // A ?code= link has no scan to answer, so it keeps the plain error tone.
          if (report) report(false);
          else scanner.emitScanError();
        });
    },
    [scanner],
  );

  useEffect(() => {
    const code = params.get("code");
    if (code) onScan(code);
  }, [params, onScan]);

  return (
    <FloorFrame
      title="Print"
      description={`${printer.statusLabel}. Scan a bay, SKU, order, or wave.`}
      error={error}
    >
      <div className="print:hidden">
        <FloorScanBox label="Scan bay, SKU, order, or wave" placeholder="B-01-01, LAMP, ORD-DEMO1, or WAV-DEMO1" onScan={onScan} />
        {message ? <p className="mt-2 text-sm text-muted-foreground">{message}</p> : null}
      </div>
      {hit?.kind === "location" ? (
        <PrintCard
          title={hit.location.code}
          subtitle={hit.location.name}
          value={hit.location.barcode}
          jobs={jobs}
          onPrint={async () => {
            const result = await printer.print({
              kind: "bay",
              title: hit.location.code,
              href: `/stock/locations/${hit.location.id}`,
              data: {
                code: hit.location.code,
                name: hit.location.name,
                barcode: hit.location.barcode,
              },
              refType: "location",
              refId: hit.location.id,
            });
            setMessage(result.message);
            if (!result.ok) setError(result.message);
          }}
        />
      ) : null}
      {hit?.kind === "item" ? (
        <PrintCard
          title={hit.item.sku}
          subtitle={hit.item.name}
          value={hit.item.barcode || hit.item.sku}
          jobs={jobs}
          onPrint={async () => {
            const result = await printer.print({
              kind: "item",
              title: hit.item.sku,
              href: `/stock/items/${hit.item.id}`,
              data: {
                sku: hit.item.sku,
                name: hit.item.name,
                barcode: hit.item.barcode || hit.item.sku,
              },
              refType: "item",
              refId: hit.item.id,
            });
            setMessage(result.message);
            if (!result.ok) setError(result.message);
          }}
        />
      ) : null}
      {hit?.kind === "equipment" ? (
        <PrintCard
          title={hit.equipment.code}
          subtitle={hit.equipment.name}
          value={hit.equipment.barcode}
          jobs={jobs}
          onPrint={async () => {
            const result = await printer.print({
              kind: "equipment",
              title: hit.equipment.code,
              href: `/equipment/${hit.equipment.id}`,
              data: {
                code: hit.equipment.code,
                name: hit.equipment.name,
                barcode: hit.equipment.barcode,
              },
              refType: "equipment",
              refId: hit.equipment.id,
            });
            setMessage(result.message);
            if (!result.ok) setError(result.message);
          }}
        />
      ) : null}
      {hit?.kind === "order" ? (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{hit.order.number}</h2>
            <StatusBadge status={hit.order.status} />
          </div>
          <p>{hit.order.customerName}</p>
          {jobs.length ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {jobs.map((job) => (
                <Button
                  key={job.href}
                  className="h-11 w-full sm:w-auto"
                  variant={isHtmlPrintKind(job.kind) ? "primary" : "secondary"}
                  onClick={() => {
                    void printer
                      .print({
                        kind: job.kind,
                        title: job.title,
                        href: job.href,
                        refType: "order",
                        refId: hit.order.id,
                      })
                      .then((result) => {
                        setMessage(result.message);
                        if (!result.ok) setError(result.message);
                      });
                  }}
                >
                  {printJobButtonLabel(job.kind)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to print for this order yet.</p>
          )}
        </Card>
      ) : null}
      {hit?.kind === "wave" ? (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{hit.wave.number}</h2>
            <StatusBadge status={hit.wave.status} />
          </div>
          <p className="capitalize">{hit.wave.mode}</p>
          {jobs.length ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {jobs.map((job) => (
                <Button
                  key={job.href}
                  className="h-11 w-full sm:w-auto"
                  variant="primary"
                  onClick={() => {
                    void printer
                      .print({
                        kind: job.kind,
                        title: job.title,
                        href: job.href,
                        refType: "wave",
                        refId: hit.wave.id,
                      })
                      .then((result) => {
                        setMessage(result.message);
                        if (!result.ok) setError(result.message);
                      });
                  }}
                >
                  {printJobButtonLabel(job.kind)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This wave is complete.</p>
          )}
        </Card>
      ) : null}
      {hit &&
      hit.kind !== "location" &&
      hit.kind !== "item" &&
      hit.kind !== "order" &&
      hit.kind !== "equipment" &&
      hit.kind !== "wave" ? (
        <p className="text-sm text-muted-foreground">Scan a bay, a SKU, an order, or a wave to print.</p>
      ) : null}
      {!hit ? <WaitingJobs /> : null}
    </FloorFrame>
  );
}

function PrintCard({
  title,
  subtitle,
  value,
  jobs,
  onPrint,
}: {
  title: string;
  subtitle: string;
  value: string;
  jobs: PrintJob[];
  onPrint: () => void | Promise<void>;
}) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      <BarcodeLabel value={value} className="w-full" />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap print:hidden">
        <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void onPrint()}>
          Print label
        </Button>
        {jobs[0] ? (
          <Button variant="secondary" className="h-11 w-full sm:h-14 sm:w-auto" asChild>
            <Link to={jobs[0].href}>Open record</Link>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function WaitingJobs() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [waves, setWaves] = useState<Wave[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<Order[]>("/api/orders"),
      api<Wave[]>("/api/waves").catch(() => [] as Wave[]),
      api<Location[]>("/api/locations"),
    ])
      .then(([nextOrders, nextWaves, nextLocations]) => {
        setOrders(nextOrders);
        setWaves(nextWaves);
        setLocations(nextLocations);
        setLoaded(true);
      })
      .catch((err) => setLoadError(errorText(err, "Could not load what is waiting to print.")));
  }, []);

  const lists = [...pickListJobs(orders), ...wavePickListJobs(waves)];
  const slips = packSlipJobs(orders);
  const labels = shippingLabelJobs(orders);
  const nothingWaiting = lists.length === 0 && slips.length === 0 && labels.length === 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 print:hidden">
      {loadError ? (
        <div className="sm:col-span-2">
          <ErrorBanner error={loadError} />
        </div>
      ) : !loaded ? null : nothingWaiting ? (
        <EmptyState
          className="sm:col-span-2"
          icon={Printer}
          title="Nothing waiting to print."
          body="Pick lists, pack slips, and shipping labels for open orders and waves show here."
        />
      ) : (
        <>
          <WaitingCard title="Pick lists" jobs={lists} />
          <WaitingCard title="Pack slips" jobs={slips} />
          <WaitingCard title="Shipping labels" jobs={labels} />
        </>
      )}
      <Card className="sm:col-span-2">
        <p className="mb-1 font-medium">Sheets</p>
        <div className="flex flex-wrap gap-x-4 text-sm">
          <Link className={listLink} to="/stock/locations?labels=1">
            All bay labels{loaded ? ` (${locations.length})` : ""}
          </Link>
          <Link className={listLink} to="/stock/items?labels=1">
            All SKU labels
          </Link>
          <Link className={listLink} to="/equipment?labels=1">
            All equipment labels
          </Link>
        </div>
      </Card>
    </div>
  );
}

function WaitingCard({ title, jobs }: { title: string; jobs: PrintJob[] }) {
  return (
    <Card>
      <p className="mb-1 font-medium">{title}</p>
      <ul className="text-sm">
        {jobs.map((job) => (
          <li key={job.href} className="flex min-h-11 flex-wrap items-center gap-x-1.5">
            <Link className={listLink} to={job.href}>
              {job.title}
            </Link>
            <span className="text-muted-foreground">{job.subtitle}</span>
          </li>
        ))}
        {jobs.length === 0 ? <li className="py-2 text-muted-foreground">None waiting.</li> : null}
      </ul>
    </Card>
  );
}
