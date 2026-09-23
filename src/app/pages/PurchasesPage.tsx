import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDownToLine, Mail, PackageOpen, Plus, ScanLine, Send, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { api, type Item, type Location, type Purchase } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, StatusBadge, Table, ToneBadge, summarizeLines } from "../components/ui";
import { BayCombobox } from "../components/BayCombobox";
import {
  DetailSkeleton,
  DocumentActivity,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, ProgressCell, ProgressRow, RelativeTime, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { apiMutate, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STEP_RULES } from "@/domain/step-stamps";
import { PURCHASE_STEPS, canReceivePurchase, canStartPurchase, isOpenPurchase } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields, LinesBar, RailCard, unitCount } from "./ReceiptsPage";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../components/expiry-field";

type Line = { itemId: string; qty: string };

export function PurchasesPage() {
  const { id } = useParams();
  if (id) return <PurchaseDetail id={id} />;
  return <PurchaseList />;
}

function purchaseUnits(purchase: Purchase) {
  const lines = purchase.lines ?? [];
  return {
    ordered: lines.reduce((sum, line) => sum + line.qtyOrdered, 0),
    received: lines.reduce((sum, line) => sum + (line.qtyReceived ?? 0), 0),
  };
}

function purchaseChips(purchase: Purchase) {
  return (purchase.lines ?? []).map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qtyOrdered }));
}

const PURCHASE_TABS: TabDef<Purchase>[] = [
  { id: "open", label: "Open", match: (purchase) => isOpenPurchase(purchase.status) },
  { id: "draft", label: "Draft", match: (purchase) => purchase.status === "draft" },
  { id: "ordered", label: "Ordered", match: (purchase) => purchase.status === "ordered" },
  { id: "receiving", label: "Receiving", match: (purchase) => purchase.status === "receiving" },
  { id: "received", label: "Received", match: (purchase) => purchase.status === "received" },
  { id: "all", label: "All", match: () => true },
];

const PURCHASE_FACETS: FacetDef<Purchase>[] = [{ id: "vendor", label: "Vendor", value: (purchase) => purchase.vendorName }];

const PURCHASE_COLUMNS: DataColumn<Purchase>[] = [
  {
    id: "number",
    header: "Purchase",
    sortValue: (purchase) => purchase.number,
    cell: (purchase) => <DocLink to={`/inbound/purchases/${purchase.id}`}>{purchase.number}</DocLink>,
  },
  {
    id: "vendor",
    header: "Vendor",
    sortValue: (purchase) => purchase.vendorName,
    cell: (purchase) => (
      <span className="flex flex-col">
        <span className="font-medium">{purchase.vendorName}</span>
        {purchase.notes ? <span className="line-clamp-1 text-xs text-muted-foreground">{purchase.notes}</span> : null}
      </span>
    ),
  },
  {
    id: "lines",
    header: "Lines",
    csv: (purchase) => summarizeLines(purchaseChips(purchase)),
    cell: (purchase) => <LineChips lines={purchaseChips(purchase)} />,
  },
  {
    id: "received",
    header: "Received",
    sortValue: (purchase) => {
      const units = purchaseUnits(purchase);
      return units.ordered ? units.received / units.ordered : 0;
    },
    csv: (purchase) => {
      const units = purchaseUnits(purchase);
      return `${units.received}/${units.ordered}`;
    },
    cell: (purchase) => {
      const units = purchaseUnits(purchase);
      return <ProgressCell done={units.received} total={units.ordered} />;
    },
  },
  {
    id: "ordered",
    header: "Ordered",
    sortValue: (purchase) => purchase.orderedAt ?? null,
    csv: (purchase) => (purchase.orderedAt ? new Date(purchase.orderedAt).toISOString() : ""),
    cell: (purchase) => <RelativeTime at={purchase.orderedAt} />,
  },
  {
    id: "created",
    header: "Created",
    sortValue: (purchase) => purchase.createdAt,
    csv: (purchase) => new Date(purchase.createdAt).toISOString(),
    cell: (purchase) => <RelativeTime at={purchase.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (purchase) => PURCHASE_STEPS.indexOf(purchase.status as (typeof PURCHASE_STEPS)[number]),
    csv: (purchase) => purchase.status,
    cell: (purchase) => <StatusBadge status={purchase.status} />,
  },
];

function PurchaseList() {
  const { warehouseId } = useWarehouse();
  const purchases = useApiQuery<Purchase[]>("/api/purchases");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => inWarehouse(purchases.data ?? [], warehouseId), [purchases.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Inbound"
        title="Purchases"
        description="What you ordered from a vendor. Send the draft to mint an expected ASN, then receive on the dock."
      />
      <DataTable
        id="purchases"
        data={rows}
        loading={purchases.isLoading}
        error={purchases.error?.message}
        columns={PURCHASE_COLUMNS}
        getRowId={(purchase) => purchase.id}
        rowHref={(purchase) => `/inbound/purchases/${purchase.id}`}
        tabs={PURCHASE_TABS}
        defaultTab="open"
        facets={PURCHASE_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search purchase, vendor, SKU",
          text: (purchase) =>
            [purchase.number, purchase.vendorName, purchase.notes, ...(purchase.lines ?? []).map((line) => line.sku)]
              .filter(Boolean)
              .join(" "),
        }}
        exportName="purchases"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New purchase
          </Button>
        }
        empty={
          <EmptyState
            icon={ShoppingCart}
            title="No purchases yet."
            body="A purchase is what you order from a vendor. Send it to expect an ASN, then receive it on the dock."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New purchase
              </Button>
            }
          />
        }
      />
      <NewPurchaseSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewPurchaseSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      const created = await apiMutate<Purchase>("/api/purchases", {
        body: JSON.stringify({
          warehouseId,
          vendorName,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      toast.success(`Purchase ${created.number} created.`);
      onOpenChange(false);
      navigate(`/inbound/purchases/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create purchase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New purchase"
      description="Starts as a draft. Send it to the vendor from the purchase page."
      submitLabel="Create purchase"
      onSubmit={create}
      busy={busy}
      error={error}
    >
      <Field label="Vendor">
        <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required placeholder="Harbor Components" autoFocus />
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Restock, lead time, packing slip" />
      </Field>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Lines</p>
        <LineFields items={items.data ?? []} lines={lines} setLines={setLines} />
      </div>
    </FormSheet>
  );
}

function PurchaseDetail({ id }: { id: string }) {
  const { warehouseId } = useWarehouse();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [vendorEmail, setVendorEmail] = useState("");
  const [receiveUnsent, setReceiveUnsent] = useState(false);
  const [view, setView] = useState("lines");
  const { error, setError, run } = useWrite();

  async function load() {
    const [next, nextLocations] = await Promise.all([
      api<Purchase>(`/api/purchases/${id}`),
      api<Location[]>("/api/locations"),
    ]);
    setPurchase(next);
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(next.locationId || dock.id);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    const next = await run(
      "Send",
      () =>
        api<Purchase>(`/api/purchases/${id}/start`, {
          method: "POST",
          body: JSON.stringify({ to: vendorEmail.trim() || undefined }),
        }),
      (result) => {
        const sent = result.send?.mode === "sent";
        const asn = result.mintedAsnId ? (result.asns ?? []).find((row) => row.id === result.mintedAsnId)?.number : null;
        const head = sent ? `Sent to ${result.send?.toAddress ?? result.vendorName} and marked ordered.` : "Recorded and marked ordered.";
        return asn ? `${head} ${asn} is expected.` : head;
      },
    );
    if (next) {
      setPurchase(next);
      setReceiveUnsent(false);
    }
  }

  async function receive() {
    if (!purchase) return;
    const lines = (purchase.lines ?? [])
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
    const bay = locations.find((row) => row.id === locationId)?.code;
    const next = await run(
      "Receive",
      () =>
        api<Purchase>(`/api/purchases/${id}/receive`, {
          method: "POST",
          body: JSON.stringify({ locationId, lines }),
        }),
      `Received ${unitCount(total)}${bay ? ` into ${bay}` : ""}.`,
    );
    if (next) {
      setPurchase(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    }
  }

  if (!purchase) return error ? <ErrorBanner error={error} /> : <DetailSkeleton />;

  const lines = purchase.lines ?? [];
  const asns = purchase.asns ?? [];
  const remaining = hasRemaining(
    lines.map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qtyOrdered,
      qtyReceived: line.qtyReceived,
    })),
  );
  const receivable = canReceivePurchase(purchase.status) && remaining;
  const draft = canStartPurchase(purchase.status);
  // A draft leads with Send; receiving before it is sent stays one menu pick away.
  const capturing = receivable && (!draft || receiveUnsent);
  const thisReceive = Object.values(qtys).some((value) => Number(value) > 0);
  const tracksAnything = lines.some((line) => line.trackLot || line.trackSerial || line.catchWeight || line.trackExpiry);
  const units = purchaseUnits(purchase);
  const dock = locations.find((row) => row.id === (purchase.locationId || locationId));

  const sendAction: DocumentAction = { label: "Send & mark ordered", icon: Send, onSelect: start };
  const receiveAction: DocumentAction = { label: "Receive", icon: ArrowDownToLine, onSelect: receive, disabled: !thisReceive };

  let primary: DocumentAction | null = null;
  if (capturing) primary = receiveAction;
  else if (draft) primary = sendAction;

  const menu: DocumentAction[] = [
    ...(draft && capturing ? [sendAction] : []),
    ...(draft && receivable && !capturing
      ? [{ label: "Receive without sending", icon: PackageOpen, onSelect: () => { setReceiveUnsent(true); setView("lines"); } }]
      : []),
    ...(receivable ? [{ label: "Open on floor", icon: ScanLine, to: `/floor/receive?purchase=${purchase.id}` }] : []),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Inbound"
        list={{ label: "Purchases", to: "/inbound/purchases" }}
        title={purchase.number}
        description={`${purchase.vendorName}${purchase.notes ? ` · ${purchase.notes}` : ""}`}
        status={purchase.status}
        steps={PURCHASE_STEPS}
        refId={purchase.id}
        stampRules={STEP_RULES.purchase}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            {draft ? (
              <RailCard title="Send to vendor">
                <Field label="Vendor email">
                  <Input
                    type="email"
                    value={vendorEmail}
                    onChange={(e) => setVendorEmail(e.target.value)}
                    placeholder="orders@vendor.com"
                  />
                </Field>
                <p className="text-xs text-muted-foreground">Sending marks the purchase ordered and creates the expected ASN.</p>
              </RailCard>
            ) : null}
            <RailCard>
              <ProgressRow label="Received" done={units.received} total={units.ordered} />
              <DocumentFact label="Vendor">{purchase.vendorName}</DocumentFact>
              {!capturing && dock && !draft ? (
                <DocumentFact label="Dock">
                  <span className="font-mono">{dock.code}</span>
                </DocumentFact>
              ) : null}
              {purchase.orderedAt ? (
                <DocumentFact label="Ordered">
                  <RelativeTime at={purchase.orderedAt} />
                </DocumentFact>
              ) : null}
              <DocumentFact label="Created">
                <RelativeTime at={purchase.createdAt} />
              </DocumentFact>
              {asns.length > 0 ? (
                <DocumentFact label={asns.length === 1 ? "Expected ASN" : "Expected ASNs"}>
                  <span className="flex flex-col items-end gap-1">
                    {asns.map((asn) => (
                      <span key={asn.id} className="inline-flex items-center gap-2">
                        <Link className="font-mono underline" to={`/inbound/asns/${asn.id}`}>
                          {asn.number}
                        </Link>
                        <StatusBadge status={asn.status} />
                      </span>
                    ))}
                  </span>
                </DocumentFact>
              ) : null}
            </RailCard>
          </DocumentRail>
        }
      >
        {capturing ? (
          <LinesBar hint="Defaults to the receiving dock. Type a bay code to find another, or add one.">
            <Field label="Receive into">
              <BayCombobox
                locations={locations}
                warehouseId={purchase.warehouseId || warehouseId}
                value={locationId}
                onChange={setLocationId}
                onCreated={(location) => setLocations((current) => [...current, location])}
              />
            </Field>
          </LinesBar>
        ) : null}
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="lines">Lines</TabsTrigger>
            {purchase.send ? <TabsTrigger value="message">Message</TabsTrigger> : null}
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="lines">
            <Table
              columns={[
                "Item",
                "Ordered",
                "Received",
                ...(capturing ? ["This receive"] : []),
                ...(capturing && tracksAnything ? ["Lot / serial"] : []),
              ]}
            >
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <SkuCell sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} to={`/stock/items/${line.itemId}`} />
                  </td>
                  <td className="font-mono tabular-nums">{line.qtyOrdered}</td>
                  <td>
                    <ProgressCell done={line.qtyReceived} total={line.qtyOrdered} />
                  </td>
                  {capturing ? (
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

          {purchase.send ? (
            <TabsContent value="message">
              <Card className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2">
                    <Mail className="size-4 text-muted-foreground" />
                    <span>To {purchase.send.toAddress ?? purchase.vendorName}</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    {purchase.send.mode === "sent" ? (
                      <ToneBadge tone="success">Sent</ToneBadge>
                    ) : (
                      <ToneBadge tone="neutral">Recorded</ToneBadge>
                    )}
                    <RelativeTime at={purchase.send.createdAt} />
                  </span>
                </div>
                {purchase.send.subject ? <p className="font-medium">{purchase.send.subject}</p> : null}
                <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                  {purchase.send.body}
                </p>
              </Card>
            </TabsContent>
          ) : null}

          <TabsContent value="activity">
            <DocumentActivity
              refId={purchase.id}
              refreshKey={`${purchase.status}:${lines.map((line) => line.qtyReceived).join(",")}`}
            />
          </TabsContent>
        </Tabs>
      </DocumentFrame>
    </div>
  );
}
