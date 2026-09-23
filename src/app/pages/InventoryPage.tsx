import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Boxes } from "lucide-react";
import { type InventoryRow } from "../api";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, Muted, RelativeTime, SkuCell } from "../components/cells";
import { useApiQuery } from "../query";
import { cn } from "@/lib/utils";
import { useWarehouse, inWarehouse } from "../warehouse";

/** The API also sends the location type and last change; the shared type does not list them yet. */
type OnHandRow = InventoryRow & { locationType?: string | null; updatedAt?: number | null };

function atpOf(row: OnHandRow): number {
  return row.atp ?? row.qty;
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

const ON_HAND_TABS: TabDef<OnHandRow>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "low", label: "Low ATP", match: (row) => atpOf(row) <= 0 || (row.allocated ?? 0) > 0 },
];

const ON_HAND_FACETS: FacetDef<OnHandRow>[] = [
  { id: "itemType", label: "Item type", value: (row) => row.itemType || null, format: capitalize },
  { id: "locationType", label: "Location type", value: (row) => row.locationType || null, format: capitalize },
];

const ON_HAND_COLUMNS: DataColumn<OnHandRow>[] = [
  {
    id: "sku",
    header: "Item",
    sortValue: (row) => row.sku,
    csv: (row) => row.sku,
    cell: (row) => <SkuCell sku={row.sku} name={row.itemName} imageUrl={row.imageUrl} to={`/stock/items/${row.itemId}`} />,
  },
  {
    id: "name",
    header: "Name",
    defaultHidden: true,
    sortValue: (row) => row.itemName,
    cell: (row) => row.itemName,
  },
  {
    id: "location",
    header: "Location",
    sortValue: (row) => row.locationCode,
    cell: (row) => (
      <span className="flex flex-col">
        <DocLink to={`/stock/locations/${row.locationId}`}>{row.locationCode}</DocLink>
        {row.locationName && row.locationName !== row.locationCode ? (
          <span className="text-xs text-muted-foreground">{row.locationName}</span>
        ) : null}
      </span>
    ),
  },
  {
    id: "itemType",
    header: "Type",
    sortValue: (row) => row.itemType,
    cell: (row) => <span className="capitalize">{row.itemType}</span>,
  },
  {
    id: "locationType",
    header: "Location type",
    defaultHidden: true,
    sortValue: (row) => row.locationType ?? null,
    cell: (row) => (row.locationType ? <span className="capitalize">{row.locationType}</span> : <Muted>—</Muted>),
  },
  {
    id: "qty",
    header: "On hand",
    align: "right",
    sortValue: (row) => row.qty,
    cell: (row) => <span className="font-mono">{row.qty}</span>,
  },
  {
    id: "allocated",
    header: "Allocated",
    align: "right",
    sortValue: (row) => row.allocated ?? 0,
    cell: (row) =>
      (row.allocated ?? 0) > 0 ? (
        <span className="font-mono">{row.allocated}</span>
      ) : (
        <span className="font-mono text-muted-foreground">0</span>
      ),
  },
  {
    id: "atp",
    header: "ATP",
    align: "right",
    sortValue: (row) => atpOf(row),
    cell: (row) => {
      const atp = atpOf(row);
      return (
        <span
          className={cn("font-mono font-medium", atp <= 0 ? "text-tone-danger" : atp < row.qty ? "text-tone-warning" : undefined)}
          title={atp < row.qty ? `${row.qty - atp} held or allocated` : undefined}
        >
          {atp}
        </span>
      );
    },
  },
  {
    id: "updated",
    header: "Last change",
    defaultHidden: true,
    sortValue: (row) => row.updatedAt ?? null,
    csv: (row) => (row.updatedAt ? new Date(row.updatedAt).toISOString() : ""),
    cell: (row) => <RelativeTime at={row.updatedAt} />,
  },
];

export function InventoryPage() {
  const { warehouseId } = useWarehouse();
  const inventory = useApiQuery<OnHandRow[]>("/api/inventory");
  const rows = useMemo(() => inWarehouse(inventory.data ?? [], warehouseId), [inventory.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Stock"
        title="On hand"
        description="Every unit sits in a location. ATP is on hand minus holds and reservations."
      />
      <DataTable
        id="on-hand"
        data={rows}
        loading={inventory.isLoading}
        error={inventory.error?.message}
        columns={ON_HAND_COLUMNS}
        getRowId={(row) => row.id}
        rowHref={(row) => `/stock/items/${row.itemId}`}
        tabs={ON_HAND_TABS}
        defaultTab="all"
        facets={ON_HAND_FACETS}
        defaultSort={{ id: "sku", desc: false }}
        search={{
          placeholder: "Search SKU, item, bay",
          text: (row) => [row.sku, row.itemName, row.locationCode, row.locationName].filter(Boolean).join(" "),
        }}
        exportName="on-hand"
        empty={
          <EmptyState
            icon={Boxes}
            title="Nothing on hand yet."
            body="Stock shows here once a receipt is put away into a bay."
            action={
              <Button size="sm" asChild>
                <Link to="/inbound/receipts">Go to receipts</Link>
              </Button>
            }
          />
        }
      />
    </div>
  );
}
