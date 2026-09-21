import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { BarcodeLabel } from "./BarcodeLabel";
import { Button } from "./ui";
import { useAutoPrint } from "../print/use-auto-print";
import {
  reservationCopy,
  type OrderPickListDocument,
  type PickListSkuRow,
  type PickListStop,
  type WavePickListDocument,
} from "@/domain/pick-list";

function Check() {
  return <span className="pick-check" aria-hidden />;
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function provenanceLabel(value: PickListStop["provenance"] | PickListSkuRow["provenance"]): string {
  if (value === "allocated") return "Reserved ATP";
  if (value === "suggested") return "Suggested pick face";
  return "Reserved + suggested";
}

function skuFlags(row: PickListSkuRow): string[] {
  const flags: string[] = [];
  if (row.uomLabel) flags.push(row.uomLabel);
  for (const lot of row.lots) {
    flags.push(`FEFO ${lot.lotCode} ×${lot.qty}${lot.expiresOnLabel ? ` exp ${lot.expiresOnLabel}` : ""}`);
  }
  if (row.trackLot && row.lots.length === 0) flags.push("Lot-tracked");
  if (row.trackSerial) flags.push(`Scan ${row.pickQty} serial${row.pickQty === 1 ? "" : "s"}`);
  if (row.catchWeight) flags.push("Weigh at pick");
  if (row.orderSplits.length > 1) {
    flags.push(row.orderSplits.map((split) => `${split.orderNumber} ×${split.qty}`).join(" · "));
  }
  return flags;
}

function SkuRow({ row }: { row: PickListSkuRow }) {
  const flags = skuFlags(row);
  return (
    <tr className="border-b border-border/80 align-top last:border-0">
      <td className="w-8 py-2.5 pr-2">
        <Check />
      </td>
      <td className="w-28 py-2.5 pr-3">
        <BarcodeLabel value={row.barcode} height={28} className="h-7 w-28 bg-white" />
      </td>
      <td className="py-2.5 pr-3">
        <p className="font-mono text-sm font-semibold">{row.sku}</p>
        <p className="text-sm">{row.itemName}</p>
        {row.qtyPicked > 0 ? (
          <p className="text-xs text-muted-foreground">
            {row.qtyOrdered} ordered · {row.qtyPicked} already picked
          </p>
        ) : null}
        {flags.length ? <p className="mt-1 text-xs text-muted-foreground">{flags.join(" · ")}</p> : null}
      </td>
      <td className="py-2.5 text-right">
        <p className="font-mono text-2xl font-semibold tabular-nums leading-none">{row.pickQty}</p>
        <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">Pick</p>
      </td>
    </tr>
  );
}

function StopCard({ stop }: { stop: PickListStop }) {
  return (
    <section className="pick-stop rounded-lg border border-foreground/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground/10 pb-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-lg font-semibold text-background">
            {stop.step}
          </span>
          <div>
            <p className="font-mono text-xl font-semibold leading-tight">{stop.locationCode}</p>
            <p className="text-sm text-muted-foreground">{stop.address}</p>
            {stop.zoneName ? <p className="text-xs text-muted-foreground">Zone {stop.zoneName}</p> : null}
            <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {provenanceLabel(stop.provenance)}
            </p>
          </div>
        </div>
        <BarcodeLabel value={stop.locationBarcode} height={36} className="h-9 w-40 bg-white" />
      </div>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {stop.skus.map((row) => (
            <SkuRow key={`${row.lineId}-${row.sku}`} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function WalkStrip({ value }: { value: string }) {
  if (!value) return null;
  return (
    <p className="rounded-md bg-muted/60 px-3 py-2 font-mono text-sm">
      <span className="mr-2 text-[11px] font-sans font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Walk
      </span>
      {value}
    </p>
  );
}

function OrderBody({ doc }: { doc: OrderPickListDocument }) {
  return (
    <>
      <WalkStrip value={doc.walkStrip} />
      {reservationCopy(doc.reservationNote) ? (
        <p className="text-sm text-muted-foreground">{reservationCopy(doc.reservationNote)}</p>
      ) : null}
      {doc.stops.map((stop) => (
        <StopCard key={stop.locationId} stop={stop} />
      ))}
      {doc.unlocated.length ? (
        <section className="pick-stop rounded-lg border border-dashed border-foreground/30 p-4">
          <p className="font-medium">Needs a bay</p>
          <p className="mb-2 text-sm text-muted-foreground">No pick face, held stock, or empty location.</p>
          <ul className="space-y-1 text-sm">
            {doc.unlocated.map((row) => (
              <li key={row.lineId} className="flex items-center gap-2">
                <Check />
                <span className="font-mono font-semibold">{row.sku}</span>
                <span>{row.itemName}</span>
                <span className="ml-auto font-mono tabular-nums">×{row.remaining}</span>
                {row.orderNumber ? <span className="text-muted-foreground">{row.orderNumber}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {doc.alreadyPicked.length ? (
        <section className="text-sm">
          <p className="mb-1 font-medium">Already picked</p>
          <ul className="space-y-0.5 text-muted-foreground">
            {doc.alreadyPicked.map((row) => (
              <li key={row.lineId}>
                <span className="font-mono">{row.sku}</span> {row.itemName} · {row.qtyPicked}/{row.qtyOrdered}
                {row.orderNumber ? ` · ${row.orderNumber}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function PickListSheet({
  backTo,
  backLabel,
  printLabel,
  orgName,
  scanHint,
  heading,
  number,
  subtitle,
  status,
  meta,
  summary,
  children,
  ready,
}: {
  backTo: string;
  backLabel: string;
  printLabel: string;
  orgName: string;
  scanHint: string;
  heading: string;
  number: string;
  subtitle?: string | null;
  status: string;
  meta: { label: string; value?: string | null }[];
  summary: string;
  children: ReactNode;
  ready: boolean;
}) {
  useAutoPrint(ready);
  const printedAt = new Date().toLocaleString();
  return (
    <div className="print-document mx-auto max-w-3xl space-y-5 bg-card p-6 print:max-w-none print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <Button variant="ghost" asChild>
          <Link to={backTo}>{backLabel}</Link>
        </Button>
        <Button onClick={() => window.print()}>{printLabel}</Button>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-foreground/20 pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{heading}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight">{number}</h1>
          {subtitle ? <p className="mt-2 text-lg">{subtitle}</p> : null}
          <p className="text-sm text-muted-foreground">{orgName}</p>
          <p className="mt-3 text-xs text-muted-foreground">{scanHint}</p>
        </div>
        <div className="text-right">
          <BarcodeLabel value={number} height={48} className="h-12 w-52 bg-white" />
          <p className="mt-2 text-sm text-muted-foreground">Printed {printedAt}</p>
          <p className="text-sm capitalize">{status}</p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {meta.map((row) => (
          <Meta key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
      <p className="text-sm font-medium">{summary}</p>
      {children}
      <footer className="flex flex-wrap items-end justify-between gap-4 border-t border-foreground/20 pt-6 text-sm">
        <div className="space-y-3">
          <p>
            Picker{" "}
            <span className="ml-2 inline-block min-w-[12rem] border-b border-foreground/40">&nbsp;</span>
          </p>
          <p>
            Time <span className="ml-2 inline-block min-w-[8rem] border-b border-foreground/40">&nbsp;</span>
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Scan bay and SKU barcodes on Floor → Pick to post the walk.</p>
      </footer>
    </div>
  );
}

export function OrderPickListSheet({
  doc,
  orgName,
  backTo,
}: {
  doc: OrderPickListDocument;
  orgName: string;
  backTo: string;
}) {
  const channel = doc.source === "shopify" ? "Shopify" : doc.source ? "Floor" : null;
  return (
    <PickListSheet
      ready
      backTo={backTo}
      backLabel="Back to order"
      printLabel="Print pick list"
      orgName={orgName}
      scanHint="Scan this barcode on Floor → Pick"
      heading="Pick list"
      number={doc.number}
      subtitle={doc.customerName}
      status={doc.status}
      summary={`${doc.stopCount} stop${doc.stopCount === 1 ? "" : "s"} · ${doc.remainingUnits} unit${doc.remainingUnits === 1 ? "" : "s"} remaining · ${doc.remainingLines} line${doc.remainingLines === 1 ? "" : "s"}`}
      meta={[
        { label: "Shopify", value: doc.shopifyOrderName },
        { label: "Ship to", value: doc.shipTo },
        { label: "Channel", value: channel },
        { label: "Warehouse", value: doc.warehouseName },
        { label: "Wave", value: doc.waveNumber },
        { label: "Zone", value: doc.zoneName },
        { label: "Client", value: doc.clientCode },
        { label: "Picker", value: doc.pickerName },
      ]}
    >
      <OrderBody doc={doc} />
    </PickListSheet>
  );
}

export function WavePickListSheet({
  doc,
  orgName,
  backTo,
}: {
  doc: WavePickListDocument;
  orgName: string;
  backTo: string;
}) {
  return (
    <PickListSheet
      ready
      backTo={backTo}
      backLabel="Back to wave"
      printLabel="Print pick list"
      orgName={orgName}
      scanHint="Scan this barcode on Floor → Wave"
      heading={doc.mode === "batch" ? "Batch pick list" : "Wave pick list"}
      number={doc.number}
      subtitle={doc.mode === "batch" ? "Consolidated SKU walk" : "Pick each order in walk order"}
      status={doc.status}
      summary={`${doc.stopCount} stop${doc.stopCount === 1 ? "" : "s"} · ${doc.remainingUnits} unit${doc.remainingUnits === 1 ? "" : "s"} remaining`}
      meta={[
        { label: "Mode", value: doc.mode },
        { label: "Zone", value: doc.zoneName },
        { label: "Client", value: doc.clientCode },
        { label: "Notes", value: doc.notes },
      ]}
    >
      <WalkStrip value={doc.walkStrip} />
      {doc.mode === "batch" ? (
        <>
          {doc.stops.map((stop) => (
            <StopCard key={stop.locationId} stop={stop} />
          ))}
          {doc.unlocated.length ? (
            <section className="pick-stop rounded-lg border border-dashed border-foreground/30 p-4">
              <p className="font-medium">Needs a bay</p>
              <ul className="mt-2 space-y-1 text-sm">
                {doc.unlocated.map((row) => (
                  <li key={row.lineId} className="flex items-center gap-2">
                    <Check />
                    <span className="font-mono font-semibold">{row.sku}</span>
                    <span className="ml-auto font-mono">×{row.remaining}</span>
                    {row.orderNumber ? <span className="text-muted-foreground">{row.orderNumber}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        doc.orders.map((order) => (
          <section key={order.number} className="space-y-3">
            <div className="flex items-end justify-between gap-4 border-b pb-2">
              <div>
                <p className="font-mono text-lg font-semibold">{order.number}</p>
                <p className="text-sm">{order.customerName}</p>
              </div>
              <BarcodeLabel value={order.number} height={36} className="h-9 w-40 bg-white" />
            </div>
            <OrderBody doc={order} />
          </section>
        ))
      )}
    </PickListSheet>
  );
}
