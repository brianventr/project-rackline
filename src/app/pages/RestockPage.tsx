import { Link } from "react-router-dom";
import { FilePlus2, PackagePlus } from "lucide-react";
import { api } from "../api";
import { Button, EmptyState, ErrorBanner, PageHeader, ToneBadge } from "../components/ui";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { Muted } from "../components/cells";
import { Term } from "../components/term";
import { useApiQuery, refreshApi } from "../query";
import { useWrite } from "../use-write";
import { useWarehouse } from "../warehouse";
import { ASN_MILESTONE_LABELS, isAsnMilestone } from "@/domain/restock";

export type RestockRow = {
  itemId: string;
  sku: string;
  name: string;
  pool: "house" | "client";
  poolKey: string;
  poolLabel: string;
  clientId: string | null;
  vendorName: string | null;
  makeDays: number;
  transitDays: number;
  leadDays: number;
  learned: boolean;
  rate: number;
  daysOfCover: number | null;
  suggestedQty: number;
  orderByAt: number | null;
  due: boolean;
  gap: "make" | "transit";
  purchaseId: string | null;
  purchaseNumber: string | null;
  asnId: string | null;
  asnNumber: string | null;
  asnMilestone: string | null;
  freightAt: number | null;
};

type RestockBoard = { policy: "off" | "alert" | "draft"; rows: RestockRow[] };

function formatRate(value: number) {
  if (!value) return "0";
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function formatWhen(at: number | null) {
  if (at == null) return "—";
  return new Date(at).toISOString().slice(0, 10);
}

function formatDays(value: number | null) {
  if (value == null) return "180d+";
  return `${value.toFixed(0)}d`;
}

function milestoneLabel(value: string | null) {
  if (!value) return null;
  return isAsnMilestone(value) ? ASN_MILESTONE_LABELS[value] : value;
}

const TABS: TabDef<RestockRow>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "due", label: "Order now", match: (row) => row.due },
  { id: "house", label: "Your stock", match: (row) => row.pool === "house" },
  { id: "client", label: "Client stock", match: (row) => row.pool === "client" },
];

const COLUMNS: DataColumn<RestockRow>[] = [
  {
    id: "sku",
    header: "SKU",
    sortValue: (row) => row.sku,
    cell: (row) => (
      <span>
        <span className="font-mono">{row.sku}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{row.name}</span>
      </span>
    ),
  },
  {
    id: "pool",
    header: "Pool",
    sortValue: (row) => row.poolLabel,
    cell: (row) => (row.pool === "house" ? "Your stock" : row.poolLabel),
  },
  {
    id: "rate",
    header: "Burn / day",
    align: "right",
    sortValue: (row) => row.rate,
    cell: (row) => <span className="font-mono">{formatRate(row.rate)}</span>,
  },
  {
    id: "cover",
    header: "Cover",
    align: "right",
    sortValue: (row) => row.daysOfCover ?? 9999,
    cell: (row) => <span className="font-mono">{formatDays(row.daysOfCover)}</span>,
  },
  {
    id: "orderBy",
    header: "Order by",
    sortValue: (row) => row.orderByAt ?? Number.MAX_SAFE_INTEGER,
    cell: (row) =>
      row.due ? <ToneBadge tone="warning">{formatWhen(row.orderByAt)}</ToneBadge> : <span className="font-mono">{formatWhen(row.orderByAt)}</span>,
  },
  {
    id: "qty",
    header: "Suggest",
    align: "right",
    sortValue: (row) => row.suggestedQty,
    cell: (row) => (row.suggestedQty > 0 ? <span className="font-mono">{row.suggestedQty}</span> : <Muted>—</Muted>),
  },
  {
    id: "lead",
    header: "Lead",
    sortValue: (row) => row.leadDays,
    cell: (row) => (
      <span className="text-sm">
        {row.makeDays}d make · {row.transitDays}d {row.learned ? "learned" : "default"}
      </span>
    ),
  },
  {
    id: "purchase",
    header: "Purchase",
    sortValue: (row) => row.purchaseNumber ?? "",
    cell: (row) =>
      row.purchaseId ? (
        <Link className="font-mono underline" to={`/inbound/purchases/${row.purchaseId}`}>
          {row.purchaseNumber}
        </Link>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "freight",
    header: "Freight",
    sortValue: (row) => row.freightAt ?? 0,
    cell: (row) =>
      row.asnId ? (
        <Link className="underline" to={`/inbound/asns/${row.asnId}`}>
          <span className="font-mono">{row.asnNumber}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {milestoneLabel(row.asnMilestone) ?? "No milestone"}
            {row.freightAt ? ` · ${formatWhen(row.freightAt)}` : ""}
          </span>
        </Link>
      ) : (
        <Muted>—</Muted>
      ),
  },
];

export function RestockPage() {
  const { warehouseId } = useWarehouse();
  const draft = useWrite();
  const query = useApiQuery<RestockBoard>(
    warehouseId ? `/api/restock?warehouseId=${encodeURIComponent(warehouseId)}` : null,
  );
  const board = query.data;
  const due = board?.rows.filter((row) => row.due).length ?? 0;

  async function draftPurchases() {
    if (!warehouseId) return;
    const created = await draft.run(
      "Draft purchases",
      () =>
        api<{ created: number; needs: { purchaseId?: string }[] }>("/api/restock/draft", {
          method: "POST",
          body: JSON.stringify({ warehouseId }),
        }),
      (result) =>
        result.created
          ? `Drafted ${result.created} ${result.created === 1 ? "purchase" : "purchases"}. Nothing was sent.`
          : "Nothing new to draft.",
    );
    if (created) void refreshApi("/api/restock");
  }

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Analytics"
        title="Restock"
        description={
          <>
            When to order each SKU so it arrives before <Term id="runway">runway</Term> runs out. Your stock and each{" "}
            <Term id="3pl-client">3PL client</Term> are separate. A draft purchase is not sent.
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/analytics/runway">Runway</Link>
            </Button>
            <Button size="sm" disabled={draft.busy || due === 0} onClick={() => void draftPurchases()}>
              <FilePlus2 className="size-4" />
              {draft.busy ? "Drafting…" : due ? `Draft purchases (${due})` : "Draft purchases"}
            </Button>
          </div>
        }
      />
      <ErrorBanner error={query.error?.message ?? draft.error} />
      {board?.policy === "off" ? (
        <p className="text-sm text-muted-foreground">
          Alerts are off. The board still shows the forecast. Turn alerts or drafts on in Settings → Warehouse.
        </p>
      ) : null}
      <DataTable
        id="restock"
        data={board?.rows}
        loading={query.isLoading}
        columns={COLUMNS}
        getRowId={(row) => `${row.itemId}:${row.poolKey}`}
        tabs={TABS}
        defaultTab="all"
        defaultSort={{ id: "orderBy", desc: false }}
        search={{
          placeholder: "Search SKU, pool, vendor",
          text: (row) => [row.sku, row.name, row.poolLabel, row.vendorName].filter(Boolean).join(" "),
        }}
        exportName="restock"
        empty={
          <EmptyState
            icon={PackagePlus}
            title="Nothing is burning yet."
            body="Ship a few orders, or set a vendor transit lane, and this board fills in from the last 30 days."
          />
        }
      />
    </div>
  );
}
