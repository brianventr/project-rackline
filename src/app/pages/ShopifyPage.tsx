import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Copy, ExternalLink, FlaskConical, PackagePlus, RefreshCw, Store } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type Item,
  type Me,
  type ShopifyConnection,
  type ShopifyInventory,
  type ShopifyInventorySync,
  type ShopifyLocation,
  type ShopifyOutbound,
  type ShopifySellableRow,
} from "../api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  ToneBadge,
  onSubmit,
} from "../components/ui";
import { ActionButton } from "../components/document";
import { DataTable, type DataColumn, type FacetDef } from "../components/data-table/DataTable";
import { Muted, RelativeTime } from "../components/cells";
import { useConfirm } from "../components/confirm";
import { useWrite } from "../use-write";

function shopifyInstallError(code: string): string {
  switch (code) {
    case "missing_app":
      return "Shopify app credentials are not configured";
    case "hmac":
      return "Shopify rejected the install signature";
    case "token":
      return "Shopify did not return an access token";
    case "shop":
      return "That shop is already connected to another organization";
    default:
      return "Shopify install link expired or was rejected";
  }
}

const SELLABLE_COLUMNS: DataColumn<ShopifySellableRow>[] = [
  {
    id: "sku",
    header: "SKU",
    sortValue: (row) => row.sku,
    cell: (row) => (
      <span className="flex flex-col">
        <Link to={`/stock/items/${row.itemId}`} className="font-mono font-medium hover:text-primary hover:underline">
          {row.sku}
        </Link>
        {row.name ? <span className="text-xs text-muted-foreground">{row.name}</span> : null}
      </span>
    ),
  },
  {
    id: "onHand",
    header: "On hand",
    align: "right",
    sortValue: (row) => row.onHand,
    cell: (row) => <span className="font-mono">{row.onHand}</span>,
  },
  {
    id: "held",
    header: "Held",
    align: "right",
    sortValue: (row) => row.held,
    cell: (row) => <span className="font-mono">{row.held}</span>,
  },
  {
    id: "toPick",
    header: "To pick",
    align: "right",
    sortValue: (row) => row.remainingToPick,
    cell: (row) => <span className="font-mono">{row.remainingToPick}</span>,
  },
  {
    id: "sellable",
    header: "Sellable",
    align: "right",
    sortValue: (row) => row.sellable,
    cell: (row) => (
      <span className={row.sellable <= 0 ? "font-mono font-semibold text-tone-danger" : "font-mono font-semibold"}>
        {row.sellable}
      </span>
    ),
  },
  {
    id: "linked",
    header: "Shopify item",
    sortValue: (row) => Boolean(row.shopifyInventoryItemGid),
    csv: (row) => row.shopifyInventoryItemGid ?? "",
    cell: (row) =>
      row.shopifyInventoryItemGid ? (
        <ToneBadge tone="success" dot={false}>
          Linked
        </ToneBadge>
      ) : (
        <Muted>Not linked</Muted>
      ),
  },
];

const OUTBOUND_FACETS: FacetDef<ShopifyOutbound>[] = [
  { id: "kind", label: "Kind", value: (event) => event.kind },
  { id: "status", label: "Status", value: (event) => event.status },
];

const OUTBOUND_COLUMNS: DataColumn<ShopifyOutbound>[] = [
  {
    id: "when",
    header: "When",
    sortValue: (event) => event.createdAt,
    csv: (event) => new Date(event.createdAt).toISOString(),
    cell: (event) => <RelativeTime at={event.createdAt} />,
  },
  {
    id: "kind",
    header: "Kind",
    sortValue: (event) => event.kind,
    cell: (event) => <span className="font-mono text-xs">{event.kind}</span>,
  },
  {
    id: "order",
    header: "Order",
    sortValue: (event) => event.orderId,
    cell: (event) =>
      event.orderId ? (
        <Link className="text-xs underline" to={`/outbound/orders/${event.orderId}`}>
          Open order
        </Link>
      ) : (
        <Muted>—</Muted>
      ),
  },
  { id: "status", header: "Status", sortValue: (event) => event.status, cell: (event) => <StatusBadge status={event.status} /> },
  {
    id: "payload",
    header: "Payload",
    csv: (event) => JSON.stringify({ request: event.request, response: event.response }),
    cell: (event) => <PayloadDetails request={event.request} response={event.response} />,
  },
];

export function ShopifyPage({ me }: { me: Me }) {
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [outbound, setOutbound] = useState<ShopifyOutbound[]>([]);
  const [inventory, setInventory] = useState<ShopifyInventory | null>(null);
  const [locations, setLocations] = useState<ShopifyLocation[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [locationGid, setLocationGid] = useState("");
  const [mode, setMode] = useState("demo");
  const [customerName, setCustomerName] = useState("Jordan Hale");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("1");
  const [params] = useSearchParams();
  const confirm = useConfirm();
  const write = useWrite();
  const { error, setError } = write;
  const owner = me.role === "owner";

  async function load() {
    const [nextConnection, nextOutbound, nextItems, nextInventory] = await Promise.all([
      api<ShopifyConnection>("/api/shopify/connection"),
      api<ShopifyOutbound[]>("/api/shopify/outbound"),
      api<Item[]>("/api/items"),
      api<ShopifyInventory>("/api/shopify/inventory"),
    ]);
    setConnection(nextConnection);
    setOutbound(nextOutbound);
    setItems(nextItems);
    setInventory(nextInventory);
    setShopDomain(nextConnection.shopDomain ?? "");
    setMode(nextConnection.mode);
    if (nextConnection.connected) {
      const nextLocations = await api<ShopifyLocation[]>("/api/shopify/locations").catch(() => [] as ShopifyLocation[]);
      setLocations(nextLocations);
      setLocationGid(nextConnection.shopifyLocationGid ?? nextInventory.locationGid ?? nextLocations[0]?.id ?? "");
    } else {
      setLocations([]);
      setLocationGid(nextConnection.shopifyLocationGid ?? nextInventory.locationGid ?? "");
    }
    if (!sku) {
      const lamp = nextItems.find((item) => item.sku === "LAMP") ?? nextItems[0];
      if (lamp) setSku(lamp.sku);
    }
    setLoaded(true);
  }

  useEffect(() => {
    const installed = params.get("installed") === "1";
    const oauthError = params.get("error");
    load()
      .then(() => {
        if (installed) toast.success("Shopify app installed.");
        if (oauthError) setError(shopifyInstallError(oauthError));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function install() {
    setError(null);
    if (!shopDomain.trim()) {
      setError("Shop domain is required");
      return;
    }
    try {
      const result = await api<{ url: string }>(`/api/shopify/oauth/start?shop=${encodeURIComponent(shopDomain.trim())}`);
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Shopify install");
    }
  }

  async function save() {
    if (mode === "live" && connection?.mode !== "live") {
      const ok = await confirm({
        title: "Switch Shopify to live?",
        body: "Rackline will call the real shop: shipped orders post fulfillments and Push sellable overwrites storefront quantities.",
        confirmLabel: "Go live",
        cancelLabel: "Stay in demo",
      });
      if (!ok) return;
    }
    const next = await write.run(
      "Save connection",
      () =>
        api<ShopifyConnection>("/api/shopify/connection", {
          method: "PUT",
          body: JSON.stringify({
            shopDomain,
            accessToken: accessToken || undefined,
            webhookSecret: webhookSecret || undefined,
            shopifyLocationGid: locationGid || null,
            mode,
          }),
        }),
      "Shopify connection saved.",
    );
    if (!next) return;
    setConnection(next);
    setAccessToken("");
    setWebhookSecret("");
  }

  async function enableDemo() {
    const next = await write.run(
      "Enable demo",
      () => api<ShopifyConnection>("/api/shopify/enable-demo", { method: "POST" }),
      "Demo Shopify channel is on. Simulate a customer order below.",
    );
    if (!next) return;
    setConnection(next);
    setShopDomain(next.shopDomain ?? "");
    setMode(next.mode);
  }

  async function syncSellable() {
    const result = await write.run("Push sellable", async () => {
      const synced = await api<ShopifyInventorySync>("/api/shopify/inventory/sync", { method: "POST", body: "{}" });
      await load();
      return synced;
    });
    if (!result) return;
    const skipped = result.skipped.length ? ` Skipped ${result.skipped.map((row) => row.sku).join(", ")}.` : "";
    if (result.status === "demo") toast.success(`Demo inventorySetQuantities recorded for ${result.rows.length} SKUs.${skipped}`);
    else if (result.status === "synced") toast.success(`Pushed sellable qty for ${result.rows.length} SKUs.${skipped}`);
    else toast.warning(result.error || `Inventory sync ${result.status}.${skipped}`);
  }

  async function simulate() {
    await write.run(
      "Simulate order",
      async () => {
        const result = await api<{ number?: string; created?: boolean }>("/api/shopify/simulate-order", {
          method: "POST",
          body: JSON.stringify({
            customerName,
            lines: [{ sku, qty: Number(qty) }],
          }),
        });
        await load();
        return result;
      },
      (result) =>
        result.created
          ? `Shopify order ${result.number} is on the pick board.`
          : `Shopify order ${result.number} was already in Rackline.`,
    );
  }

  const live = connection?.connected && connection.mode === "live";

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Shopify"
        description="Customer checkout lands here as a pick ticket. Sellable qty (on-hand − held − remaining to pick) is pushed back to Shopify. After ship, Rackline posts fulfillment."
      />
      <ErrorBanner error={error} />

      <div className="grid gap-(--density-gap) xl:grid-cols-2">
        <Card>
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Store connection</h2>
                <p className="text-sm text-muted-foreground">
                  Create a custom app in Shopify Admin, then paste the shop, Admin API token, and webhook signing secret. Demo
                  mode records fulfill-back and inventorySetQuantities payloads without calling Shopify.
                </p>
              </div>
              {connection?.connected ? <StatusBadge status={connection.mode} /> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <Store className="size-4 text-muted-foreground" />
              {!loaded ? (
                <Muted>Loading…</Muted>
              ) : connection?.connected ? (
                <>
                  <span className="font-mono text-xs">{connection.shopDomain}</span>
                  <span className="text-xs text-muted-foreground">
                    {connection.tokenHint ? `token ${connection.tokenHint}` : "no Admin token (demo)"}
                  </span>
                </>
              ) : (
                <Muted>No shop connected yet.</Muted>
              )}
            </div>

            {owner ? (
              <form className="space-y-4" onSubmit={onSubmit(save)}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field label="Shop domain">
                      <Input
                        value={shopDomain}
                        onChange={(e) => setShopDomain(e.target.value)}
                        placeholder="northwind-makers.myshopify.com"
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Admin API access token">
                    <Input
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder={connection?.hasAccessToken ? "Leave blank to keep current" : "shpat_…"}
                    />
                  </Field>
                  <Field label="Webhook signing secret">
                    <Input
                      type="password"
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      placeholder={connection?.hasWebhookSecret ? "Leave blank to keep current" : "Required"}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Shopify location">
                      {locations.length ? (
                        <Select value={locationGid} onChange={(e) => setLocationGid(e.target.value)}>
                          <option value="">Select location</option>
                          {locations.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          value={locationGid}
                          onChange={(e) => setLocationGid(e.target.value)}
                          placeholder="gid://shopify/Location/…"
                        />
                      )}
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Mode">
                      <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                        <option value="demo">Demo — capture fulfill-back locally</option>
                        <option value="live">Live — call Shopify Admin GraphQL</option>
                      </Select>
                    </Field>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                  {!connection?.connected ? (
                    <Button variant="outline" disabled={write.busy} onClick={() => void enableDemo()}>
                      <FlaskConical className="size-4" />
                      Enable demo shop
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => void install()}>
                    <ExternalLink className="size-4" />
                    Install Shopify app
                  </Button>
                  <Button type="submit" disabled={write.busy}>
                    Save connection
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Owners connect the shop. Operators can still simulate inbound orders.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Webhook endpoints</h2>
              <p className="text-sm text-muted-foreground">
                Subscribe <span className="font-mono">orders/create</span>, <span className="font-mono">orders/updated</span>, and{" "}
                <span className="font-mono">orders/cancelled</span>. For a fulfillment service, set the callback URL prefix so
                Shopify posts <span className="font-mono">/fulfillment_order_notification</span>.
              </p>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="space-y-1">
                <dt className="text-xs font-medium text-muted-foreground">Orders webhook</dt>
                <dd>
                  {connection?.webhookUrl ? (
                    <CopyValue value={connection.webhookUrl} label="Orders webhook URL" />
                  ) : (
                    <Muted>—</Muted>
                  )}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs font-medium text-muted-foreground">Fulfillment service callback</dt>
                <dd>
                  {connection?.fulfillmentNotificationUrl ? (
                    <CopyValue value={connection.fulfillmentNotificationUrl} label="Fulfillment callback URL" />
                  ) : (
                    <Muted>—</Muted>
                  )}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs font-medium text-muted-foreground">Admin API scopes</dt>
                <dd className="flex flex-wrap gap-1">
                  {(connection?.scopes ?? []).map((scope) => (
                    <span key={scope} className="rounded-md border bg-muted/50 px-1.5 py-px font-mono text-[11px]">
                      {scope}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </div>
        </Card>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-sm font-semibold">Sellable qty</h2>
            <p className="text-sm text-muted-foreground">
              Storefront available = on-hand − held − remaining to pick, so Shopify does not sell what the floor already owes.
              Demo records the GraphQL payload. Live calls <span className="font-mono">inventorySetQuantities</span> and skips
              SKUs without an inventory item.
            </p>
          </div>
          <ActionButton
            variant="outline"
            action={{
              label: "Push sellable",
              icon: RefreshCw,
              onSelect: syncSellable,
              confirm: live
                ? {
                    title: "Push sellable qty to Shopify?",
                    body: "Storefront available qty is overwritten for every linked SKU at the chosen location.",
                    confirmLabel: "Push sellable",
                  }
                : undefined,
            }}
          />
        </div>
        <DataTable
          id="shopify-sellable"
          paramPrefix="s_"
          data={inventory?.rows}
          loading={!loaded}
          columns={SELLABLE_COLUMNS}
          getRowId={(row) => row.itemId}
          defaultSort={{ id: "sku", desc: false }}
          search={{ placeholder: "Search SKU", text: (row) => `${row.sku} ${row.name}` }}
          exportName="shopify-sellable"
          empty={
            <EmptyState icon={Store} title="No catalog SKUs yet." body="Add items under Stock → Items and they show up here." />
          }
        />
      </section>

      <Card>
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Simulate a customer order</h2>
            <p className="text-sm text-muted-foreground">
              Builds a signed Shopify <span className="font-mono">orders/create</span> payload and runs the same ingest path as a
              live webhook. Then pick and ship it on{" "}
              <Link className="underline" to="/outbound/orders">
                Orders
              </Link>
              .
            </p>
          </div>
          <form className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto] md:items-end" onSubmit={onSubmit(simulate)}>
            <Field label="Customer">
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
            </Field>
            <Field label="SKU">
              <Select value={sku} onChange={(e) => setSku(e.target.value)}>
                <option value="">Select SKU</option>
                {items.map((item) => (
                  <option key={item.id} value={item.sku}>
                    {item.sku} — {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Qty">
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Button type="submit" disabled={write.busy}>
              <PackagePlus className="size-4" />
              Ingest from Shopify
            </Button>
          </form>
        </div>
      </Card>

      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold">Posts back to Shopify</h2>
          <p className="text-sm text-muted-foreground">
            Fulfillments and sellable pushes, with the request and what Shopify returned.
          </p>
        </div>
        <DataTable
          id="shopify-outbound"
          paramPrefix="o_"
          data={outbound}
          loading={!loaded}
          columns={OUTBOUND_COLUMNS}
          getRowId={(event) => event.id}
          facets={OUTBOUND_FACETS}
          defaultSort={{ id: "when", desc: true }}
          exportName="shopify-posts"
          empty={
            <EmptyState
              icon={RefreshCw}
              title="Nothing posted yet."
              body="Ship a Shopify order or push sellable qty to see the payload here."
            />
          }
        />
      </section>
    </div>
  );
}

function PayloadDetails({ request, response }: { request: unknown; response: unknown }) {
  return (
    <details className="group max-w-xl">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
        <span className="group-open:hidden">Show</span>
        <span className="hidden group-open:inline">Hide</span>
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
        {JSON.stringify({ request, response }, null, 2)}
      </pre>
    </details>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 py-1 pr-1 pl-3">
      <span className="min-w-0 flex-1 break-all font-mono text-xs">{value}</span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Copy ${label}`}
        title="Copy"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => toast.success(`${label} copied.`))
            .catch(() => toast.error("Could not copy. Select the text instead."));
        }}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}
