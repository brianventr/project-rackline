import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDownToLine, ArrowRightLeft, CalendarCheck, ClipboardPaste, Package, Plus, ScanLine, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Asn, type AsnPackage, type Item, type Location, type Purchase } from "../api";
import { Button, EmptyState, ErrorBanner, Field, Input, PageHeader, StatusBadge, Table, ToneBadge, summarizeLines } from "../components/ui";
import { BayCombobox } from "../components/BayCombobox";
import {
  ActionButton,
  ActionMenu,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { STEP_RULES } from "@/domain/step-stamps";
import { ASN_STEPS, canExpectAsn, canReceiveAsn, isOpenAsn } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields, LinesBar, RailCard, countOf, runEach, unitCount } from "./ReceiptsPage";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../components/expiry-field";

type Line = { itemId: string; qty: string };

export function AsnsPage() {
  const { id } = useParams();
  if (id) return <AsnDetail id={id} />;
  return <AsnList />;
}

function asnUnits(asn: Asn) {
  const lines = asn.lines ?? [];
  return {
    expected: lines.reduce((sum, line) => sum + line.qtyExpected, 0),
    received: lines.reduce((sum, line) => sum + (line.qtyReceived ?? 0), 0),
  };
}

function asnChips(asn: Asn) {
  return (asn.lines ?? []).map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qtyExpected }));
}

const ASN_TABS: TabDef<Asn>[] = [
  { id: "open", label: "Open", match: (asn) => isOpenAsn(asn.status) },
  { id: "draft", label: "Draft", match: (asn) => asn.status === "draft" },
  { id: "expected", label: "Expected", match: (asn) => asn.status === "expected" },
  { id: "receiving", label: "Receiving", match: (asn) => asn.status === "receiving" },
  { id: "received", label: "Received", match: (asn) => asn.status === "received" },
  { id: "all", label: "All", match: () => true },
];

const ASN_FACETS: FacetDef<Asn>[] = [{ id: "vendor", label: "Vendor", value: (asn) => asn.vendorName }];

const ASN_COLUMNS: DataColumn<Asn>[] = [
  {
    id: "number",
    header: "ASN",
    sortValue: (asn) => asn.number,
    cell: (asn) => <DocLink to={`/inbound/asns/${asn.id}`}>{asn.number}</DocLink>,
  },
  {
    id: "vendor",
    header: "Vendor",
    sortValue: (asn) => asn.vendorName,
    cell: (asn) => (
      <span className="flex flex-col">
        <span className="font-medium">{asn.vendorName}</span>
        {asn.notes ? <span className="line-clamp-1 text-xs text-muted-foreground">{asn.notes}</span> : null}
      </span>
    ),
  },
  {
    id: "lines",
    header: "Lines",
    csv: (asn) => summarizeLines(asnChips(asn)),
    cell: (asn) => <LineChips lines={asnChips(asn)} />,
  },
  {
    id: "received",
    header: "Received",
    sortValue: (asn) => {
      const units = asnUnits(asn);
      return units.expected ? units.received / units.expected : 0;
    },
    csv: (asn) => {
      const units = asnUnits(asn);
      return `${units.received}/${units.expected}`;
    },
    cell: (asn) => {
      const units = asnUnits(asn);
      return <ProgressCell done={units.received} total={units.expected} />;
    },
  },
  {
    id: "cartons",
    header: "Cartons",
    align: "right",
    sortValue: (asn) => (asn.packages ?? []).length,
    cell: (asn) => {
      const packages = asn.packages ?? [];
      if (!packages.length) return <Muted>—</Muted>;
      const received = packages.filter((pkg) => pkg.receivedAt).length;
      return (
        <span className="font-mono tabular-nums" title={`${received} of ${packages.length} received`}>
          {received}/{packages.length}
        </span>
      );
    },
  },
  {
    id: "eta",
    header: "ETA",
    defaultHidden: true,
    sortValue: (asn) => asn.eta ?? null,
    csv: (asn) => (asn.eta ? new Date(asn.eta).toISOString() : ""),
    cell: (asn) => <RelativeTime at={asn.eta} />,
  },
  {
    id: "created",
    header: "Created",
    sortValue: (asn) => asn.createdAt,
    csv: (asn) => new Date(asn.createdAt).toISOString(),
    cell: (asn) => <RelativeTime at={asn.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (asn) => ASN_STEPS.indexOf(asn.status as (typeof ASN_STEPS)[number]),
    csv: (asn) => asn.status,
    cell: (asn) => <StatusBadge status={asn.status} />,
  },
];

const ASN_BULK: BulkAction<Asn>[] = [
  {
    label: "Mark expected",
    icon: CalendarCheck,
    when: (selected) => selected.every((asn) => canExpectAsn(asn.status)),
    run: (selected) =>
      runEach(selected, (asn) => api(`/api/asns/${asn.id}/expect`, { method: "POST" }), {
        done: (count) => `Marked ${countOf(count, "ASN")} expected.`,
        failed: "could not be marked expected",
      }),
  },
];

function AsnList() {
  const { warehouseId } = useWarehouse();
  const asns = useApiQuery<Asn[]>("/api/asns");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => inWarehouse(asns.data ?? [], warehouseId), [asns.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Inbound"
        title="ASNs"
        description="Advance ship notices from vendors. Expect them, then receive onto the dock."
      />
      <DataTable
        id="asns"
        data={rows}
        loading={asns.isLoading}
        error={asns.error?.message}
        columns={ASN_COLUMNS}
        getRowId={(asn) => asn.id}
        rowHref={(asn) => `/inbound/asns/${asn.id}`}
        tabs={ASN_TABS}
        defaultTab="open"
        facets={ASN_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search ASN, vendor, SKU, carton",
          text: (asn) =>
            [
              asn.number,
              asn.vendorName,
              asn.notes,
              ...(asn.lines ?? []).map((line) => line.sku),
              ...(asn.packages ?? []).flatMap((pkg) => [pkg.number, pkg.sscc]),
            ]
              .filter(Boolean)
              .join(" "),
        }}
        bulkActions={ASN_BULK}
        exportName="asns"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New ASN
          </Button>
        }
        empty={
          <EmptyState
            icon={Package}
            title="No ASNs yet."
            body="An ASN is the vendor's notice of what is on the truck. Sending a purchase creates one, or add it by hand."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New ASN
              </Button>
            }
          />
        }
      />
      <NewAsnSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewAsnSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const [vendorName, setVendorName] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const created = await apiMutate<Asn>("/api/asns", {
        body: JSON.stringify({
          warehouseId,
          vendorName,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      toast.success(`ASN ${created.number} created.`);
      onOpenChange(false);
      navigate(`/inbound/asns/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create ASN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New ASN"
      description="What the vendor says is on the truck. Mark it expected, then receive on the dock."
      submitLabel="Create ASN"
      onSubmit={create}
      busy={busy}
      error={error}
    >
      <Field label="Vendor">
        <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required placeholder="Harbor Components" autoFocus />
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Trailer, PO ref, packing slip" />
      </Field>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Lines</p>
        <LineFields items={items.data ?? []} lines={lines} setLines={setLines} />
      </div>
    </FormSheet>
  );
}

function cartonState(pkg: AsnPackage): "expected" | "on_dock" | "put_away" {
  if (pkg.putawayAt) return "put_away";
  if (pkg.receivedAt) return "on_dock";
  return "expected";
}

function AsnDetail({ id }: { id: string }) {
  const { warehouseId } = useWarehouse();
  const [asn, setAsn] = useState<Asn | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [view, setView] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const { error, setError, run } = useWrite();
  const purchase = useApiQuery<Purchase>(asn?.purchaseId ? `/api/purchases/${asn.purchaseId}` : null);

  function apply(next: Asn) {
    setAsn(next);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  async function load() {
    const [next, nextLocations] = await Promise.all([api<Asn>(`/api/asns/${id}`), api<Location[]>("/api/locations")]);
    setAsn(next);
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(next.locationId || dock.id);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  const bayCode = () => locations.find((row) => row.id === locationId)?.code;

  async function expect() {
    const next = await run("Mark expected", () => api<Asn>(`/api/asns/${id}/expect`, { method: "POST" }), "Marked expected.");
    if (next) setAsn(next);
  }

  async function receive() {
    if (!asn) return;
    const lines = (asn.lines ?? [])
      .map((line) => ({
        itemId: line.itemId,
        qty: Number(qtys[line.itemId] || 0),
        lotCode: lots[line.itemId] || undefined,
        serials: serials[line.itemId] || undefined,
        weightGrams: parseWeightGrams(weights[line.itemId]),
        expiresOn: parseExpiryInput(expiries[line.itemId]),
      }))
      .filter((line) => line.qty > 0);
    const total = lines.reduce((sum, line) => sum + line.qty, 0);
    const bay = bayCode();
    const next = await run(
      "Receive",
      () =>
        api<Asn>(`/api/asns/${id}/receive`, {
          method: "POST",
          body: JSON.stringify({ locationId, lines }),
        }),
      `Received ${unitCount(total)}${bay ? ` into ${bay}` : ""}.`,
    );
    if (next) apply(next);
  }

  async function receiveCarton(pkg: AsnPackage) {
    const bay = bayCode();
    const next = await run(
      "Receive carton",
      () =>
        api<Asn>(`/api/asns/${id}/packages/${pkg.id}/receive`, {
          method: "POST",
          body: JSON.stringify({ locationId, lots, serials }),
        }),
      `Received ${pkg.number}${bay ? ` into ${bay}` : ""}.`,
    );
    if (next) apply(next);
  }

  async function unreceiveCarton(pkg: AsnPackage) {
    const next = await run(
      "Unreceive carton",
      () => api<Asn>(`/api/asns/${id}/packages/${pkg.id}/unreceive`, { method: "POST" }),
      `Unreceived ${pkg.number}. Its units are off the dock.`,
    );
    if (next) apply(next);
  }

  if (!asn) return error ? <ErrorBanner error={error} /> : <DetailSkeleton />;

  const lines = asn.lines ?? [];
  const packages = asn.packages ?? [];
  const hasCartons = packages.length > 0;
  const remaining = hasRemaining(
    lines.map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qtyExpected,
      qtyReceived: line.qtyReceived,
    })),
  );
  const open = canReceiveAsn(asn.status);
  // Drafts take quantities and cartons too: Receive works in one click, Mark expected is optional (in the menu).
  const capturing = open;
  const looseCapture = capturing && remaining && !hasCartons;
  const cartonsToReceive = capturing && packages.some((pkg) => !pkg.receivedAt);
  const onDock = packages.some((pkg) => pkg.receivedAt && !pkg.putawayAt);
  const tracksAnything = lines.some((line) => line.trackLot || line.trackSerial || line.catchWeight || line.trackExpiry);
  const showTracking = (looseCapture || cartonsToReceive) && tracksAnything;
  const thisReceive = Object.values(qtys).some((value) => Number(value) > 0);
  const units = asnUnits(asn);
  const dock = locations.find((row) => row.id === (asn.locationId || locationId));
  const cartonsReceived = packages.filter((pkg) => pkg.receivedAt).length;

  const primary: DocumentAction | null = looseCapture
    ? { label: "Receive", icon: ArrowDownToLine, onSelect: receive, disabled: !thisReceive }
    : null;

  const menu: DocumentAction[] = [
    ...(canExpectAsn(asn.status) ? [{ label: "Mark expected", icon: CalendarCheck, onSelect: expect }] : []),
    ...((open && remaining) || onDock ? [{ label: "Open on floor", icon: ScanLine, to: `/floor/asn?id=${asn.id}` }] : []),
    ...(open ? [{ label: "Paste vendor cartons…", icon: ClipboardPaste, onSelect: () => setPasting(true) }] : []),
  ];

  const defaultView = hasCartons && (cartonsToReceive || onDock) ? "cartons" : "lines";
  const activeView = view ?? defaultView;

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Inbound"
        list={{ label: "ASNs", to: "/inbound/asns" }}
        title={asn.number}
        description={`${asn.vendorName}${asn.notes ? ` · ${asn.notes}` : ""}`}
        status={asn.status}
        steps={ASN_STEPS}
        refId={asn.id}
        stampRules={STEP_RULES.asn}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <RailCard>
              <ProgressRow label="Received" done={units.received} total={units.expected} />
              {hasCartons ? <ProgressRow label="Cartons received" done={cartonsReceived} total={packages.length} /> : null}
            </RailCard>
            <RailCard title="Details">
              <DocumentFact label="Vendor">{asn.vendorName}</DocumentFact>
              {asn.purchaseId ? (
                <DocumentFact label="Purchase">
                  <Link className="font-mono underline" to={`/inbound/purchases/${asn.purchaseId}`}>
                    {purchase.data?.number ?? "Open"}
                  </Link>
                </DocumentFact>
              ) : null}
              {!capturing && dock ? (
                <DocumentFact label="Dock">
                  <span className="font-mono">{dock.code}</span>
                </DocumentFact>
              ) : null}
              {asn.eta ? (
                <DocumentFact label="ETA">
                  <RelativeTime at={asn.eta} />
                </DocumentFact>
              ) : null}
              {asn.expectedAt ? (
                <DocumentFact label="Expected">
                  <RelativeTime at={asn.expectedAt} />
                </DocumentFact>
              ) : null}
              {asn.receivedAt ? (
                <DocumentFact label="Received">
                  <RelativeTime at={asn.receivedAt} />
                </DocumentFact>
              ) : null}
              <DocumentFact label="Created">
                <RelativeTime at={asn.createdAt} />
              </DocumentFact>
            </RailCard>
          </DocumentRail>
        }
      >
        {looseCapture || cartonsToReceive ? (
          <LinesBar hint="Loose lines and cartons both land here. Type a bay code to find another, or add one.">
            <Field label="Receive into">
              <BayCombobox
                locations={locations}
                warehouseId={asn.warehouseId || warehouseId}
                value={locationId}
                onChange={setLocationId}
                onCreated={(location) => setLocations((current) => [...current, location])}
              />
            </Field>
          </LinesBar>
        ) : null}
        <Tabs value={activeView} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="lines">Lines</TabsTrigger>
            <TabsTrigger value="cartons">Cartons{hasCartons ? ` (${packages.length})` : ""}</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="space-y-3">
            {hasCartons && cartonsToReceive && tracksAnything ? (
              <p className="text-sm text-muted-foreground">
                Cartons are received one box at a time. Lots and serials entered here go with the next carton you receive.
              </p>
            ) : null}
            <Table
              columns={[
                "Item",
                "Expected",
                "Received",
                ...(looseCapture ? ["This receive"] : []),
                ...(showTracking ? ["Lot / serial"] : []),
              ]}
            >
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <SkuCell sku={line.sku} name={line.itemName} to={`/stock/items/${line.itemId}`} />
                  </td>
                  <td className="font-mono tabular-nums">{line.qtyExpected}</td>
                  <td>
                    <ProgressCell done={line.qtyReceived} total={line.qtyExpected} />
                  </td>
                  {looseCapture ? (
                    <td>
                      {line.remaining > 0 ? (
                        <Input
                          type="number"
                          min={0}
                          max={line.remaining}
                          className="w-20"
                          aria-label={`Receive qty for ${line.sku}`}
                          value={qtys[line.itemId] ?? "0"}
                          onChange={(e) => setQtys((current) => ({ ...current, [line.itemId]: e.target.value }))}
                        />
                      ) : (
                        <Muted>Done</Muted>
                      )}
                    </td>
                  ) : null}
                  {showTracking ? (
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
                          <ExpiryInput
                            show={line.trackExpiry}
                            value={expiries[line.itemId] ?? ""}
                            onChange={(value) => setExpiries((current) => ({ ...current, [line.itemId]: value }))}
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
          </TabsContent>

          <TabsContent value="cartons" className="space-y-3">
            {!hasCartons ? (
              <EmptyState
                icon={Package}
                title="No vendor cartons yet."
                body="Paste the vendor's carton list to receive one box at a time. Loose receive still works without it."
                action={
                  open ? (
                    <Button size="sm" variant="outline" onClick={() => setPasting(true)}>
                      <ClipboardPaste className="size-4" />
                      Paste vendor cartons
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <Table columns={["Carton", "Contents", "Status", ""]}>
                  {packages.map((pkg) => {
                    const state = cartonState(pkg);
                    const cartonMenu: DocumentAction[] =
                      state === "on_dock"
                        ? [
                            {
                              label: "Unreceive",
                              icon: Undo2,
                              tone: "danger",
                              onSelect: () => unreceiveCarton(pkg),
                              confirm: {
                                title: `Unreceive ${pkg.number}?`,
                                body: "Its units come back off the dock and this ASN's received qty drops by the same amount. Use it when a box was received by mistake.",
                                confirmLabel: "Unreceive carton",
                                cancelLabel: "Keep it",
                                tone: "danger",
                              },
                            },
                          ]
                        : [];
                    return (
                      <tr key={pkg.id}>
                        <td>
                          <span className="flex flex-col">
                            <span className="font-mono font-medium">{pkg.number}</span>
                            {pkg.sscc ? <span className="font-mono text-[11px] text-muted-foreground">{pkg.sscc}</span> : null}
                          </span>
                        </td>
                        <td>
                          <span className="flex flex-col gap-0.5">
                            <LineChips lines={pkg.lines} max={3} />
                            {(pkg.lines ?? []).some((line) => line.lotCode) ? (
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {(pkg.lines ?? [])
                                  .map((line) => line.lotCode)
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          {state === "put_away" ? (
                            <ToneBadge tone="success">Put away</ToneBadge>
                          ) : state === "on_dock" ? (
                            <ToneBadge tone="warning">On dock</ToneBadge>
                          ) : (
                            <ToneBadge tone="neutral">Expected</ToneBadge>
                          )}
                        </td>
                        <td className="text-right">
                          <span className="inline-flex items-center justify-end gap-2">
                            {state === "on_dock" ? (
                              <>
                                <ActionMenu actions={cartonMenu} label={`${pkg.number} actions`} />
                                <ActionButton
                                  variant="outline"
                                  action={{
                                    label: "Put away",
                                    icon: ArrowRightLeft,
                                    to: `/floor/putaway?carton=${encodeURIComponent(pkg.sscc || pkg.number)}`,
                                  }}
                                />
                              </>
                            ) : null}
                            {state === "expected" && capturing ? (
                              <ActionButton action={{ label: "Receive", icon: ArrowDownToLine, onSelect: () => receiveCarton(pkg) }} />
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
                {open ? (
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => setPasting(true)}>
                      <ClipboardPaste className="size-4" />
                      Paste more cartons
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="activity">
            <DocumentActivity refId={asn.id} refreshKey={`${asn.status}:${lines.map((line) => line.qtyReceived).join(",")}`} />
          </TabsContent>
        </Tabs>
      </DocumentFrame>
      <PasteCartonsSheet
        asnId={asn.id}
        open={pasting}
        onOpenChange={setPasting}
        onAdded={(next, added) => {
          setAsn(next);
          setView("cartons");
          toast.success(`Added ${countOf(added, "carton")}.`);
        }}
      />
    </div>
  );
}

function PasteCartonsSheet({
  asnId,
  open,
  onOpenChange,
  onAdded,
}: {
  asnId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (next: Asn, added: number) => void;
}) {
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (!paste.trim()) throw new Error("Paste the vendor's carton JSON first");
      const parsed = JSON.parse(paste) as unknown;
      const cartons = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "cartons" in parsed
          ? (parsed as { cartons: unknown }).cartons
          : null;
      if (!Array.isArray(cartons)) throw new Error("Paste a JSON array of cartons");
      const next = await apiMutate<Asn>(`/api/asns/${asnId}/packages`, {
        body: JSON.stringify({ cartons }),
      });
      setPaste("");
      onOpenChange(false);
      onAdded(next, cartons.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not paste cartons");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Paste vendor cartons"
      description="JSON boxes from the vendor, no X12. Lines may include lotCode, serials, weightGrams, and expiresOn. The floor then receives one carton at a time."
      submitLabel="Add cartons"
      onSubmit={submit}
      busy={busy}
      error={error}
      wide
    >
      <Field label="Cartons">
        <Textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={12}
          className="font-mono text-xs"
          placeholder='[{"sscc":"00012345678901234567","lines":[{"sku":"LED-BULB","qty":10,"lotCode":"LOT-2026-A"}]}]'
          autoFocus
        />
      </Field>
    </FormSheet>
  );
}
