import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ScanHit } from "../../api";
import { documentPath } from "@/domain/barcodes";
import { Button, Card, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { AsBuiltList } from "../../components/as-built";

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
    <FloorFrame title="Lookup" description="Scan a SKU, item barcode, bay, document, serial, or lot." error={error}>
      <FloorScanBox label="Scan" placeholder="Bay, SKU, LAMP-1001, LOT-2026-A" onScan={onScan} />
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
                  {row.held ? (
                    <span className="ml-2 text-xs uppercase text-destructive">
                      Hold {row.holdNumber}
                    </span>
                  ) : null}
                  {(row.allocated ?? 0) > 0 ? (
                    <span className="ml-2 text-xs uppercase text-muted-foreground">Allocated {row.allocated}</span>
                  ) : null}
                </span>
                <span className="font-mono">{row.availableQty ?? row.qty}</span>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">Empty bay.</li>
          )}
        </ul>
        {hit.holds?.length ? (
          <p className="mt-3 text-sm text-destructive">
            On hold: {hit.holds.map((hold) => `${hold.number} (${hold.reason})`).join(", ")}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Button>
            <Link to={`/floor/putaway?from=${encodeURIComponent(hit.location.barcode)}`}>Put away / move</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to={`/floor/hold?location=${hit.location.id}`}>Hold</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to={`/floor/print?code=${encodeURIComponent(hit.location.barcode)}`}>Print label</Link>
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
                <span className="font-mono">
                  {row.locationCode}
                  {row.held ? <span className="ml-2 text-xs uppercase text-destructive">Hold</span> : null}
                  {(row.allocated ?? 0) > 0 ? (
                    <span className="ml-2 text-xs uppercase text-muted-foreground">Allocated {row.allocated}</span>
                  ) : null}
                </span>
                <span className="font-mono">{row.availableQty ?? row.qty}</span>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">None on hand.</li>
          )}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" asChild>
            <Link to={`/floor/hold?item=${hit.item.id}`}>Hold</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to={`/floor/print?code=${encodeURIComponent(hit.item.barcode || hit.item.sku)}`}>Print label</Link>
          </Button>
          <Button variant="secondary">
            <Link to={`/stock/items/${hit.item.id}`}>Open record</Link>
          </Button>
        </div>
      </Card>
    );
  }
  if (hit.kind === "serial") {
    return (
      <div className="space-y-4">
        <Card>
          <p className="font-mono text-xs uppercase text-muted-foreground">Serial</p>
          <h2 className="text-2xl font-semibold">{hit.serial.serialCode}</h2>
          <p className="text-muted-foreground">
            {hit.serial.sku} {hit.serial.itemName}
          </p>
          <p className="mt-2 text-sm">
            <StatusBadge status={hit.serial.status} />{" "}
            <span className="font-mono">{hit.serial.locationCode || "—"}</span>
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary">
              <Link to={`/stock/items/${hit.item.id}`}>Open item</Link>
            </Button>
          </div>
        </Card>
        <AsBuiltList title="Built from" empty="No kit or work-order genealogy for this serial." rows={hit.builtFrom} mode="from" />
        <AsBuiltList title="Used in" empty="This serial was not consumed into a build." rows={hit.usedIn} mode="into" />
      </div>
    );
  }
  if (hit.kind === "lot") {
    return (
      <div className="space-y-4">
        <Card>
          <p className="font-mono text-xs uppercase text-muted-foreground">Lot</p>
          <h2 className="text-2xl font-semibold">{hit.lotCode}</h2>
          <ul className="mt-4 space-y-1 text-sm">
            {hit.onHand.length ? (
              hit.onHand.map((row) => (
                <li key={`${row.locationId}:${row.itemId}`} className="flex justify-between">
                  <span>
                    <span className="font-mono">{row.sku}</span> @ {row.locationCode}
                  </span>
                  <span className="font-mono">{row.qty}</span>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">None on hand.</li>
            )}
          </ul>
        </Card>
        <AsBuiltList title="Used in" empty="This lot was not consumed into a build." rows={hit.usedIn} mode="into" />
        <AsBuiltList title="Built from" empty="No genealogy for this finished lot." rows={hit.builtFrom} mode="from" />
      </div>
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
            : hit.kind === "replenishment"
              ? { title: hit.replenishment.number, status: hit.replenishment.status, to: documentPath("replenishment", hit.replenishment.id), floor: `/floor/replenish?id=${hit.replenishment.id}` }
              : hit.kind === "kit"
                ? { title: hit.kit.number, status: hit.kit.status, to: documentPath("kit", hit.kit.id), floor: `/floor/kit?id=${hit.kit.id}` }
                : hit.kind === "hold"
                  ? { title: hit.hold.number, status: hit.hold.status, to: documentPath("hold", hit.hold.id), floor: `/floor/hold?id=${hit.hold.id}` }
              : hit.kind === "cycleCount"
                ? { title: hit.cycleCount.number, status: hit.cycleCount.status, to: documentPath("cycleCount", hit.cycleCount.id), floor: `/floor/count?id=${hit.cycleCount.id}` }
                : { title: "Unknown", status: "", to: "/floor/lookup", floor: "/floor/lookup" };

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
        {hit.kind === "order" ? (
          <Button variant="secondary" asChild>
            <Link to={`/floor/print?code=${encodeURIComponent(hit.order.number)}`}>Print slip / label</Link>
          </Button>
        ) : null}
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
