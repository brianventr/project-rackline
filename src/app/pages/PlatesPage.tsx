import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Package2, ScanLine } from "lucide-react";
import { errorText, type Plate } from "../api";
import { Button, Card, EmptyState, ErrorBanner, PageHeader, StatusBadge } from "../components/ui";
import { Term } from "../components/term";
import { DetailSkeleton, DocumentActivity, DocumentFact, DocumentFrame, DocumentHeader, DocumentRail } from "../components/document";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, RelativeTime, SkuCell } from "../components/cells";
import { useApiQuery } from "../query";
import { useWarehouse } from "../warehouse";
import { PLATE_STATUSES, PLATE_TYPE_LABELS } from "@/domain/license-plates";

export function PlatesPage() {
  const { ref } = useParams();
  if (ref) return <PlateDetailView plateRef={ref} />;
  return <PlateList />;
}

const PLATE_TABS: TabDef<Plate>[] = [
  { id: "open", label: "Open", match: (plate) => plate.status === "open" },
  { id: "closed", label: "Closed", match: (plate) => plate.status === "closed" },
  { id: "shipped", label: "Shipped", match: (plate) => plate.status === "shipped" },
  { id: "all", label: "All", match: () => true },
];

const PLATE_FACETS: FacetDef<Plate>[] = [
  { id: "type", label: "Type", value: (plate) => plate.type, format: (value) => PLATE_TYPE_LABELS[value as Plate["type"]] ?? value },
];

const PLATE_COLUMNS: DataColumn<Plate>[] = [
  {
    id: "code",
    header: "Plate",
    sortValue: (plate) => plate.code,
    cell: (plate) => <DocLink to={`/stock/plates/${plate.code}`}>{plate.code}</DocLink>,
  },
  {
    id: "type",
    header: "Type",
    sortValue: (plate) => plate.type,
    cell: (plate) => PLATE_TYPE_LABELS[plate.type],
  },
  {
    id: "bay",
    header: "Bay",
    sortValue: (plate) => plate.locationCode ?? null,
    cell: (plate) => (plate.locationCode ? <span className="font-mono">{plate.locationCode}</span> : <Muted>—</Muted>),
  },
  {
    id: "contents",
    header: "Contents",
    csv: (plate) => plate.lines.map((line) => `${line.sku} × ${line.qty}`).join(", "),
    cell: (plate) => <LineChips lines={plate.lines} />,
  },
  {
    id: "units",
    header: "Units",
    align: "right",
    sortValue: (plate) => plate.units,
    cell: (plate) => <span className="font-mono tabular-nums">{plate.units}</span>,
  },
  {
    id: "updated",
    header: "Updated",
    sortValue: (plate) => plate.updatedAt,
    csv: (plate) => new Date(plate.updatedAt).toISOString(),
    cell: (plate) => <RelativeTime at={plate.updatedAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (plate) => PLATE_STATUSES.indexOf(plate.status),
    csv: (plate) => plate.status,
    cell: (plate) => <StatusBadge status={plate.status} />,
  },
];

function PlateList() {
  const { warehouseId } = useWarehouse();
  const scope = warehouseId ? `warehouseId=${encodeURIComponent(warehouseId)}` : "";
  // Two reads, so the newest shipped plates never push a plate still in a bay off the list.
  const inBays = useApiQuery<Plate[]>(`/api/plates${scope ? `?${scope}` : ""}`);
  const shipped = useApiQuery<Plate[]>(`/api/plates?status=shipped${scope ? `&${scope}` : ""}`);
  const rows = useMemo(() => [...(inBays.data ?? []), ...(shipped.data ?? [])], [inBays.data, shipped.data]);

  const floorLink = (
    <Button size="sm" asChild>
      <Link to="/floor/plates">
        <ScanLine className="size-4" />
        Build on the floor
      </Link>
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Stock"
        title="Plates"
        description={
          <>
            Totes, pallets, and cartons with an LP- code. A <Term id="license-plate">plate</Term> groups stock already in its
            bay; the bay&apos;s balance stays the <Term id="ledger">ledger</Term>.
          </>
        }
      />
      <DataTable
        id="plates"
        data={rows}
        loading={inBays.isLoading || shipped.isLoading}
        error={inBays.error?.message ?? shipped.error?.message}
        columns={PLATE_COLUMNS}
        getRowId={(plate) => plate.id}
        rowHref={(plate) => `/stock/plates/${plate.code}`}
        tabs={PLATE_TABS}
        defaultTab="open"
        facets={PLATE_FACETS}
        defaultSort={{ id: "updated", desc: true }}
        search={{
          placeholder: "Search plate, bay, SKU, lot, serial",
          text: (plate) =>
            [plate.code, plate.locationCode, ...plate.lines.flatMap((line) => [line.sku, line.itemName, line.lotCode, line.serial])]
              .filter(Boolean)
              .join(" "),
        }}
        exportName="plates"
        toolbar={floorLink}
        empty={
          <EmptyState
            icon={Package2}
            title="No plates yet."
            body="Start a tote, pallet, or carton on the floor: scan a bay, then scan the stock in it onto the plate."
            action={floorLink}
          />
        }
      />
    </div>
  );
}

function PlateDetailView({ plateRef }: { plateRef: string }) {
  const query = useApiQuery<Plate>(`/api/plates/${encodeURIComponent(plateRef)}`);
  const plate = query.data;

  if (!plate) {
    return query.error ? <ErrorBanner error={errorText(query.error, "Could not load this plate. Try again.")} /> : <DetailSkeleton />;
  }

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Stock"
        list={{ label: "Plates", to: "/stock/plates" }}
        title={plate.code}
        description={`${PLATE_TYPE_LABELS[plate.type]}${plate.locationCode ? ` in ${plate.locationCode}` : ""} · ${plate.units} ${plate.units === 1 ? "unit" : "units"}`}
        status={plate.status}
        steps={PLATE_STATUSES}
        menu={[plate.status === "shipped" ? null : { label: "Open on floor", icon: ScanLine, to: `/floor/plates?code=${plate.code}` }]}
      />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Plate</p>
                <DocumentFact label="Type">{PLATE_TYPE_LABELS[plate.type]}</DocumentFact>
                <DocumentFact label="Bay">
                  {plate.locationId ? (
                    <Link className="font-mono underline underline-offset-2" to={`/stock/locations/${plate.locationId}`}>
                      {plate.locationCode || "Bay"}
                    </Link>
                  ) : (
                    "Shipped"
                  )}
                </DocumentFact>
                <DocumentFact label="Units">
                  <span className="font-mono tabular-nums">{plate.units}</span>
                </DocumentFact>
                <DocumentFact label="Started">
                  <RelativeTime at={plate.createdAt} />
                </DocumentFact>
                <DocumentFact label="Updated">
                  <RelativeTime at={plate.updatedAt} />
                </DocumentFact>
              </div>
            </Card>
          </DocumentRail>
        }
      >
        <Card>
          <p className="mb-3 text-sm font-medium">On the plate</p>
          {plate.lines.length ? (
            <ul className="divide-y text-sm">
              {plate.lines.map((line) => (
                <li key={line.id} className="flex items-center justify-between gap-3 py-2">
                  <SkuCell sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} to={`/stock/items/${line.itemId}`} />
                  <span className="flex shrink-0 items-center gap-3">
                    {line.lotCode ? <span className="font-mono text-xs text-muted-foreground">{line.lotCode}</span> : null}
                    {line.serial ? <span className="font-mono text-xs text-muted-foreground">{line.serial}</span> : null}
                    <span className="font-mono tabular-nums">{line.qty}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {plate.status === "shipped" ? "Everything on it was picked." : "Nothing on it. Scan stock onto it on the floor."}
            </p>
          )}
        </Card>
        <DocumentActivity refId={plate.id} refreshKey={plate.updatedAt} />
      </DocumentFrame>
    </div>
  );
}
