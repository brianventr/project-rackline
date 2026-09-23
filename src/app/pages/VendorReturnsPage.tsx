import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowUpFromLine, Play, Plus, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { api, type Item, type Location, type Purchase, type VendorReturn } from "../api";
import { Button, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, summarizeLines } from "../components/ui";
import {
  DetailSkeleton,
  DocumentActivity,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type BulkAction, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, ProgressCell, ProgressRow, RelativeTime, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { apiMutate, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { STEP_RULES } from "@/domain/step-stamps";
import { VENDOR_RETURN_STEPS, canPostVendorReturn, isOpenVendorReturn } from "@/domain/status";
import { hasUnreturned } from "@/domain/partial-rtv";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields, LinesBar, RailCard, countOf, runEach, unitCount } from "./ReceiptsPage";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";

type Line = { itemId: string; qty: string };

export function VendorReturnsPage() {
  const { id } = useParams();
  if (id) return <VendorReturnDetail id={id} />;
  return <VendorReturnList />;
}

function rtvUnits(rtv: VendorReturn) {
  const lines = rtv.lines ?? [];
  return {
    expected: lines.reduce((sum, line) => sum + line.qtyExpected, 0),
    returned: lines.reduce((sum, line) => sum + (line.qtyReturned ?? 0), 0),
  };
}

function rtvChips(rtv: VendorReturn) {
  return (rtv.lines ?? []).map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qtyExpected }));
}

const RTV_TABS: TabDef<VendorReturn>[] = [
  { id: "active", label: "Active", match: (rtv) => isOpenVendorReturn(rtv.status) },
  { id: "open", label: "Open", match: (rtv) => rtv.status === "open" },
  { id: "returning", label: "Returning", match: (rtv) => rtv.status === "returning" },
  { id: "returned", label: "Returned", match: (rtv) => rtv.status === "returned" },
  { id: "all", label: "All", match: () => true },
];

const RTV_FACETS: FacetDef<VendorReturn>[] = [{ id: "vendor", label: "Vendor", value: (rtv) => rtv.vendorName }];

const RTV_COLUMNS: DataColumn<VendorReturn>[] = [
  {
    id: "number",
    header: "Return",
    sortValue: (rtv) => rtv.number,
    cell: (rtv) => <DocLink to={`/inbound/vendor-returns/${rtv.id}`}>{rtv.number}</DocLink>,
  },
  {
    id: "vendor",
    header: "Vendor",
    sortValue: (rtv) => rtv.vendorName,
    cell: (rtv) => (
      <span className="flex flex-col">
        <span className="font-medium">{rtv.vendorName}</span>
        {rtv.notes ? <span className="line-clamp-1 text-xs text-muted-foreground">{rtv.notes}</span> : null}
      </span>
    ),
  },
  {
    id: "purchase",
    header: "Purchase",
    sortValue: (rtv) => rtv.purchaseNumber ?? null,
    csv: (rtv) => rtv.purchaseNumber ?? "",
    cell: (rtv) =>
      rtv.purchaseId ? (
        <DocLink to={`/inbound/purchases/${rtv.purchaseId}`} className="font-normal">
          {rtv.purchaseNumber || "PO"}
        </DocLink>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "lines",
    header: "Lines",
    csv: (rtv) => summarizeLines(rtvChips(rtv)),
    cell: (rtv) => <LineChips lines={rtvChips(rtv)} />,
  },
  {
    id: "returned",
    header: "Returned",
    sortValue: (rtv) => {
      const units = rtvUnits(rtv);
      return units.expected ? units.returned / units.expected : 0;
    },
    csv: (rtv) => {
      const units = rtvUnits(rtv);
      return `${units.returned}/${units.expected}`;
    },
    cell: (rtv) => {
      const units = rtvUnits(rtv);
      return <ProgressCell done={units.returned} total={units.expected} />;
    },
  },
  {
    id: "created",
    header: "Created",
    sortValue: (rtv) => rtv.createdAt,
    csv: (rtv) => new Date(rtv.createdAt).toISOString(),
    cell: (rtv) => <RelativeTime at={rtv.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (rtv) => VENDOR_RETURN_STEPS.indexOf(rtv.status as (typeof VENDOR_RETURN_STEPS)[number]),
    csv: (rtv) => rtv.status,
    cell: (rtv) => <StatusBadge status={rtv.status} />,
  },
];

const RTV_BULK: BulkAction<VendorReturn>[] = [
  {
    label: "Start",
    icon: Play,
    when: (selected) => selected.every((rtv) => rtv.status === "open"),
    run: (selected) =>
      runEach(selected, (rtv) => api(`/api/vendor-returns/${rtv.id}/start`, { method: "POST" }), {
        done: (count) => `Started ${countOf(count, "vendor return")}.`,
        failed: "could not start",
      }),
  },
];

function VendorReturnList() {
  const { warehouseId } = useWarehouse();
  const returns = useApiQuery<VendorReturn[]>("/api/vendor-returns");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => inWarehouse(returns.data ?? [], warehouseId), [returns.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Inbound"
        title="Vendor returns"
        description="RTV stock back to a vendor from a bay. Partial qty is allowed; over-return is blocked."
      />
      <DataTable
        id="vendor-returns"
        data={rows}
        loading={returns.isLoading}
        error={returns.error?.message}
        columns={RTV_COLUMNS}
        getRowId={(rtv) => rtv.id}
        rowHref={(rtv) => `/inbound/vendor-returns/${rtv.id}`}
        tabs={RTV_TABS}
        defaultTab="active"
        facets={RTV_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search return, vendor, purchase, SKU",
          text: (rtv) =>
            [rtv.number, rtv.vendorName, rtv.purchaseNumber, rtv.notes, ...(rtv.lines ?? []).map((line) => line.sku)]
              .filter(Boolean)
              .join(" "),
        }}
        bulkActions={RTV_BULK}
        exportName="vendor-returns"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New vendor return
          </Button>
        }
        empty={
          <EmptyState
            icon={ArrowUpFromLine}
            title="No vendor returns yet."
            body="Send wrong or damaged stock back to the vendor from a bay. Tie it to the original purchase when there is one."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New vendor return
              </Button>
            }
          />
        }
      />
      <NewVendorReturnSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewVendorReturnSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const purchases = useApiQuery<Purchase[]>(open ? "/api/purchases" : null);
  const [vendorName, setVendorName] = useState("Harbor Components");
  const [purchaseId, setPurchaseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const created = await apiMutate<VendorReturn>("/api/vendor-returns", {
        body: JSON.stringify({
          warehouseId,
          vendorName,
          purchaseId: purchaseId || null,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      toast.success(`Vendor return ${created.number} created.`);
      onOpenChange(false);
      navigate(`/inbound/vendor-returns/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create vendor return");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New vendor return"
      description="Stock going back to a vendor. Pick the bay it leaves from on the next page."
      submitLabel="Create vendor return"
      onSubmit={create}
      busy={busy}
      error={error}
    >
      <Field label="Vendor">
        <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required placeholder="Harbor Components" autoFocus />
      </Field>
      <Field label="Original purchase">
        <Select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
          <option value="">None</option>
          {inWarehouse(purchases.data ?? [], warehouseId).map((purchase) => (
            <option key={purchase.id} value={purchase.id}>
              {purchase.number} · {purchase.vendorName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Wrong lot, damaged carton…" />
      </Field>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Lines</p>
        <LineFields items={items.data ?? []} lines={lines} setLines={setLines} />
      </div>
    </FormSheet>
  );
}

function VendorReturnDetail({ id }: { id: string }) {
  const [rtv, setRtv] = useState<VendorReturn | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const { error, setError, run } = useWrite();

  async function load() {
    const [next, nextLocations] = await Promise.all([
      api<VendorReturn>(`/api/vendor-returns/${id}`),
      api<Location[]>("/api/locations"),
    ]);
    setRtv(next);
    setLocations(nextLocations);
    const from = nextLocations.find((row) => row.code === "A-01-01") ?? nextLocations.find((row) => row.type === "storage") ?? nextLocations[0];
    if (from) setLocationId(next.locationId || from.id);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    const next = await run("Start", () => api<VendorReturn>(`/api/vendor-returns/${id}/start`, { method: "POST" }), "Return started.");
    if (next) setRtv(next);
  }

  async function postReturn() {
    if (!rtv) return;
    const lines = (rtv.lines ?? [])
      .map((line) => ({
        itemId: line.itemId,
        qty: Number(qtys[line.itemId] || 0),
        lotCode: lots[line.itemId] || undefined,
        serials: serials[line.itemId] || undefined,
        weightGrams: parseWeightGrams(weights[line.itemId]),
      }))
      .filter((line) => line.qty > 0);
    const total = lines.reduce((sum, line) => sum + line.qty, 0);
    const bay = locations.find((row) => row.id === locationId)?.code;
    const next = await run(
      "Return to vendor",
      () =>
        api<VendorReturn>(`/api/vendor-returns/${id}/return`, {
          method: "POST",
          body: JSON.stringify({ locationId, lines }),
        }),
      `Returned ${unitCount(total)} to ${rtv.vendorName}${bay ? ` from ${bay}` : ""}.`,
    );
    if (next) {
      setRtv(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    }
  }

  if (!rtv) return error ? <ErrorBanner error={error} /> : <DetailSkeleton />;

  const lines = rtv.lines ?? [];
  const remaining = hasUnreturned(
    lines.map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qtyExpected,
      qtyReturned: line.qtyReturned,
    })),
  );
  // Open returns take quantities too: Return to vendor works in one click, Start is optional (in the menu).
  const capturing = canPostVendorReturn(rtv.status) && remaining;
  const thisReturn = Object.values(qtys).some((value) => Number(value) > 0);
  const tracksAnything = lines.some((line) => line.trackLot || line.trackSerial || line.catchWeight);
  const units = rtvUnits(rtv);
  const shipFrom = locations.find((row) => row.id === (rtv.locationId || locationId));

  const primary: DocumentAction | null = capturing
    ? { label: "Return to vendor", icon: ArrowUpFromLine, onSelect: postReturn, disabled: !thisReturn }
    : null;

  const menu: DocumentAction[] = [
    ...(rtv.status === "open" ? [{ label: "Start", icon: Play, onSelect: start }] : []),
    ...(capturing ? [{ label: "Open on floor", icon: ScanLine, to: `/floor/rtv?id=${rtv.id}` }] : []),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Inbound"
        list={{ label: "Vendor returns", to: "/inbound/vendor-returns" }}
        title={rtv.number}
        description={`${rtv.vendorName}${rtv.notes ? ` · ${rtv.notes}` : ""}`}
        status={rtv.status}
        steps={VENDOR_RETURN_STEPS}
        refId={rtv.id}
        stampRules={STEP_RULES.vendorReturn}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <RailCard>
              <ProgressRow label="Returned" done={units.returned} total={units.expected} />
              <DocumentFact label="Vendor">{rtv.vendorName}</DocumentFact>
              {rtv.purchaseId ? (
                <DocumentFact label="Purchase">
                  <Link className="font-mono underline" to={`/inbound/purchases/${rtv.purchaseId}`}>
                    {rtv.purchaseNumber || "PO"}
                  </Link>
                </DocumentFact>
              ) : null}
              {!capturing && shipFrom ? (
                <DocumentFact label="Ship from">
                  <span className="font-mono">{shipFrom.code}</span>
                </DocumentFact>
              ) : null}
              <DocumentFact label="Created">
                <RelativeTime at={rtv.createdAt} />
              </DocumentFact>
            </RailCard>
            <DocumentActivity
              refId={rtv.id}
              refreshKey={`${rtv.status}:${lines.map((line) => line.qtyReturned).join(",")}`}
            />
          </DocumentRail>
        }
      >
        {capturing ? (
          <LinesBar hint="The bay the stock leaves from. Over-return is blocked.">
            <Field label="Ship from">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </Select>
            </Field>
          </LinesBar>
        ) : null}
        <Table
          columns={[
            "Item",
            "Expected",
            "Returned",
            ...(capturing ? ["This return"] : []),
            ...(capturing && tracksAnything ? ["Lot / serial"] : []),
          ]}
        >
          {lines.map((line) => (
            <tr key={line.id}>
              <td>
                <SkuCell sku={line.sku} name={line.itemName} to={`/stock/items/${line.itemId}`} />
              </td>
              <td className="font-mono tabular-nums">{line.qtyExpected}</td>
              <td>
                <ProgressCell done={line.qtyReturned} total={line.qtyExpected} />
              </td>
              {capturing ? (
                <td>
                  {line.remaining > 0 ? (
                    <Input
                      type="number"
                      min={0}
                      max={line.remaining}
                      className="w-20"
                      aria-label={`Return qty for ${line.sku}`}
                      value={qtys[line.itemId] ?? "0"}
                      onChange={(e) => setQtys((current) => ({ ...current, [line.itemId]: e.target.value }))}
                    />
                  ) : (
                    <Muted>Done</Muted>
                  )}
                </td>
              ) : null}
              {capturing && tracksAnything ? (
                <td className="space-y-1">
                  {line.remaining > 0 ? (
                    <>
                      {line.trackLot ? (
                        <Input
                          placeholder="Lot"
                          aria-label={`Lot for ${line.sku}`}
                          value={lots[line.itemId] ?? ""}
                          onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                        />
                      ) : null}
                      {line.trackSerial ? (
                        <Input
                          placeholder="Serials"
                          aria-label={`Serials for ${line.sku}`}
                          value={serials[line.itemId] ?? ""}
                          onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                        />
                      ) : null}
                      <CatchWeightInput
                        show={line.catchWeight}
                        value={weights[line.itemId] ?? ""}
                        onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                      />
                    </>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      </DocumentFrame>
    </div>
  );
}
