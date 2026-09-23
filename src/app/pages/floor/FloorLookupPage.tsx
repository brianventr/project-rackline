import { useCallback, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { api, errorText, type ScanHit } from "../../api";
import { documentPath } from "@/domain/barcodes";
import { Button, Card, EmptyState, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { FloorFrame, FloorScanBox, type ScanReport } from "./floor-ui";
import { AsBuiltList } from "../../components/as-built";
import { SkuThumb } from "../../components/sku-thumb";

export function FloorLookupPage() {
  const [hit, setHit] = useState<ScanHit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onScan = useCallback((raw: string, report?: ScanReport) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((next) => {
        setHit(next);
        report?.(true);
      })
      .catch((err) => {
        setHit(null);
        setError(errorText(err, "That barcode did not scan. Try again."));
        report?.(false);
      });
  }, []);

  return (
    <FloorFrame title="Lookup" description="Scan a SKU, bay, document, serial, lot, or EQ: truck." error={error}>
      <FloorScanBox label="Scan" placeholder="Bay, SKU, LAMP-1001, LOT-2026-A" onScan={onScan} />
      {hit ? (
        <LookupResult hit={hit} />
      ) : (
        <EmptyState
          icon={Search}
          title="Nothing scanned yet."
          body="Scan a bay to see what is in it, or a SKU, document, serial, or lot to see where it stands."
        />
      )}
    </FloorFrame>
  );
}

/** The eyebrow over a document hit, in words rather than the API's kind ids (workOrder, cycleCount). */
const KIND_LABEL: Partial<Record<ScanHit["kind"], string>> = {
  order: "Order",
  receipt: "Receipt",
  purchase: "Purchase order",
  rma: "Return",
  vendorReturn: "Vendor return",
  transfer: "Transfer",
  workOrder: "Work order",
  replenishment: "Replenishment",
  kit: "Kit",
  hold: "Hold",
  wave: "Wave",
  asn: "ASN",
  yard: "Yard visit",
  cycleCount: "Count",
};

const primaryAction = "h-14 w-full text-lg sm:w-auto";
const secondaryAction = "h-11";

/** The next step goes first and full width on a phone; the rest sit two to a row. */
function LookupActions({ primary, children }: { primary?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-4 space-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0">
      {primary}
      {children ? (
        <div className="grid grid-cols-2 gap-2 sm:contents [&>*]:min-w-0 [&>*:last-child:nth-child(odd)]:col-span-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Column heads over a bay's or SKU's stock list; the right-hand number is what can still be picked. */
function StockHead({ left }: { left: string }) {
  return (
    <div className="mt-4 flex justify-between gap-2 border-b pb-1 text-xs text-muted-foreground">
      <span>{left}</span>
      <span>Available</span>
    </div>
  );
}

/** Says what the Available column means; the glossary term lives here, not in the column head. */
function StockNote() {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <Term id="atp">Available</Term> is on hand minus holds and allocations.
    </p>
  );
}

function LookupResult({ hit }: { hit: ScanHit }) {
  if (hit.kind === "location") {
    return (
      <Card>
        <p className="font-mono text-xs uppercase text-muted-foreground">Bay</p>
        <h2 className="text-2xl font-semibold">{hit.location.code}</h2>
        <p className="text-muted-foreground">{hit.location.name}</p>
        {hit.contents.length ? <StockHead left="SKU" /> : null}
        <ul className={hit.contents.length ? "mt-2 space-y-1 text-sm" : "mt-4 space-y-1 text-sm"}>
          {hit.contents.length ? (
            hit.contents.map((row) => (
              <li key={row.itemId} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <SkuThumb sku={row.sku} name={row.itemName} imageUrl={row.imageUrl} size="sm" />
                  <span>
                    <span className="font-mono">{row.sku}</span> {row.itemName}
                    {row.held ? (
                      <span className="ml-2 text-xs uppercase text-destructive">Hold {row.holdNumber}</span>
                    ) : null}
                    {(row.allocated ?? 0) > 0 ? (
                      <span className="ml-2 text-xs uppercase text-muted-foreground">Allocated {row.allocated}</span>
                    ) : null}
                  </span>
                </span>
                <span className="font-mono">{row.availableQty ?? row.qty}</span>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">Empty bay.</li>
          )}
        </ul>
        {hit.contents.length ? <StockNote /> : null}
        {hit.holds?.length ? (
          <p className="mt-3 text-sm text-destructive">
            On hold: {hit.holds.map((hold) => `${hold.number} (${hold.reason})`).join(", ")}
          </p>
        ) : null}
        <LookupActions
          primary={
            <Button className={primaryAction} asChild>
              <Link to={`/floor/putaway?from=${encodeURIComponent(hit.location.barcode)}`}>Put away / move</Link>
            </Button>
          }
        >
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/floor/hold?location=${hit.location.id}`}>Hold</Link>
          </Button>
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/floor/print?code=${encodeURIComponent(hit.location.barcode)}`}>Print label</Link>
          </Button>
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/stock/locations/${hit.location.id}`}>Open record</Link>
          </Button>
        </LookupActions>
      </Card>
    );
  }
  if (hit.kind === "item") {
    return (
      <Card>
        <p className="font-mono text-xs uppercase text-muted-foreground">Item</p>
        <div className="mt-1 flex items-center gap-3">
          <SkuThumb sku={hit.item.sku} name={hit.item.name} imageUrl={hit.item.imageUrl} size="lg" />
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold">{hit.item.sku}</h2>
            <p className="text-muted-foreground">{hit.item.name}</p>
          </div>
        </div>
        {hit.onHand.length ? <StockHead left="Bay" /> : null}
        <ul className={hit.onHand.length ? "mt-2 space-y-1 text-sm" : "mt-4 space-y-1 text-sm"}>
          {hit.onHand.length ? (
            hit.onHand.map((row) => (
              <li key={row.locationId} className="flex justify-between gap-2">
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
        {hit.onHand.length ? <StockNote /> : null}
        <LookupActions>
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/floor/hold?item=${hit.item.id}`}>Hold</Link>
          </Button>
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/floor/print?code=${encodeURIComponent(hit.item.barcode || hit.item.sku)}`}>Print label</Link>
          </Button>
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/stock/items/${hit.item.id}`}>Open record</Link>
          </Button>
        </LookupActions>
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
          <LookupActions>
            <Button variant="secondary" className={secondaryAction} asChild>
              <Link to={`/stock/items/${hit.item.id}`}>Open item</Link>
            </Button>
          </LookupActions>
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

  if (hit.kind === "equipment") {
    return (
      <Card>
        <p className="font-mono text-xs uppercase text-muted-foreground">Equipment</p>
        <h2 className="text-2xl font-semibold">{hit.equipment.code}</h2>
        <p className="text-muted-foreground">{hit.equipment.name}</p>
        <p className="mt-2">
          <StatusBadge status={hit.equipment.status} />
          {hit.equipment.currentAssignment ? (
            <span className="ml-2 text-sm">
              {hit.equipment.currentAssignment.operatorName} · {hit.equipment.currentAssignment.number}
            </span>
          ) : null}
        </p>
        <LookupActions
          primary={
            <Button className={primaryAction} asChild>
              <Link to={`/floor/checkout?id=${hit.equipment.id}`}>Check out</Link>
            </Button>
          }
        >
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/floor/print?code=${encodeURIComponent(hit.equipment.barcode)}`}>Print label</Link>
          </Button>
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/equipment/${hit.equipment.id}`}>Open record</Link>
          </Button>
        </LookupActions>
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
            : hit.kind === "vendorReturn"
              ? { title: hit.vendorReturn.number, status: hit.vendorReturn.status, to: documentPath("vendorReturn", hit.vendorReturn.id), floor: `/floor/rtv?id=${hit.vendorReturn.id}` }
        : hit.kind === "transfer"
          ? { title: hit.transfer.number, status: hit.transfer.status, to: documentPath("transfer", hit.transfer.id), floor: `/floor/putaway?id=${hit.transfer.id}` }
          : hit.kind === "workOrder"
            ? { title: hit.workOrder.number, status: hit.workOrder.status, to: documentPath("workOrder", hit.workOrder.id), floor: `/floor/assemble?id=${hit.workOrder.id}` }
            : hit.kind === "replenishment"
              ? { title: hit.replenishment.number, status: hit.replenishment.status, to: documentPath("replenishment", hit.replenishment.id), floor: `/floor/replenish?id=${hit.replenishment.id}` }
              : hit.kind === "kit"
                ? { title: hit.kit.number, status: hit.kit.status, to: documentPath("kit", hit.kit.id), floor: `/floor/kit?id=${hit.kit.id}` }
                : hit.kind === "hold"
                  ? { title: hit.hold.number, status: hit.hold.status, to: documentPath("hold", hit.hold.id), floor: `/floor/hold?id=${hit.hold.id}` }
              : hit.kind === "wave"
                ? { title: hit.wave.number, status: hit.wave.status, to: documentPath("wave", hit.wave.id), floor: `/floor/wave?id=${hit.wave.id}` }
                : hit.kind === "asn"
                  ? {
                      title: hit.package ? `${hit.asn.number} ${hit.package.number}` : hit.asn.number,
                      status: hit.package?.putawayAt ? "put away" : hit.package?.receivedAt ? "received" : hit.asn.status,
                      to: documentPath("asn", hit.asn.id),
                      floor:
                        hit.package?.receivedAt && !hit.package.putawayAt
                          ? `/floor/putaway?carton=${encodeURIComponent(hit.package.sscc || hit.package.number)}`
                          : `/floor/asn?id=${hit.asn.id}`,
                    }
                  : hit.kind === "yard"
                    ? { title: hit.yard.number, status: hit.yard.status, to: documentPath("yard", hit.yard.id), floor: `/floor/yard?id=${hit.yard.id}` }
                    : hit.kind === "cycleCount"
                      ? { title: hit.cycleCount.number, status: hit.cycleCount.status, to: documentPath("cycleCount", hit.cycleCount.id), floor: `/floor/count?id=${hit.cycleCount.id}` }
                      : { title: "Unknown", status: "", to: "/floor/lookup", floor: "/floor/lookup" };

  return (
    <Card>
      <p className="font-mono text-xs uppercase text-muted-foreground">{KIND_LABEL[hit.kind] ?? hit.kind}</p>
      <h2 className="text-2xl font-semibold">{record.title}</h2>
      <div className="mt-2">
        <StatusBadge status={record.status} />
      </div>
      <LookupActions
        primary={
          <Button className={primaryAction} asChild>
            <Link to={record.floor}>Do this on the floor</Link>
          </Button>
        }
      >
        {hit.kind === "order" ? (
          <Button variant="secondary" className={secondaryAction} asChild>
            <Link to={`/floor/print?code=${encodeURIComponent(hit.order.number)}`}>Print slip / label</Link>
          </Button>
        ) : null}
        <Button variant="secondary" className={secondaryAction} asChild>
          <Link to={record.to}>Open record</Link>
        </Button>
      </LookupActions>
    </Card>
  );
}

function floorPathForOrder(status: string, id: string): string {
  if (status === "picked" || status === "packing") return `/floor/pack?id=${id}`;
  if (status === "packed") return `/floor/ship?id=${id}`;
  return `/floor/pick?id=${id}`;
}
