import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Dashboard, type FloorJob, type Purchase, type TeamMember } from "../api";
import { EmptyState, ErrorBanner, PageHeader, Select, StatStrip, StatusBadge } from "../components/ui";
import { useWarehouse } from "../warehouse";
import { useSession } from "../session";
import { statusLabel } from "@/domain/status";
import { formatCountVariance } from "@/domain/blind-count";
import { formatExpiresOn } from "@/domain/expiry";
import { desiredVerb } from "@/domain/jobs";
import { jobForRef, jobForSuggestion } from "../jobs";
import { cn } from "@/lib/utils";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";

const LANES = ["inbound", "outbound", "make", "stock", "exceptions"] as const;
type LaneId = (typeof LANES)[number];

const LANE_LABEL: Record<LaneId, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
  make: "Make",
  stock: "Stock",
  exceptions: "Exceptions",
};

const LANE_NEXT: Record<LaneId, string> = {
  inbound: "Receive a purchase or receipt onto the dock.",
  outbound: "Open orders stay on the floor until someone picks them.",
  make: "Start a kit or work order when a recipe is ready.",
  stock: "Scan a bay to start a count, or wait for replenishment.",
  exceptions: "Tracker exceptions and posted variances show up here.",
};

const GARAGE_LANE_NEXT: Record<LaneId, string> = {
  inbound: "Buy parts or receive them in.",
  outbound: "Orders wait here until you pick, pack, and ship them.",
  make: "Start a kit or a build when the recipe is ready.",
  stock: "The shelf is quiet. On-hand and runway live with your parts.",
  exceptions: "A label that bounced shows up here.",
};

type WorkRow = {
  id: string;
  lane: LaneId;
  queue: string;
  to: string;
  title: string;
  meta: string;
  status: string;
  actionTo: string;
  action: string;
  job?: FloorJob;
  relabel?: { orderId: string; packageId?: string };
};

export function TodayPage() {
  const { warehouseId } = useWarehouse();
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  const navigate = useNavigate();
  const [data, setData] = useState<Dashboard | null>(null);
  const [jobs, setJobs] = useState<FloorJob[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [lane, setLane] = useState<LaneId>("inbound");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  async function relabelTracker(row: WorkRow) {
    if (!row.relabel) return;
    setError(null);
    try {
      const path = row.relabel.packageId
        ? `/api/orders/${row.relabel.orderId}/packages/${row.relabel.packageId}/relabel`
        : `/api/orders/${row.relabel.orderId}/relabel`;
      await api(path, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not relabel");
    }
  }

  async function draftReorderPo() {
    if (!warehouseId) {
      setError("Select a warehouse before drafting a PO");
      return;
    }
    setError(null);
    setDrafting(true);
    try {
      const created = await api<Purchase>("/api/purchases/from-reorder", {
        method: "POST",
        body: JSON.stringify({ warehouseId }),
      });
      navigate(`/inbound/purchases/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not draft PO");
    } finally {
      setDrafting(false);
    }
  }

  const rows = useMemo(() => {
    const built = buildRows(data, jobs);
    if (!garage) return built;
    return built.filter((row) => garageAllowsPath(row.to) && garageAllowsPath(row.actionTo));
  }, [data, jobs, garage]);
  const laneRows = useMemo(
    () =>
      rows
        .filter((row) => row.lane === lane)
        .sort((a, b) => (b.job?.score ?? -1) - (a.job?.score ?? -1)),
    [rows, lane],
  );
  const laneCounts = useMemo(() => {
    const counts = { inbound: 0, outbound: 0, make: 0, stock: 0, exceptions: 0 };
    for (const row of rows) counts[row.lane] += 1;
    return counts;
  }, [rows]);

  const selected = laneRows.find((row) => row.id === selectedId) ?? laneRows[0] ?? null;
  const laneNext = garage ? GARAGE_LANE_NEXT : LANE_NEXT;

  useEffect(() => {
    if (!laneRows.length) {
      setSelectedId(null);
      return;
    }
    if (!laneRows.some((row) => row.id === selectedId)) {
      setSelectedId(laneRows[0].id);
    }
  }, [lane, laneRows, selectedId]);

  const stats = [
    { label: "To receive", value: data ? data.openReceipts + data.openPurchases + (garage ? 0 : (data.openAsns ?? 0)) : "—", to: "/inbound/purchases" },
    { label: "Yard", value: data?.openYard ?? "—", to: "/inbound/yard" },
    { label: "Vendor RTV", value: data?.openVendorReturns ?? "—", to: "/inbound/vendor-returns" },
    { label: "To put away", value: data ? data.openTransfers + (data.putawayDue ?? 0) : "—", to: "/floor/putaway" },
    { label: "To fulfill", value: data?.openOrders ?? "—", to: "/outbound/orders" },
    { label: "Waves", value: data?.openWaves ?? "—", to: "/outbound/waves" },
    { label: "To replenish", value: data ? (data.replenishDue ?? 0) + (data.openReplenishments ?? 0) : "—", to: "/stock/replenish" },
    { label: "Count variance", value: data?.countVariances ?? "—", to: "/stock/counts", tone: "warn" as const },
    { label: "On hold", value: data?.openHolds ?? "—", to: "/stock/holds", tone: "bad" as const },
    { label: "Allocated", value: data?.allocatedUnits ?? "—", to: "/outbound/orders" },
    { label: "Expiring", value: data?.expiringLots ?? "—", to: "/stock", tone: "warn" as const },
    { label: "Checked out", value: data?.openCheckouts ?? "—", to: "/equipment" },
    { label: "Out of service", value: data?.outOfService ?? "—", to: "/equipment", tone: "bad" as const },
    { label: "Certs due", value: data?.expiringCerts ?? "—", to: "/setup/team", tone: "warn" as const },
    { label: "Runs out", value: data?.runwayThisWeek?.length ?? "—", to: "/analytics/runway", tone: "warn" as const },
  ].filter((item) => !garage || garageAllowsPath(item.to));

  return (
    <div className="-mx-3 -my-2 flex h-[calc(100dvh-var(--header-height))] min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <PageHeader
          eyebrow={garage ? "Garage Mode" : "Office"}
          title="Today"
          description={
            garage
              ? "Small scale for today: receive, make, pick, and ship. The same records open in Manufacturer."
              : "Dispatch board: assign floor jobs, or leave them unassigned so the next scan claims them."
          }
        />
        <ErrorBanner error={error} />
      </div>
      <StatStrip items={stats} />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-36 shrink-0 flex-col border-r bg-card text-xs">
          {LANES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setLane(id)}
              className={cn(
                "flex items-center justify-between px-3 py-1.5 text-left hover:bg-muted/70",
                lane === id && "bg-muted font-medium",
              )}
            >
              <span>{LANE_LABEL[id]}</span>
              <span className="tabular-nums text-muted-foreground">{laneCounts[id]}</span>
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th className="px-2.5 py-1.5 font-medium">Queue</th>
                <th className="px-2.5 py-1.5 font-medium">Document</th>
                <th className="px-2.5 py-1.5 font-medium">Status</th>
                <th className="px-2.5 py-1.5 font-medium">Bay / reason</th>
                {garage ? null : <th className="px-2.5 py-1.5 font-medium">Assignee</th>}
                <th className="px-2.5 py-1.5 font-medium">Act</th>
              </tr>
            </thead>
            <tbody>
              {laneRows.length ? (
                laneRows.map((row) => {
                  const active = selected?.id === row.id;
                  return (
                    <tr
                      key={row.id}
                      className={cn("cursor-pointer border-b hover:bg-muted/50", active && "bg-muted")}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="px-2.5 py-1.5 text-muted-foreground">{row.queue}</td>
                      <td className="px-2.5 py-1.5">
                        <Link className="font-medium hover:underline" to={row.to} onClick={(event) => event.stopPropagation()}>
                          {row.title}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">{row.meta}</p>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <StatusBadge status={statusLabel(row.status)} />
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {bayFor(row.job) || row.job?.reason || "—"}
                      </td>
                      {garage ? null : (
                      <td className="px-2.5 py-1.5" onClick={(event) => event.stopPropagation()}>
                        {row.job ? (
                          <div className="flex items-center gap-1.5">
                            <Select
                              className="h-7 w-32 text-xs"
                              value={row.job.assigneeId ?? ""}
                              onChange={(e) => assign(row.job!.id, e.target.value || null)}
                            >
                              <option value="">Unassigned</option>
                              {team.map((member) => (
                                <option key={member.userId} value={member.userId}>
                                  {member.name}
                                </option>
                              ))}
                            </Select>
                            {me.role === "owner" ? (
                              <button
                                type="button"
                                className="text-[11px] font-semibold hover:underline"
                                onClick={() => pin(row.job!.id, !row.job!.pinned)}
                              >
                                {row.job.pinned ? "Unpin" : "Pin"}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                      )}
                      <td className="px-2.5 py-1.5">
                        {row.relabel ? (
                          <button
                            type="button"
                            className="font-semibold hover:underline"
                            onClick={(event) => {
                              event.stopPropagation();
                              void relabelTracker(row);
                            }}
                          >
                            Relabel
                          </button>
                        ) : (
                          <Link className="font-semibold hover:underline" to={row.actionTo} onClick={(event) => event.stopPropagation()}>
                            {row.action}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-2.5 py-4" colSpan={garage ? 5 : 6}>
                    <EmptyState
                      title={`Nothing in ${LANE_LABEL[lane].toLowerCase()} right now.`}
                      body={laneNext[lane]}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <aside className="hidden w-72 shrink-0 overflow-auto border-l bg-card text-xs xl:block">
          {selected ? (
            <div className="border-b px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{selected.queue}</p>
              <Link className="mt-0.5 block font-semibold hover:underline" to={selected.to}>
                {selected.title}
              </Link>
              <p className="mt-0.5 text-muted-foreground">{selected.meta}</p>
              {selected.job?.reason ? <p className="mt-1 text-muted-foreground">{selected.job.reason}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={statusLabel(selected.status)} />
                {selected.relabel ? (
                  <button type="button" className="font-semibold hover:underline" onClick={() => void relabelTracker(selected)}>
                    Relabel
                  </button>
                ) : (
                  <Link className="font-semibold hover:underline" to={selected.actionTo}>
                    {selected.action}
                  </Link>
                )}
              </div>
            </div>
          ) : null}
          <InspectorList
            title="Below reorder"
            empty="No SKUs at reorder."
            action={
              <button
                type="button"
                className="font-semibold hover:underline disabled:opacity-50"
                disabled={drafting || !data?.lowStock.length}
                onClick={() => void draftReorderPo()}
              >
                {drafting ? "Drafting…" : "Draft PO"}
              </button>
            }
            rows={(data?.lowStock ?? []).map((row) => ({
              id: row.itemId,
              to: `/stock/items/${row.itemId}`,
              title: row.sku,
              meta: `${row.onHand}/${row.reorderPoint}${row.suggestedQty ? ` · +${row.suggestedQty}` : ""}${row.coveredByOpenPo ? " · open PO" : ""}`,
            }))}
          />
          <InspectorList
            title="Runs out this week"
            empty="No SKUs run out in 7 days."
            action={
              <Link className="font-semibold hover:underline" to="/analytics/runway">
                Runway
              </Link>
            }
            rows={(data?.runwayThisWeek ?? []).map((row) => ({
              id: row.itemId,
              to: `/stock/items/${row.itemId}`,
              title: row.sku,
              meta: `${row.daysOfCover != null ? `${row.daysOfCover.toFixed(1)}d` : "out"}${row.suggestedQty ? ` · +${row.suggestedQty}` : ""}${row.coveredByOpenPo ? " · open PO" : ""}`,
            }))}
          />
          <InspectorList
            title="Hot bays"
            empty="No occupied bays."
            rows={(data?.hotBays ?? []).map((row) => ({
              id: row.locationId,
              to: `/map?location=${row.locationId}`,
              title: row.locationCode,
              meta: String(row.units),
            }))}
          />
          <InspectorList
            title="Recent movements"
            empty="No ledger activity."
            rows={(data?.recent ?? []).map((row) => ({
              id: row.id,
              to: "/stock/ledger",
              title: row.sku,
              meta: `${row.type} · ${row.qty}`,
            }))}
          />
        </aside>
      </div>
    </div>
  );
}

function InspectorList({
  title,
  empty,
  action,
  rows,
}: {
  title: string;
  empty: string;
  action?: ReactNode;
  rows: { id: string; to: string; title: string; meta: string }[];
}) {
  return (
    <section className="border-b px-3 py-2 last:border-b-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        {action}
      </div>
      {rows.length ? (
        <ul className="space-y-0.5">
          {rows.slice(0, 8).map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2">
              <Link className="truncate font-mono hover:underline" to={row.to}>
                {row.title}
              </Link>
              <span className="shrink-0 tabular-nums text-muted-foreground">{row.meta}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function bayFor(job?: FloorJob) {
  if (!job) return "";
  return [job.fromCode, job.toCode].filter(Boolean).join(" → ");
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

function buildRows(data: Dashboard | null, jobs: FloorJob[]): WorkRow[] {
  const queues = data?.queues;
  if (!queues) return [];
  const rows: WorkRow[] = [
    ...(queues.receipts ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "Receipt",
      to: `/inbound/receipts/${row.id}`,
      title: row.number,
      meta: row.notes || "Receive onto the dock",
      status: row.status,
      actionTo: `/floor/receive?id=${row.id}`,
      action: "Receive",
      job: jobForRef(jobs, "receipt", row.id, "receive"),
    })),
    ...(queues.purchases ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "PO",
      to: `/inbound/purchases/${row.id}`,
      title: row.number,
      meta: row.vendorName,
      status: row.status,
      actionTo: `/floor/receive?purchase=${row.id}`,
      action: "Receive",
      job: jobForRef(jobs, "purchase", row.id, "receive"),
    })),
    ...(queues.putaways ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "Putaway",
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
      lane: "inbound" as const,
      queue: "Putaway",
      to: `/stock/items/${row.itemId}`,
      title: `${row.sku} × ${row.qty}`,
      meta: `${row.fromCode} → ${row.toCode}`,
      status: "dock",
      actionTo: `/floor/putaway?from=${encodeURIComponent(row.fromBarcode)}`,
      action: "Put away",
      job: jobForSuggestion(jobs, "putawaySuggestion", row.fromLocationId, row.itemId, row.toLocationId),
    })),
    ...(queues.asns ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "ASN",
      to: `/inbound/asns/${row.id}`,
      title: row.number,
      meta: row.vendorName,
      status: row.status,
      actionTo: `/floor/asn?id=${row.id}`,
      action: "Receive",
    })),
    ...(queues.yard ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "Yard",
      to: `/inbound/yard/${row.id}`,
      title: row.number,
      meta: `${row.carrierName}${row.trailerNumber ? ` · ${row.trailerNumber}` : ""}`,
      status: row.status,
      actionTo: `/floor/yard?id=${row.id}`,
      action: "Yard",
    })),
    ...(queues.vendorReturns ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "RTV",
      to: `/inbound/vendor-returns/${row.id}`,
      title: row.number,
      meta: row.vendorName,
      status: row.status,
      actionTo: `/floor/rtv?id=${row.id}`,
      action: "Return",
      job: jobForRef(jobs, "vendorReturn", row.id, "rtv"),
    })),
    ...(queues.orders ?? []).map((row) => ({
      id: row.id,
      lane: "outbound" as const,
      queue: "Order",
      to: `/outbound/orders/${row.id}`,
      title: `${row.number} · ${row.customerName}`,
      meta: row.source === "shopify" ? "Shopify" : "Floor order",
      status: row.status,
      actionTo: floorActionForOrder(row.status, row.id),
      action: floorLabelForOrder(row.status),
      job: jobForRef(jobs, "order", row.id, desiredVerb("order", row.status) ?? undefined),
    })),
    ...(queues.waves ?? []).map((row) => ({
      id: row.id,
      lane: "outbound" as const,
      queue: "Wave",
      to: `/outbound/waves/${row.id}`,
      title: row.number,
      meta: `${row.mode} · ${row.orderCount ?? 0} orders`,
      status: row.status,
      actionTo: `/floor/wave?id=${row.id}`,
      action: "Wave",
    })),
    ...(queues.returns ?? []).map((row) => ({
      id: row.id,
      lane: "outbound" as const,
      queue: "RMA",
      to: `/outbound/returns/${row.id}`,
      title: row.number,
      meta: row.customerName,
      status: row.status,
      actionTo: `/floor/return?id=${row.id}`,
      action: "Receive",
      job: jobForRef(jobs, "rma", row.id, "return"),
    })),
    ...(queues.workOrders ?? []).map((row) => ({
      id: row.id,
      lane: "make" as const,
      queue: "WO",
      to: `/make/work-orders/${row.id}`,
      title: row.number,
      meta: `${row.sku} × ${row.qtyCompleted ?? 0}/${row.qty}`,
      status: row.status,
      actionTo: `/floor/assemble?id=${row.id}`,
      action: "Assemble",
      job: jobForRef(jobs, "workOrder", row.id, "assemble"),
    })),
    ...(queues.kits ?? []).map((row) => ({
      id: row.id,
      lane: "make" as const,
      queue: "Kit",
      to: `/make/kits/${row.id}`,
      title: row.number,
      meta: `${row.sku} × ${row.qtyCompleted ?? 0}/${row.qty}`,
      status: row.status,
      actionTo: `/floor/kit?id=${row.id}`,
      action: "Kit",
      job: jobForRef(jobs, "kit", row.id, "kit"),
    })),
    ...(queues.replenishments ?? []).map((row) => ({
      id: row.id,
      lane: "stock" as const,
      queue: "Replenish",
      to: `/stock/replenish/${row.id}`,
      title: row.number,
      meta: `${row.sku} ${row.qtyMoved ?? 0}/${row.qty} · ${row.fromCode ?? "bulk"} → ${row.toCode ?? "pick"}`,
      status: row.status,
      actionTo: `/floor/replenish?id=${row.id}`,
      action: "Replenish",
      job: jobForRef(jobs, "replenishment", row.id, "replenish"),
    })),
    ...(data?.replenishSuggestions ?? [])
      .filter((row) => !(queues.replenishments ?? []).some((doc) => doc.itemId === row.itemId && doc.toLocationId === row.toLocationId && doc.status !== "posted"))
      .map((row) => ({
        id: `sug-${row.itemId}-${row.toLocationId}`,
        lane: "stock" as const,
        queue: "Replenish",
        to: "/stock/replenish",
        title: `${row.sku} × ${row.qty}`,
        meta: `${row.fromCode} → ${row.toCode} · pick ${row.pickQty}/${row.pickMin}`,
        status: "suggested",
        actionTo: "/floor/replenish",
        action: "Replenish",
        job: jobForSuggestion(jobs, "replenishSuggestion", row.fromLocationId, row.itemId, row.toLocationId),
      })),
    ...(queues.holds ?? []).map((row) => ({
      id: row.id,
      lane: "stock" as const,
      queue: "Hold",
      to: `/stock/holds/${row.id}`,
      title: row.number,
      meta: `${row.sku ? `${row.sku}${row.lotCode ? ` ${row.lotCode}` : ""} @ ` : ""}${row.locationCode || "bay"} · ${row.reason}`,
      status: row.status,
      actionTo: `/floor/hold?id=${row.id}`,
      action: "Release",
      job: jobForRef(jobs, "hold", row.id, "hold"),
    })),
    ...(queues.counts ?? []).map((row) => ({
      id: row.id,
      lane: "stock" as const,
      queue: "Count",
      to: `/stock/counts/${row.id}`,
      title: row.number,
      meta: row.locationCode || "Bay count",
      status: row.status,
      actionTo: `/floor/count?id=${row.id}`,
      action: "Count",
      job: jobForRef(jobs, "cycleCount", row.id, "count"),
    })),
    ...(queues.countVariances ?? []).map((row) => ({
      id: row.id,
      lane: "stock" as const,
      queue: "Variance",
      to: `/stock/counts/${row.countId}`,
      title: `${row.sku} ${formatCountVariance(row.variance)}`,
      meta: `${row.number} · ${row.locationCode || "bay"} · counted ${row.countedQty} vs ${row.systemQty}`,
      status: "variance",
      actionTo: `/stock/counts/${row.countId}`,
      action: "Review",
    })),
    ...(queues.expiringLots ?? []).map((row) => ({
      id: `${row.locationId}:${row.itemId}:${row.lotCode}`,
      lane: "stock" as const,
      queue: "FEFO",
      to: `/stock/items/${row.itemId}`,
      title: `${row.sku} ${row.lotCode}`,
      meta: `${row.locationCode} · ${row.qty} · ${formatExpiresOn(row.expiresOn)}`,
      status: "expiring",
      actionTo: `/stock/items/${row.itemId}`,
      action: "Open",
    })),
    ...(data?.runwayThisWeek ?? []).map((row) => ({
      id: `runway-${row.itemId}`,
      lane: "stock" as const,
      queue: "Runway",
      to: `/stock/items/${row.itemId}`,
      title: `${row.sku} ${row.name}`,
      meta: `${row.daysOfCover != null ? `${row.daysOfCover.toFixed(1)}d` : "out"}${row.suggestedQty ? ` · +${row.suggestedQty}` : ""}${row.coveredByOpenPo ? " · open PO" : ""}`,
      status: "runway",
      actionTo: "/analytics/runway",
      action: "Runway",
    })),
    ...(queues.shopifyExceptions ?? []).map((row) => ({
      id: `shopify-${row.id}`,
      lane: "exceptions" as const,
      queue: "Shopify",
      to: `/outbound/orders/${row.id}`,
      title: row.shopifyOrderName || row.number,
      meta: row.shopifySyncError || row.shopifySyncStatus || "Needs attention",
      status: row.shopifySyncStatus || row.status,
      actionTo: `/outbound/orders/${row.id}`,
      action: "Open",
    })),
    ...(queues.trackerExceptions ?? []).map((row) => ({
      id: row.id,
      lane: "exceptions" as const,
      queue: "Tracker",
      to: `/outbound/orders/${row.orderId}`,
      title: row.packageNumber ? `${row.number} ${row.packageNumber}` : row.number,
      meta: row.trackingNumber ? `${row.trackingNumber} · ${row.trackerStatus}` : row.trackerStatus,
      status: "exception",
      actionTo: `/outbound/orders/${row.orderId}`,
      action: "Relabel",
      relabel: { orderId: row.orderId, packageId: row.packageNumber ? row.id : undefined },
    })),
    ...(queues.checkouts ?? []).map((row) => ({
      id: row.id,
      lane: "exceptions" as const,
      queue: "Checkout",
      to: `/equipment/${row.equipmentId}`,
      title: row.equipmentCode,
      meta: `${row.operatorName}${row.shift ? ` · ${row.shift}` : ""}${row.taskNumber || row.refType ? ` · ${row.taskNumber || row.refType}` : ""}`,
      status: row.status,
      actionTo: `/floor/checkout?id=${row.equipmentId}`,
      action: "Check in",
    })),
    ...(queues.outOfService ?? []).map((row) => ({
      id: row.id,
      lane: "exceptions" as const,
      queue: "OOS",
      to: `/equipment/${row.id}`,
      title: row.code,
      meta: row.name,
      status: row.status,
      actionTo: `/equipment/${row.id}`,
      action: "Open",
    })),
    ...(queues.expiringCerts ?? []).map((row) => ({
      id: row.id,
      lane: "exceptions" as const,
      queue: "Cert",
      to: "/setup/team",
      title: row.userName || row.userId,
      meta: `${row.class} · ${formatExpiresOn(row.expiresOn)}`,
      status: "expiring",
      actionTo: "/setup/team",
      action: "Team",
    })),
  ];
  return rows;
}
