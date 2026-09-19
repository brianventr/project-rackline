import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ScanHit } from "../../api";
import { documentPath } from "@/domain/barcodes";
import { Button, Card, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";

export function FloorLookupPage() {
  const [hit, setHit] = useState<ScanHit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then(setHit)
      .catch((err: Error) => {
        setHit(null);
        setError(err.message);
      });
  }, []);

  return (
    <FloorFrame title="Lookup" description="Scan a SKU, item barcode, bay, or document number." error={error}>
      <FloorScanBox label="Scan" placeholder="Bay, SKU, ORD-…, RCP-…" onScan={onScan} />
      {hit ? <LookupResult hit={hit} /> : null}
    </FloorFrame>
  );
}

function LookupResult({ hit }: { hit: ScanHit }) {
  if (hit.kind === "location") {
    return (
      <Card>
        <p className="font-mono text-xs uppercase text-muted-foreground">Bay</p>
        <h2 className="text-2xl font-semibold">{hit.location.code}</h2>
        <p className="text-muted-foreground">{hit.location.name}</p>
        <ul className="mt-4 space-y-1 text-sm">
          {hit.contents.length ? (
            hit.contents.map((row) => (
              <li key={row.itemId} className="flex justify-between">
                <span>
                  <span className="font-mono">{row.sku}</span> {row.itemName}
                </span>
                <span className="font-mono">{row.qty}</span>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">Empty bay.</li>
          )}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button>
            <Link to={`/floor/putaway?from=${encodeURIComponent(hit.location.barcode)}`}>Put away / move</Link>
          </Button>
          <Button variant="secondary">
            <Link to={`/stock/locations/${hit.location.id}`}>Open record</Link>
          </Button>
        </div>
      </Card>
    );
  }
  if (hit.kind === "item") {
    return (
      <Card>
        <p className="font-mono text-xs uppercase text-muted-foreground">Item</p>
        <h2 className="text-2xl font-semibold">{hit.item.sku}</h2>
        <p className="text-muted-foreground">{hit.item.name}</p>
        <ul className="mt-4 space-y-1 text-sm">
          {hit.onHand.length ? (
            hit.onHand.map((row) => (
              <li key={row.locationId} className="flex justify-between">
                <span className="font-mono">{row.locationCode}</span>
                <span className="font-mono">{row.qty}</span>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">None on hand.</li>
          )}
        </ul>
        <div className="mt-4">
          <Button variant="secondary">
            <Link to={`/stock/items/${hit.item.id}`}>Open record</Link>
          </Button>
        </div>
      </Card>
    );
  }

  const record =
    hit.kind === "order"
      ? {
          title: hit.order.number,
          status: hit.order.status,
          to: documentPath("order", hit.order.id),
          floor: floorPathForOrder(hit.order.status, hit.order.id),
        }
      : hit.kind === "receipt"
        ? { title: hit.receipt.number, status: hit.receipt.status, to: documentPath("receipt", hit.receipt.id), floor: `/floor/receive?id=${hit.receipt.id}` }
        : hit.kind === "purchase"
          ? { title: hit.purchase.number, status: hit.purchase.status, to: documentPath("purchase", hit.purchase.id), floor: `/floor/receive?purchase=${hit.purchase.id}` }
          : hit.kind === "rma"
            ? { title: hit.rma.number, status: hit.rma.status, to: documentPath("rma", hit.rma.id), floor: `/floor/return?id=${hit.rma.id}` }
        : hit.kind === "transfer"
          ? { title: hit.transfer.number, status: hit.transfer.status, to: documentPath("transfer", hit.transfer.id), floor: "/floor/putaway" }
          : hit.kind === "workOrder"
            ? { title: hit.workOrder.number, status: hit.workOrder.status, to: documentPath("workOrder", hit.workOrder.id), floor: `/floor/assemble?id=${hit.workOrder.id}` }
            : { title: hit.cycleCount.number, status: hit.cycleCount.status, to: documentPath("cycleCount", hit.cycleCount.id), floor: `/floor/count?id=${hit.cycleCount.id}` };

  return (
    <Card>
      <p className="font-mono text-xs uppercase text-muted-foreground">{hit.kind}</p>
      <h2 className="text-2xl font-semibold">{record.title}</h2>
      <div className="mt-2">
        <StatusBadge status={record.status} />
      </div>
      <div className="mt-4 flex gap-2">
        <Button>
          <Link to={record.floor}>Do this on the floor</Link>
        </Button>
        <Button variant="secondary">
          <Link to={record.to}>Open record</Link>
        </Button>
      </div>
    </Card>
  );
}

function floorPathForOrder(status: string, id: string): string {
  if (status === "picked" || status === "packing") return `/floor/pack?id=${id}`;
  if (status === "packed") return `/floor/ship?id=${id}`;
  return `/floor/pick?id=${id}`;
}
