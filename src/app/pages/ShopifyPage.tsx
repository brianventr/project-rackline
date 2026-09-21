import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type Item,
  type Me,
  type ShopifyConnection,
  type ShopifyInventory,
  type ShopifyInventorySync,
  type ShopifyLocation,
  type ShopifyOutbound,
} from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";

export function ShopifyPage({ me }: { me: Me }) {
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [outbound, setOutbound] = useState<ShopifyOutbound[]>([]);
  const [inventory, setInventory] = useState<ShopifyInventory | null>(null);
  const [locations, setLocations] = useState<ShopifyLocation[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [locationGid, setLocationGid] = useState("");
  const [mode, setMode] = useState("demo");
  const [customerName, setCustomerName] = useState("Jordan Hale");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      setLocationGid(
        nextConnection.shopifyLocationGid ?? nextInventory.locationGid ?? nextLocations[0]?.id ?? "",
      );
    } else {
      setLocations([]);
      setLocationGid(nextConnection.shopifyLocationGid ?? nextInventory.locationGid ?? "");
    }
    if (!sku) {
      const lamp = nextItems.find((item) => item.sku === "LAMP") ?? nextItems[0];
      if (lamp) setSku(lamp.sku);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function save() {
    setError(null);
    setNotice(null);
    try {
      const next = await api<ShopifyConnection>("/api/shopify/connection", {
        method: "PUT",
        body: JSON.stringify({
          shopDomain,
          accessToken: accessToken || undefined,
          webhookSecret: webhookSecret || undefined,
          shopifyLocationGid: locationGid || null,
          mode,
        }),
      });
      setConnection(next);
      setAccessToken("");
      setWebhookSecret("");
      setNotice("Shopify connection saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save connection");
    }
  }

  async function enableDemo() {
    setError(null);
    setNotice(null);
    try {
      const next = await api<ShopifyConnection>("/api/shopify/enable-demo", { method: "POST" });
      setConnection(next);
      setShopDomain(next.shopDomain ?? "");
      setMode(next.mode);
      setNotice("Demo Shopify channel is on. Simulate a customer order below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable demo");
    }
  }

  async function syncSellable() {
    setError(null);
    setNotice(null);
    try {
      const result = await api<ShopifyInventorySync>("/api/shopify/inventory/sync", { method: "POST", body: "{}" });
      await load();
      const skipped = result.skipped.length ? ` Skipped ${result.skipped.map((row) => row.sku).join(", ")}.` : "";
      setNotice(
        result.status === "demo"
          ? `Demo inventorySetQuantities recorded for ${result.rows.length} SKUs.${skipped}`
          : result.status === "synced"
            ? `Pushed sellable qty for ${result.rows.length} SKUs.${skipped}`
            : result.error || `Inventory sync ${result.status}.${skipped}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not push sellable qty");
    }
  }

  async function simulate() {
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ number?: string; created?: boolean }>("/api/shopify/simulate-order", {
        method: "POST",
        body: JSON.stringify({
          customerName,
          lines: [{ sku, qty: Number(qty) }],
        }),
      });
      await load();
      setNotice(
        result.created
          ? `Shopify order ${result.number} is on the pick board.`
          : `Shopify order ${result.number} was already in Rackline.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not simulate order");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Shopify"
        description="Customer checkout lands here as a pick ticket. Sellable qty (on-hand − held − remaining to pick) is pushed back to Shopify. After ship, Rackline posts fulfillment."
      />
      <ErrorBanner error={error} />
      {notice ? (
        <div className="mb-4 rounded-lg border border-ok/30 bg-ok/10 px-4 py-3 text-sm text-ok">{notice}</div>
      ) : null}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-semibold">Store connection</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Create a custom app in Shopify Admin, then paste the shop, Admin API token, and webhook signing secret.
            Demo mode records fulfill-back and inventorySetQuantities payloads without calling Shopify.
          </p>
          {connection?.connected ? (
            <p className="mb-4 text-sm">
              <StatusBadge status={connection.mode} />{" "}
              <span className="font-mono text-xs">{connection.shopDomain}</span>
              {connection.tokenHint ? (
                <span className="ml-2 text-xs text-muted-foreground">token {connection.tokenHint}</span>
              ) : (
                <span className="ml-2 text-xs text-muted-foreground">no Admin token (demo)</span>
              )}
            </p>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">No shop connected yet.</p>
          )}
          {owner ? (
            <form className="space-y-3" onSubmit={onSubmit(save)}>
              <Field label="Shop domain">
                <Input
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  placeholder="northwind-makers.myshopify.com"
                  required
                />
              </Field>
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
              <Field label="Mode">
                <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="demo">Demo — capture fulfill-back locally</option>
                  <option value="live">Live — call Shopify Admin GraphQL</option>
                </Select>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Save connection</Button>
                {!connection?.connected ? (
                  <Button variant="secondary" onClick={enableDemo}>
                    Enable demo shop
                  </Button>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Owners connect the shop. Operators can still simulate inbound orders.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">Webhook endpoints</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Subscribe <span className="font-mono">orders/create</span>,{" "}
            <span className="font-mono">orders/updated</span>, and{" "}
            <span className="font-mono">orders/cancelled</span>. For a fulfillment service, set the callback URL
            prefix so Shopify posts <span className="font-mono">/fulfillment_order_notification</span>.
          </p>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Orders webhook</dt>
              <dd className="mt-1 break-all font-mono text-xs">{connection?.webhookUrl}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Fulfillment service callback</dt>
              <dd className="mt-1 break-all font-mono text-xs">{connection?.fulfillmentNotificationUrl}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Admin API scopes</dt>
              <dd className="mt-1 font-mono text-xs leading-5">{connection?.scopes.join(", ")}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mb-1 font-semibold">Sellable qty</h2>
            <p className="text-sm text-muted-foreground">
              Storefront available = on-hand − held − remaining to pick. Ingest is still a promise until pick start;
              this overlay keeps Shopify from selling what the floor already owes. Demo records the GraphQL payload.
              Live calls <span className="font-mono">inventorySetQuantities</span> and skips SKUs without an inventory item.
            </p>
          </div>
          <Button variant="secondary" onClick={() => void syncSellable()}>
            Push sellable
          </Button>
        </div>
        {inventory?.rows.length ? (
          <Table columns={["SKU", "On hand", "Held", "To pick", "Sellable"]}>
            {inventory.rows.map((row) => (
              <tr key={row.itemId}>
                <td className="px-4 py-3 font-mono">{row.sku}</td>
                <td className="px-4 py-3 font-mono">{row.onHand}</td>
                <td className="px-4 py-3 font-mono">{row.held}</td>
                <td className="px-4 py-3 font-mono">{row.remainingToPick}</td>
                <td className="px-4 py-3 font-mono">{row.sellable}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No catalog SKUs yet.</p>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 font-semibold">Simulate a customer order</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Builds a signed Shopify <span className="font-mono">orders/create</span> payload and runs the same ingest
          path as a live webhook. Then pick and ship it on{" "}
          <Link className="underline" to="/outbound/orders">
            Orders
          </Link>
          .
        </p>
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
          <Button type="submit">Ingest from Shopify</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Fulfillment posts back to Shopify</h2>
        {outbound.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ship a Shopify order or push sellable qty to see the payload here.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {outbound.map((event) => (
              <li key={event.id} className="rounded-lg border border-line px-3 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={event.status} />
                  <span className="font-mono text-xs">{event.kind}</span>
                  <span className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                  {JSON.stringify({ request: event.request, response: event.response }, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
