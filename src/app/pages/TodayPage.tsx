import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Dashboard } from "../api";
import { ErrorBanner, PageHeader, StatusBadge } from "../components/ui";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWarehouse } from "../warehouse";
import { statusLabel } from "@/domain/status";

export function TodayPage() {
  const { warehouseId } = useWarehouse();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    api<Dashboard>(`/api/dashboard${query}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  const queues = data?.queues;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Office"
        title="Today"
        description="Work waiting on the dock, in the aisles, on the bench, and at the box."
      />
      <ErrorBanner error={error} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "To receive", value: data ? data.openReceipts + data.openPurchases : "—", to: "/inbound/purchases" },
          { label: "To put away", value: data ? data.openTransfers + (data.putawayDue ?? 0) : "—", to: "/floor/putaway" },
          { label: "To fulfill", value: data?.openOrders ?? "—", to: "/outbound/orders" },
          { label: "To replenish", value: data ? (data.replenishDue ?? 0) + (data.openReplenishments ?? 0) : "—", to: "/stock/replenish" },
        ].map((stat) => (
          <Link key={stat.label} to={stat.to}>
            <Card className="from-primary/5 to-card bg-gradient-to-t shadow-xs">
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{stat.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <QueueCard
          title="Dock receipts"
          empty="No open receipts."
          rows={(queues?.receipts ?? []).map((row) => ({
            id: row.id,
            to: `/inbound/receipts/${row.id}`,
            title: row.number,
            meta: row.notes || "Receive onto the dock",
            status: row.status,
            actionTo: `/floor/receive?id=${row.id}`,
            action: "Receive",
          }))}
        />
        <QueueCard
          title="Purchase orders"
          empty="No open purchases."
          rows={(queues?.purchases ?? []).map((row) => ({
            id: row.id,
            to: `/inbound/purchases/${row.id}`,
            title: row.number,
            meta: row.vendorName,
            status: row.status,
            actionTo: `/floor/receive?purchase=${row.id}`,
            action: "Receive",
          }))}
        />
        <QueueCard
          title="Putaway"
          empty="Nothing waiting to be put away."
          rows={[
            ...(queues?.putaways ?? []).map((row) => ({
              id: row.id,
              to: `/inbound/putaway/${row.id}`,
              title: row.number,
              meta: `${row.fromCode ?? "from"} → ${row.toCode ?? "to"}`,
              status: row.status,
              actionTo: `/floor/putaway?from=${encodeURIComponent(row.fromBarcode || row.fromCode || "")}`,
              action: "Put away",
            })),
            ...(data?.putawaySuggestions ?? []).map((row) => ({
              id: `dock-${row.fromLocationId}-${row.itemId}`,
              to: `/stock/items/${row.itemId}`,
              title: `${row.sku} × ${row.qty}`,
              meta: `${row.fromCode} → ${row.toCode}`,
              status: "dock",
              actionTo: `/floor/putaway?from=${encodeURIComponent(row.fromBarcode)}`,
              action: "Put away",
            })),
          ]}
        />
        <QueueCard
          title="Pick / pack / ship"
          empty="No open orders."
          rows={(queues?.orders ?? []).map((row) => ({
            id: row.id,
            to: `/outbound/orders/${row.id}`,
            title: `${row.number} · ${row.customerName}`,
            meta: row.source === "shopify" ? "Shopify" : "Floor order",
            status: row.status,
            actionTo: floorActionForOrder(row.status, row.id),
            action: floorLabelForOrder(row.status),
          }))}
        />
        <QueueCard
          title="Work orders"
          empty="The bench is clear."
          rows={(queues?.workOrders ?? []).map((row) => ({
            id: row.id,
            to: `/make/work-orders/${row.id}`,
            title: row.number,
            meta: `${row.sku} × ${row.qty}`,
            status: row.status,
            actionTo: `/floor/assemble?id=${row.id}`,
            action: "Assemble",
          }))}
        />
        <QueueCard
          title="Kits"
          empty="No open kits."
          rows={(queues?.kits ?? []).map((row) => ({
            id: row.id,
            to: `/make/kits/${row.id}`,
            title: row.number,
            meta: `${row.sku} × ${row.qty}`,
            status: row.status,
            actionTo: `/floor/kit?id=${row.id}`,
            action: "Kit",
          }))}
        />
        <QueueCard
          title="Replenish"
          empty="Pick faces are at min."
          rows={[
            ...(queues?.replenishments ?? []).map((row) => ({
              id: row.id,
              to: `/stock/replenish/${row.id}`,
              title: row.number,
              meta: `${row.sku} ${row.fromCode ?? "bulk"} → ${row.toCode ?? "pick"}`,
              status: row.status,
              actionTo: `/floor/replenish?id=${row.id}`,
              action: "Replenish",
            })),
            ...(data?.replenishSuggestions ?? [])
              .filter((row) => !(queues?.replenishments ?? []).some((doc) => doc.itemId === row.itemId && doc.toLocationId === row.toLocationId && doc.status !== "posted"))
              .map((row) => ({
                id: `sug-${row.itemId}-${row.toLocationId}`,
                to: "/stock/replenish",
                title: `${row.sku} × ${row.qty}`,
                meta: `${row.fromCode} → ${row.toCode} · pick ${row.pickQty}/${row.pickMin}`,
                status: "suggested",
                actionTo: "/floor/replenish",
                action: "Replenish",
              })),
          ]}
        />
        <QueueCard
          title="Returns"
          empty="No open RMAs."
          rows={(queues?.returns ?? []).map((row) => ({
            id: row.id,
            to: `/outbound/returns/${row.id}`,
            title: row.number,
            meta: row.customerName,
            status: row.status,
            actionTo: `/floor/return?id=${row.id}`,
            action: "Receive",
          }))}
        />
        <QueueCard
          title="Counts"
          empty="No open cycle counts."
          rows={(queues?.counts ?? []).map((row) => ({
            id: row.id,
            to: `/stock/counts/${row.id}`,
            title: row.number,
            meta: row.locationCode || "Bay count",
            status: row.status,
            actionTo: `/floor/count?id=${row.id}`,
            action: "Count",
          }))}
        />
        <QueueCard
          title="Shopify exceptions"
          empty="No failed or pending fulfills."
          rows={(queues?.shopifyExceptions ?? []).map((row) => ({
            id: row.id,
            to: `/outbound/orders/${row.id}`,
            title: row.shopifyOrderName || row.number,
            meta: row.shopifySyncError || row.shopifySyncStatus || "Needs attention",
            status: row.shopifySyncStatus || row.status,
            actionTo: `/outbound/orders/${row.id}`,
            action: "Open",
          }))}
        />
        <Card>
          <CardHeader>
            <CardTitle>Hot bays</CardTitle>
            <CardDescription>Where the units are sitting right now.</CardDescription>
          </CardHeader>
          <ul className="space-y-2 px-6 pb-6 text-sm">
            {data?.hotBays?.length ? (
              data.hotBays.map((row) => (
                <li key={row.locationId} className="flex justify-between gap-4 border-b py-2 last:border-0">
                  <Link className="hover:underline" to={`/map?location=${row.locationId}`}>
                    <span className="font-mono">{row.locationCode}</span> {row.locationName}
                  </Link>
                  <span className="font-mono tabular-nums">{row.units}</span>
                </li>
              ))
            ) : (
              <p className="text-muted-foreground">No occupied bays yet.</p>
            )}
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Below reorder point</CardTitle>
            <CardDescription>SKUs at or under their threshold.</CardDescription>
          </CardHeader>
          <ul className="space-y-2 px-6 pb-6 text-sm">
            {data?.lowStock.length ? (
              data.lowStock.map((row) => (
                <li key={row.itemId} className="flex justify-between gap-4 border-b py-2 last:border-0">
                  <Link className="hover:underline" to={`/stock/items/${row.itemId}`}>
                    <span className="font-mono">{row.sku}</span> {row.name}
                  </Link>
                  <span className="font-mono tabular-nums">
                    {row.onHand}/{row.reorderPoint}
                  </span>
                </li>
              ))
            ) : (
              <p className="text-muted-foreground">No SKUs are at or below their reorder point.</p>
            )}
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent movements</CardTitle>
            <CardDescription>Last ledger lines across the warehouse.</CardDescription>
          </CardHeader>
          <ul className="space-y-2 px-6 pb-6 text-sm">
            {data?.recent.length ? (
              data.recent.map((row) => (
                <li key={row.id} className="flex justify-between gap-4 border-b py-2 last:border-0">
                  <span>
                    <span className="font-mono text-xs uppercase text-muted-foreground">{row.type}</span>{" "}
                    <span className="font-medium">{row.sku}</span>
                  </span>
                  <span className="font-mono tabular-nums">{row.qty}</span>
                </li>
              ))
            ) : (
              <p className="text-muted-foreground">No ledger activity yet.</p>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function floorActionForOrder(status: string, id: string): string {
  if (status === "picked" || status === "packing") return `/floor/pack?id=${id}`;
  if (status === "packed") return `/floor/ship?id=${id}`;
  return `/floor/pick?id=${id}`;
}

function floorLabelForOrder(status: string): string {
  if (status === "picked" || status === "packing") return "Pack";
  if (status === "packed") return "Ship";
  return "Pick";
}

function QueueCard({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { id: string; to: string; title: string; meta: string; status: string; actionTo: string; action: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="px-6 pb-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
                <div>
                  <Link className="font-medium hover:underline" to={row.to}>
                    {row.title}
                  </Link>
                  <p className="text-muted-foreground">{row.meta}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={statusLabel(row.status)} />
                  <Link className="text-xs font-semibold underline-offset-4 hover:underline" to={row.actionTo}>
                    {row.action}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
