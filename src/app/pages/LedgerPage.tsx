import { ScrollText } from "lucide-react";
import { type Movement } from "../api";
import { EmptyState, PageHeader, ToneBadge } from "../components/ui";
import { DataTable, type DataColumn, type FacetDef } from "../components/data-table/DataTable";
import { Muted, PersonAvatar, RelativeTime } from "../components/cells";
import { useApiQuery } from "../query";
import { statusLabel, type StatusTone } from "@/domain/status";
import { formatCatchWeight } from "@/domain/catch-weight";
import { formatExpiresOn } from "@/domain/expiry";

const MOVEMENT_LABEL: Record<string, string> = {
  receive: "Receive",
  unreceive: "Unreceive",
  move: "Move",
  pick: "Pick",
  unpick: "Unpick",
  pack: "Pack",
  ship: "Ship",
  adjust: "Adjust",
  scrap: "Scrap",
  rtv: "Return to vendor",
  wo_consume: "WO consume",
  wo_produce: "WO produce",
  kit_consume: "Kit consume",
  kit_produce: "Kit build",
};

const MOVEMENT_TONE: Record<string, StatusTone> = {
  receive: "success",
  wo_produce: "success",
  kit_produce: "success",
  move: "info",
  pick: "progress",
  pack: "progress",
  ship: "progress",
  unreceive: "warning",
  unpick: "warning",
  adjust: "warning",
  scrap: "danger",
  rtv: "danger",
};

function movementLabel(type: string): string {
  return MOVEMENT_LABEL[type] ?? statusLabel(type);
}

function dash(value: string | null | undefined) {
  return value ? <span className="font-mono">{value}</span> : <Muted>—</Muted>;
}

const LEDGER_FACETS: FacetDef<Movement>[] = [
  { id: "type", label: "Type", value: (row) => row.type, format: movementLabel },
  { id: "who", label: "User", value: (row) => row.createdByName || null },
];

const LEDGER_COLUMNS: DataColumn<Movement>[] = [
  {
    id: "when",
    header: "When",
    sortValue: (row) => row.createdAt,
    csv: (row) => new Date(row.createdAt).toISOString(),
    cell: (row) => <RelativeTime at={row.createdAt} />,
  },
  {
    id: "who",
    header: "Who",
    sortValue: (row) => row.createdByName ?? null,
    cell: (row) =>
      row.createdByName ? (
        <span className="flex items-center gap-2">
          <PersonAvatar name={row.createdByName} />
          <span className="truncate">{row.createdByName}</span>
        </span>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "type",
    header: "Type",
    sortValue: (row) => movementLabel(row.type),
    csv: (row) => row.type,
    cell: (row) => (
      <ToneBadge tone={MOVEMENT_TONE[row.type] ?? "neutral"} className="normal-case">
        {movementLabel(row.type)}
      </ToneBadge>
    ),
  },
  {
    id: "sku",
    header: "SKU",
    sortValue: (row) => row.sku,
    cell: (row) => (
      <span className="flex min-w-0 flex-col">
        <span className="font-mono text-[13px] font-medium">{row.sku}</span>
        {row.itemName ? <span className="truncate text-xs text-muted-foreground">{row.itemName}</span> : null}
      </span>
    ),
  },
  {
    id: "qty",
    header: "Qty",
    align: "right",
    sortValue: (row) => row.qty,
    cell: (row) => <span className="font-mono">{row.qty}</span>,
  },
  {
    id: "from",
    header: "From",
    sortValue: (row) => row.fromLocationCode ?? null,
    cell: (row) => dash(row.fromLocationCode),
  },
  {
    id: "to",
    header: "To",
    sortValue: (row) => row.toLocationCode ?? null,
    cell: (row) => dash(row.toLocationCode),
  },
  {
    id: "lot",
    header: "Lot",
    sortValue: (row) => row.lotCode ?? null,
    cell: (row) => dash(row.lotCode),
  },
  {
    id: "expiry",
    header: "Expiry",
    defaultHidden: true,
    sortValue: (row) => row.expiresOn ?? null,
    csv: (row) => (row.expiresOn != null ? formatExpiresOn(row.expiresOn) : ""),
    cell: (row) =>
      row.expiresOn != null ? <span className="font-mono text-xs">{formatExpiresOn(row.expiresOn)}</span> : <Muted>—</Muted>,
  },
  {
    id: "weight",
    header: "Weight",
    defaultHidden: true,
    sortValue: (row) => row.weightGrams ?? null,
    csv: (row) => (row.weightGrams != null ? formatCatchWeight(row.weightGrams) : ""),
    cell: (row) =>
      row.weightGrams != null ? (
        <span className="font-mono text-xs">{formatCatchWeight(row.weightGrams)}</span>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "truck",
    header: "Truck",
    defaultHidden: true,
    sortValue: (row) => row.equipmentCode ?? null,
    cell: (row) => dash(row.equipmentCode),
  },
  {
    id: "reason",
    header: "Reason",
    sortValue: (row) => row.reason ?? null,
    cell: (row) => (row.reason ? <span className="text-muted-foreground">{row.reason}</span> : <Muted>—</Muted>),
  },
];

export function LedgerPage() {
  const movements = useApiQuery<Movement[]>("/api/movements");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Stock"
        title="Ledger"
        description="Every receive, move, pick, ship, kit, replenishment, scrap, and work-order movement."
      />
      <DataTable
        id="ledger"
        data={movements.data}
        loading={movements.isLoading}
        error={movements.error?.message}
        columns={LEDGER_COLUMNS}
        getRowId={(row) => row.id}
        facets={LEDGER_FACETS}
        defaultSort={{ id: "when", desc: true }}
        search={{
          placeholder: "Search SKU, bay, lot",
          text: (row) =>
            [row.sku, row.itemName, row.fromLocationCode, row.toLocationCode, row.lotCode, row.equipmentCode, row.reason]
              .filter(Boolean)
              .join(" "),
        }}
        exportName="ledger"
        empty={
          <EmptyState
            icon={ScrollText}
            title="No movements yet."
            body="Every receive, move, pick, and ship writes a line here, so you can trace where a unit went."
          />
        }
      />
    </div>
  );
}
