import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Order, type ScanHit } from "../../api";
import { BarcodeLabel } from "../../components/BarcodeLabel";
import { Button, Card, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { jobsForScan, packSlipJobs, shippingLabelJobs, type PrintJob } from "@/domain/print-station";
import { usePrint } from "../../print/PrintProvider";
import { useScanner } from "../../scanner/ScannerProvider";

export function FloorPrintPage() {
  const [params] = useSearchParams();
  const printer = usePrint();
  const scanner = useScanner();
  const [hit, setHit] = useState<ScanHit | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      setMessage(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((next) => {
          setHit(next);
          setJobs(jobsForScan(next));
        })
        .catch((err: Error) => {
          setHit(null);
          setJobs([]);
          setError(err.message);
          scanner.emitScanError();
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
      description={`${printer.statusLabel}. Scan a bay, SKU, or order.`}
      error={error}
    >
      <div className="print:hidden">
        <FloorScanBox label="Scan bay, SKU, or order" placeholder="B-01-01, LAMP, or ORD-DEMO1" onScan={onScan} />
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
      {hit?.kind === "order" ? (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{hit.order.number}</h2>
            <StatusBadge status={hit.order.status} />
          </div>
          <p>{hit.order.customerName}</p>
          {jobs.length ? (
            <div className="flex flex-wrap gap-2">
              {jobs.map((job) => (
                <Button
                  key={job.href}
                  variant={job.kind === "pack-slip" ? "primary" : "secondary"}
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
                  {job.kind === "pack-slip" ? "Pack slip" : "Shipping label"}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to print until this order is picking or picked.</p>
          )}
        </Card>
      ) : null}
      {hit && hit.kind !== "location" && hit.kind !== "item" && hit.kind !== "order" ? (
        <p className="text-sm text-muted-foreground">Scan a bay, a SKU, or an order to print.</p>
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
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button onClick={() => void onPrint()}>Print label</Button>
        {jobs[0] ? (
          <Button variant="secondary" asChild>
            <Link to={jobs[0].href}>Open record</Link>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function WaitingJobs() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    Promise.all([api<Order[]>("/api/orders"), api<Location[]>("/api/locations")])
      .then(([nextOrders, nextLocations]) => {
        setOrders(nextOrders);
        setLocations(nextLocations);
      })
      .catch(() => {});
  }, []);

  const slips = packSlipJobs(orders);
  const labels = shippingLabelJobs(orders);

  return (
    <div className="grid gap-3 sm:grid-cols-2 print:hidden">
      <Card>
        <p className="mb-2 font-medium">Pack slips</p>
        <ul className="space-y-2 text-sm">
          {slips.map((job) => (
            <li key={job.href}>
              <Link className="underline" to={job.href}>
                {job.title}
              </Link>{" "}
              <span className="text-muted-foreground">{job.subtitle}</span>
            </li>
          ))}
          {slips.length === 0 ? <li className="text-muted-foreground">None waiting.</li> : null}
        </ul>
      </Card>
      <Card>
        <p className="mb-2 font-medium">Shipping labels</p>
        <ul className="space-y-2 text-sm">
          {labels.map((job) => (
            <li key={job.href}>
              <Link className="underline" to={job.href}>
                {job.title}
              </Link>{" "}
              <span className="text-muted-foreground">{job.subtitle}</span>
            </li>
          ))}
          {labels.length === 0 ? <li className="text-muted-foreground">None waiting.</li> : null}
        </ul>
      </Card>
      <Card className="sm:col-span-2">
        <p className="mb-2 font-medium">Sheets</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="underline" to="/stock/locations?labels=1">
            All bay labels ({locations.length})
          </Link>
          <Link className="underline" to="/stock/items?labels=1">
            All SKU labels
          </Link>
        </div>
      </Card>
    </div>
  );
}
