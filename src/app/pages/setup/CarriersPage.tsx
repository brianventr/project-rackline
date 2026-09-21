import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type CarrierCatalogProvider,
  type CarrierConnection,
  type CarrierHub,
  type CarrierOutbound,
} from "../../api";
import { useWarehouse } from "../../warehouse";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, onSubmit } from "../../components/ui";

const CREDENTIAL_LABELS: Record<string, string> = {
  accountNumber: "Account number",
  apiKey: "API key",
  apiSecret: "API secret",
  meterNumber: "Meter number",
};

export function CarriersPage() {
  const warehouse = useWarehouse();
  const [hub, setHub] = useState<CarrierHub | null>(null);
  const [outbound, setOutbound] = useState<CarrierOutbound[]>([]);
  const [selected, setSelected] = useState<string>("ups");
  const [nickname, setNickname] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [meterNumber, setMeterNumber] = useState("");
  const [mode, setMode] = useState("demo");
  const [enabled, setEnabled] = useState<string[]>([]);
  const [shipFrom, setShipFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const provider = hub?.catalog.find((row) => row.id === selected) ?? null;
  const connection = hub?.connections.find((row) => row.provider === selected) ?? null;

  async function load(nextSelected?: string) {
    const [nextHub, nextOutbound] = await Promise.all([
      api<CarrierHub>(`/api/carriers?warehouseId=${encodeURIComponent(warehouse.warehouseId)}`),
      api<CarrierOutbound[]>("/api/carriers/outbound"),
    ]);
    setHub(nextHub);
    setOutbound(nextOutbound);
    setShipFrom(nextHub.shipFromAddress ?? "");
    const pick =
      nextSelected ||
      nextHub.connections.find((row) => row.isDefault)?.provider ||
      nextHub.catalog[1]?.id ||
      "ups";
    setSelected(pick);
    applyConnection(nextHub.catalog.find((row) => row.id === pick), nextHub.connections.find((row) => row.provider === pick));
  }

  function applyConnection(nextProvider?: CarrierCatalogProvider | null, nextConnection?: CarrierConnection | null) {
    setNickname(nextConnection?.nickname || nextProvider?.name || "");
    setAccountNumber(nextConnection?.accountNumber || "");
    setApiKey("");
    setApiSecret("");
    setMeterNumber("");
    setMode(nextConnection?.mode || "demo");
    setEnabled(nextConnection?.enabledServices ?? nextProvider?.services.map((row) => row.id) ?? []);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [warehouse.warehouseId]);

  const connectedProviders = useMemo(() => new Set(hub?.connections.map((row) => row.provider) ?? []), [hub]);

  async function saveConnection() {
    if (!provider) return;
    setError(null);
    setNotice(null);
    try {
      const body = {
        nickname,
        accountNumber: accountNumber || undefined,
        apiKey: apiKey || undefined,
        apiSecret: apiSecret || undefined,
        meterNumber: meterNumber || undefined,
        mode,
        enabledServices: enabled,
      };
      if (connection) {
        await api(`/api/carriers/${connection.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api("/api/carriers", {
          method: "POST",
          body: JSON.stringify({ ...body, provider: provider.id }),
        });
      }
      await load(provider.id);
      setNotice(`${provider.name} connection saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save carrier");
    }
  }

  async function enableDemo() {
    setError(null);
    setNotice(null);
    try {
      await api("/api/carriers/enable-demo", { method: "POST" });
      await load("ups");
      setNotice("Demo UPS and USPS accounts are on. Buy a label from an order to mint tracking.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable demo carriers");
    }
  }

  async function testConnection() {
    if (!connection) return;
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ message?: string }>(`/api/carriers/${connection.id}/test`, { method: "POST" });
      await load(selected);
      setNotice(result.message || "Connection test passed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    }
  }

  async function makeDefault() {
    if (!connection) return;
    setError(null);
    try {
      await api(`/api/carriers/${connection.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDefault: true }),
      });
      await load(selected);
      setNotice(`${connection.nickname} is the default carrier.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set default");
    }
  }

  async function disconnect() {
    if (!connection) return;
    setError(null);
    try {
      await api(`/api/carriers/${connection.id}`, { method: "DELETE" });
      await load(selected);
      setNotice(`${connection.name} disconnected.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    }
  }

  async function saveShipFrom() {
    if (!hub?.warehouseId) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/api/warehouses/${hub.warehouseId}`, {
        method: "PATCH",
        body: JSON.stringify({ shipFromAddress: shipFrom }),
      });
      setNotice("Ship-from address saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save ship-from");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Carriers"
        description="Connect your own UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine account. Demo mints tracking. Live EasyPost or ShipEngine shops rates and buys postage; direct carrier APIs are not called."
      />
      <ErrorBanner error={error} />
      {notice ? (
        <div className="mb-4 rounded-lg border border-ok/30 bg-ok/10 px-4 py-3 text-sm text-ok">{notice}</div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void enableDemo()}>
          Enable demo carriers
        </Button>
        <Button variant="secondary" asChild>
          <Link to="/setup/warehouse">Warehouse ship-from</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link to="/outbound/orders">Orders</Link>
        </Button>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(hub?.catalog ?? []).map((row) => {
          const connected = connectedProviders.has(row.id);
          const active = selected === row.id;
          const isDefault = hub?.connections.find((item) => item.provider === row.id)?.isDefault;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setSelected(row.id);
                applyConnection(row, hub?.connections.find((item) => item.provider === row.id));
              }}
              className={`rounded-xl border p-4 text-left ${active ? "border-primary bg-primary/5" : "bg-card"}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold">{row.name}</p>
                {connected ? <StatusBadge status={isDefault ? "default" : "connected"} /> : (
                  <span className="text-xs text-muted-foreground">Not connected</span>
                )}
              </div>
              <p className="text-xs uppercase text-muted-foreground">{row.kind}</p>
              <p className="mt-2 text-sm text-muted-foreground">{row.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-semibold">{provider?.name ?? "Carrier"} connection</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {provider?.description} Leave secret fields blank to keep the current value.
          </p>
          {connection ? (
            <p className="mb-4 text-sm">
              <StatusBadge status={connection.mode} />{" "}
              <StatusBadge status={connection.status} />
              {connection.accountNumber ? (
                <span className="ml-2 font-mono text-xs">{connection.accountNumber}</span>
              ) : null}
              {connection.apiKeyHint ? (
                <span className="ml-2 text-xs text-muted-foreground">key {connection.apiKeyHint}</span>
              ) : (
                <span className="ml-2 text-xs text-muted-foreground">no API key</span>
              )}
            </p>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">No {provider?.name} account connected yet.</p>
          )}
          {provider ? (
            <form className="space-y-3" onSubmit={onSubmit(saveConnection)}>
              <Field label="Nickname">
                <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={provider.name} />
              </Field>
              {provider.credentialFields.includes("accountNumber") ? (
                <Field label={CREDENTIAL_LABELS.accountNumber}>
                  <Input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder={provider.id === "ups" ? "A1B2C3" : "Account number"}
                  />
                </Field>
              ) : null}
              {provider.credentialFields.includes("apiKey") ? (
                <Field label={CREDENTIAL_LABELS.apiKey}>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={connection?.hasApiKey ? "Leave blank to keep current" : "API key"}
                  />
                </Field>
              ) : null}
              {provider.credentialFields.includes("apiSecret") ? (
                <Field label={CREDENTIAL_LABELS.apiSecret}>
                  <Input
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder={connection?.hasApiSecret ? "Leave blank to keep current" : "API secret"}
                  />
                </Field>
              ) : null}
              {provider.credentialFields.includes("meterNumber") ? (
                <Field label={CREDENTIAL_LABELS.meterNumber}>
                  <Input
                    type="password"
                    value={meterNumber}
                    onChange={(e) => setMeterNumber(e.target.value)}
                    placeholder={connection?.hasMeterNumber ? "Leave blank to keep current" : "Meter number"}
                  />
                </Field>
              ) : null}
              <Field label="Mode">
                <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="demo">Demo — mint tracking locally</option>
                  <option value="live">Live — EasyPost / ShipEngine buy postage</option>
                </Select>
              </Field>
              <div>
                <p className="mb-2 text-sm font-medium">Services</p>
                <ul className="space-y-2 text-sm">
                  {provider.services.map((service) => (
                    <li key={service.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={enabled.includes(service.id)}
                          onChange={(e) =>
                            setEnabled((current) =>
                              e.target.checked
                                ? [...current, service.id]
                                : current.filter((id) => id !== service.id),
                            )
                          }
                        />
                        {service.company} {service.service}
                        <span className="font-mono text-xs text-muted-foreground">{service.id}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">{connection ? "Save connection" : "Connect"}</Button>
                {connection ? (
                  <Button variant="secondary" onClick={() => void testConnection()}>
                    Test connection
                  </Button>
                ) : null}
                {connection && !connection.isDefault ? (
                  <Button variant="secondary" onClick={() => void makeDefault()}>
                    Set as default
                  </Button>
                ) : null}
                {connection && provider.id !== "rackline" ? (
                  <Button variant="danger" onClick={() => void disconnect()}>
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">Ship-from</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Origin address used when shopping rates and printing labels. Same field as Setup → Warehouse.
          </p>
          <form className="space-y-3" onSubmit={onSubmit(saveShipFrom)}>
            <Field label="Ship-from address">
              <textarea
                value={shipFrom}
                onChange={(e) => setShipFrom(e.target.value)}
                rows={4}
                className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                placeholder="14 Dock St, Portland, OR 97209"
              />
            </Field>
            <Button type="submit">Save ship-from</Button>
          </form>
          <div className="mt-6">
            <h3 className="mb-2 font-medium">Enabled for the floor</h3>
            {(hub?.enabledServices.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">Connect a carrier to offer services at ship.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(hub?.enabledServices ?? []).map((row) => (
                  <li key={`${row.connectionId ?? "none"}:${row.id}`}>
                    {row.company} {row.service}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{row.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Carrier activity</h2>
        {outbound.length === 0 ? (
          <p className="text-sm text-muted-foreground">Test a connection or buy a label to see the payload here.</p>
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
