import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Dashboard, type FloorJob, type TeamMember } from "../api";
import { ErrorBanner, PageHeader, Select, StatusBadge } from "../components/ui";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWarehouse } from "../warehouse";
import { useSession } from "../session";
import { statusLabel } from "@/domain/status";
import { formatCountVariance } from "@/domain/blind-count";
import { formatExpiresOn } from "@/domain/expiry";
import { desiredVerb } from "@/domain/jobs";
import { jobForRef, jobForSuggestion } from "../jobs";

export function TodayPage() {
  const { warehouseId } = useWarehouse();
  const me = useSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [jobs, setJobs] = useState<FloorJob[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    const [nextDashboard, nextJobs, nextTeam] = await Promise.all([
      api<Dashboard>(`/api/dashboard${query}`),
      api<FloorJob[]>(`/api/jobs${query}${query ? "&" : "?"}open=1`),
      api<TeamMember[]>("/api/team"),
    ]);
    setData(nextDashboard);
    setJobs(nextJobs);
    setTeam(nextTeam);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  async function assign(jobId: string, userId: string | null) {
    setError(null);
    try {
      await api(`/api/jobs/${jobId}/assign`, { method: "POST", body: JSON.stringify({ userId }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign");
    }
  }

  async function pin(jobId: string, pinned: boolean) {
    setError(null);
    try {
      await api(`/api/jobs/${jobId}/pin`, { method: "POST", body: JSON.stringify({ pinned }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pin");
    }
  }

  const queues = data?.queues;
  const dispatch = { team, role: me.role, onAssign: assign, onPin: pin };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Office"
        title="Today"
        description="Dispatch board: assign floor jobs, or leave them unassigned so the next scan claims them."
      />
      <ErrorBanner error={error} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "To receive", value: data ? data.openReceipts + data.openPurchases : "—", to: "/inbound/purchases" },
          { label: "Vendor RTV", value: data?.openVendorReturns ?? "—", to: "/inbound/vendor-returns" },
          { label: "To put away", value: data ? data.openTransfers + (data.putawayDue ?? 0) : "—", to: "/floor/putaway" },
          { label: "To fulfill", value: data?.openOrders ?? "—", to: "/outbound/orders" },
          { label: "To replenish", value: data ? (data.replenishDue ?? 0) + (data.openReplenishments ?? 0) : "—", to: "/stock/replenish" },
          { label: "Count variance", value: data?.countVariances ?? "—", to: "/stock/counts" },
          { label: "On hold", value: data?.openHolds ?? "—", to: "/stock/holds" },
          { label: "Allocated", value: data?.allocatedUnits ?? "—", to: "/outbound/orders" },
          { label: "Expiring", value: data?.expiringLots ?? "—", to: "/stock" },
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
          dispatch={dispatch}
          rows={(queues?.receipts ?? []).map((row) => ({
            id: row.id,
            to: `/inbound/receipts/${row.id}`,
            title: row.number,
            meta: row.notes || "Receive onto the dock",
            status: row.status,
            actionTo: `/floor/receive?id=${row.id}`,
            action: "Receive",
            job: jobForRef(jobs, "receipt", row.id, "receive"),
          }))}
        />
        <QueueCard
          title="Purchase orders"
          empty="No open purchases."
          dispatch={dispatch}
          rows={(queues?.purchases ?? []).map((row) => ({
            id: row.id,
            to: `/inbound/purchases/${row.id}`,
            title: row.number,
            meta: row.vendorName,
            status: row.status,
            actionTo: `/floor/receive?purchase=${row.id}`,
            action: "Receive",
            job: jobForRef(jobs, "purchase", row.id, "receive"),
          }))}
        />
        <QueueCard
          title="Putaway"
          empty="Nothing waiting to be put away."
          dispatch={dispatch}
          rows={[
            ...(queues?.putaways ?? []).map((row) => ({
              id: row.id,
              to: `/inbound/putaway/${row.id}`,
              title: row.number,
              meta: `${row.fromCode ?? "from"} → ${row.toCode ?? "to"}`,
              status: row.status,
              actionTo: `/floor/putaway?id=${row.id}`,
              action: "Put away",
              job: jobForRef(jobs, "transfer", row.id, "putaway"),
            })),
            ...(data?.putawaySuggestions ?? []).map((row) => ({
              id: `dock-${row.fromLocationId}-${row.itemId}`,
              to: `/stock/items/${row.itemId}`,
              title: `${row.sku} × ${row.qty}`,
              meta: `${row.fromCode} → ${row.toCode}`,
              status: "dock",
              actionTo: `/floor/putaway?from=${encodeURIComponent(row.fromBarcode)}`,
              action: "Put away",
              job: jobForSuggestion(jobs, "putawaySuggestion", row.fromLocationId, row.itemId, row.toLocationId),
            })),
          ]}
        />
        <QueueCard
          title="Pick / pack / ship"
          empty="No open orders."
          dispatch={dispatch}
          rows={(queues?.orders ?? []).map((row) => ({
            id: row.id,
            to: `/outbound/orders/${row.id}`,
            title: `${row.number} · ${row.customerName}`,
            meta: row.source === "shopify" ? "Shopify" : "Floor order",
            status: row.status,
            actionTo: floorActionForOrder(row.status, row.id),
            action: floorLabelForOrder(row.status),
            job: jobForRef(jobs, "order", row.id, desiredVerb("order", row.status) ?? undefined),
          }))}
        />
        <QueueCard
          title="Work orders"
          empty="The bench is clear."
          dispatch={dispatch}
          rows={(queues?.workOrders ?? []).map((row) => ({
            id: row.id,
            to: `/make/work-orders/${row.id}`,
            title: row.number,
            meta: `${row.sku} × ${row.qtyCompleted ?? 0}/${row.qty}`,
            status: row.status,
            actionTo: `/floor/assemble?id=${row.id}`,
            action: "Assemble",
            job: jobForRef(jobs, "workOrder", row.id, "assemble"),
          }))}
        />
        <QueueCard
          title="Kits"
          empty="No open kits."
          dispatch={dispatch}
          rows={(queues?.kits ?? []).map((row) => ({
            id: row.id,
            to: `/make/kits/${row.id}`,
            title: row.number,
            meta: `${row.sku} × ${row.qtyCompleted ?? 0}/${row.qty}`,
            status: row.status,
            actionTo: `/floor/kit?id=${row.id}`,
            action: "Kit",
            job: jobForRef(jobs, "kit", row.id, "kit"),
          }))}
        />
        <QueueCard
          title="Replenish"
          empty="Pick faces are at min."
          dispatch={dispatch}
          rows={[
            ...(queues?.replenishments ?? []).map((row) => ({
              id: row.id,
              to: `/stock/replenish/${row.id}`,
              title: row.number,
              meta: `${row.sku} ${row.qtyMoved ?? 0}/${row.qty} · ${row.fromCode ?? "bulk"} → ${row.toCode ?? "pick"}`,
              status: row.status,
              actionTo: `/floor/replenish?id=${row.id}`,
              action: "Replenish",
              job: jobForRef(jobs, "replenishment", row.id, "replenish"),
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
                job: jobForSuggestion(jobs, "replenishSuggestion", row.fromLocationId, row.itemId, row.toLocationId),
              })),
          ]}
        />
        <QueueCard
          title="Vendor returns"
          empty="No open vendor returns."
          dispatch={dispatch}
          rows={(queues?.vendorReturns ?? []).map((row) => ({
            id: row.id,
            to: `/inbound/vendor-returns/${row.id}`,
            title: row.number,
            meta: row.vendorName,
            status: row.status,
            actionTo: `/floor/rtv?id=${row.id}`,
            action: "Return",
            job: jobForRef(jobs, "vendorReturn", row.id, "rtv"),
          }))}
        />
        <QueueCard
          title="Returns"
          empty="No open RMAs."
          dispatch={dispatch}
          rows={(queues?.returns ?? []).map((row) => ({
            id: row.id,
            to: `/outbound/returns/${row.id}`,
            title: row.number,
            meta: row.customerName,
            status: row.status,
            actionTo: `/floor/return?id=${row.id}`,
            action: "Receive",
            job: jobForRef(jobs, "rma", row.id, "return"),
          }))}
        />
        <QueueCard
          title="Holds"
          empty="Nothing is on hold."
          dispatch={dispatch}
          rows={(queues?.holds ?? []).map((row) => ({
            id: row.id,
            to: `/stock/holds/${row.id}`,
            title: row.number,
            meta: `${row.sku ? `${row.sku}${row.lotCode ? ` ${row.lotCode}` : ""} @ ` : ""}${row.locationCode || "bay"} · ${row.reason}`,
            status: row.status,
            actionTo: `/floor/hold?id=${row.id}`,
            action: "Release",
            job: jobForRef(jobs, "hold", row.id, "hold"),
          }))}
        />
        <QueueCard
          title="Counts"
          empty="No open cycle counts."
          dispatch={dispatch}
          rows={(queues?.counts ?? []).map((row) => ({
            id: row.id,
            to: `/stock/counts/${row.id}`,
            title: row.number,
            meta: row.locationCode || "Bay count",
            status: row.status,
            actionTo: `/floor/count?id=${row.id}`,
            action: "Count",
            job: jobForRef(jobs, "cycleCount", row.id, "count"),
          }))}
        />
        <QueueCard
          title="Count variance"
          empty="No posted count variances."
          rows={(queues?.countVariances ?? []).map((row) => ({
            id: row.id,
            to: `/stock/counts/${row.countId}`,
            title: `${row.sku} ${formatCountVariance(row.variance)}`,
            meta: `${row.number} · ${row.locationCode || "bay"} · counted ${row.countedQty} vs ${row.systemQty}`,
            status: "variance",
            actionTo: `/stock/counts/${row.countId}`,
            action: "Review",
          }))}
        />
        <QueueCard
          title="Expiring lots"
          empty="Nothing expiring in the next 14 days."
          rows={(queues?.expiringLots ?? []).map((row) => ({
            id: `${row.locationId}:${row.itemId}:${row.lotCode}`,
            to: `/stock/items/${row.itemId}`,
            title: `${row.sku} ${row.lotCode}`,
            meta: `${row.locationCode} · ${row.qty} · ${formatExpiresOn(row.expiresOn)}`,
            status: "expiring",
            actionTo: `/stock/items/${row.itemId}`,
            action: "Open",
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

type Dispatch = {
  team: TeamMember[];
  role: string;
  onAssign: (jobId: string, userId: string | null) => void;
  onPin: (jobId: string, pinned: boolean) => void;
};

function QueueCard({
  title,
  empty,
  rows,
  dispatch,
}: {
  title: string;
  empty: string;
  dispatch?: Dispatch;
  rows: {
    id: string;
    to: string;
    title: string;
    meta: string;
    status: string;
    actionTo: string;
    action: string;
    job?: FloorJob;
  }[];
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
            {[...rows]
              .sort((a, b) => (b.job?.score ?? -1) - (a.job?.score ?? -1))
              .map((row) => (
              <li key={row.id} className="flex flex-col gap-2 border-b py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link className="font-medium hover:underline" to={row.to}>
                    {row.title}
                  </Link>
                  <p className="text-muted-foreground">{row.meta}</p>
                  {row.job?.reason ? <p className="text-xs text-muted-foreground">{row.job.reason}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={statusLabel(row.status)} />
                  {row.job && dispatch ? (
                    <>
                      <Select
                        className="h-8 w-36 text-xs"
                        value={row.job.assigneeId ?? ""}
                        onChange={(e) => dispatch.onAssign(row.job!.id, e.target.value || null)}
                      >
                        <option value="">Unassigned</option>
                        {dispatch.team.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.name}
                          </option>
                        ))}
                      </Select>
                      {dispatch.role === "owner" ? (
                        <button
                          type="button"
                          className="text-xs font-semibold underline-offset-4 hover:underline"
                          onClick={() => dispatch.onPin(row.job!.id, !row.job!.pinned)}
                        >
                          {row.job.pinned ? "Unpin" : "Pin"}
                        </button>
                      ) : null}
                    </>
                  ) : dispatch ? (
                    <span className="text-xs text-muted-foreground">Unassigned</span>
                  ) : null}
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
