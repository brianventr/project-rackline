import { useEffect, useMemo, useState } from "react";
import { Copy, FlaskConical, Plug, Star, Truck, Unplug } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  api,
  errorText,
  type CarrierCatalogProvider,
  type CarrierConnection,
  type CarrierHub,
  type CarrierOutbound,
} from "../../api";
import { useWarehouse } from "../../warehouse";
import { Button, Card, EmptyState, ErrorBanner, Field, PageHeader, StatusBadge, onSubmit } from "../../components/ui";
import { ActionButton, DocumentFact } from "../../components/document";
import { DataTable, type DataColumn, type FacetDef } from "../../components/data-table/DataTable";
import { Muted, RelativeTime } from "../../components/cells";
import { useConfirm } from "../../components/confirm";
import { SelectField, TextField, useZodForm, type ZodFormInput, type ZodFormOutput } from "../../components/form-kit";
import { useWrite } from "../../use-write";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { choiceOf, optionalText } from "@/domain/form-schemas";

type CredentialField = "accountNumber" | "apiKey" | "apiSecret" | "meterNumber";

const CREDENTIAL_LABELS: Record<CredentialField, string> = {
  accountNumber: "Account number",
  apiKey: "API key",
  apiSecret: "API secret",
  meterNumber: "Meter number",
};

const LIVE_NEEDS: Record<CredentialField, string> = {
  accountNumber: "Enter the account number to go live.",
  apiKey: "Enter the API key to go live.",
  apiSecret: "Enter the API secret to go live.",
  meterNumber: "Enter the meter number to go live.",
};

const MODE_OPTIONS = [
  { value: "demo", label: "Demo — mint tracking locally" },
  { value: "live", label: "Live — EasyPost / ShipEngine buy postage" },
];

const CREDENTIAL_FIELDS = Object.keys(CREDENTIAL_LABELS) as CredentialField[];

function isCredentialField(field: string): field is CredentialField {
  return field in CREDENTIAL_LABELS;
}

/** A blank credential keeps the saved one, so only a field with nothing saved behind it can be missing. */
function hasSaved(connection: CarrierConnection | null, field: CredentialField): boolean {
  if (!connection) return false;
  if (field === "accountNumber") return Boolean(connection.accountNumber);
  if (field === "apiKey") return connection.hasApiKey;
  if (field === "apiSecret") return connection.hasApiSecret;
  return connection.hasMeterNumber;
}

/**
 * POST /api/carriers and PATCH /api/carriers/:id (`validateConnectionCredentials`): demo needs no keys;
 * live needs every credential the provider lists, typed here or already saved.
 */
function carrierFormSchema(provider: CarrierCatalogProvider | null, connection: CarrierConnection | null) {
  return z
    .object({
      nickname: optionalText,
      accountNumber: optionalText,
      apiKey: optionalText,
      apiSecret: optionalText,
      meterNumber: optionalText,
      webhookSecret: optionalText,
      mode: choiceOf(["demo", "live"], "Pick demo or live."),
    })
    .superRefine((values, ctx) => {
      if (!provider || values.mode !== "live") return;
      for (const field of provider.credentialFields) {
        if (!isCredentialField(field) || values[field].trim() || hasSaved(connection, field)) continue;
        ctx.addIssue({ code: "custom", message: LIVE_NEEDS[field], path: [field], input: values[field] });
      }
    });
}

type CarrierFormSchema = ReturnType<typeof carrierFormSchema>;
type CarrierFormInput = ZodFormInput<CarrierFormSchema>;

const BLANK_CARRIER_FORM: CarrierFormInput = {
  nickname: "",
  accountNumber: "",
  apiKey: "",
  apiSecret: "",
  meterNumber: "",
  webhookSecret: "",
  mode: "demo",
};

const ACTIVITY_FACETS: FacetDef<CarrierOutbound>[] = [
  { id: "kind", label: "Kind", value: (event) => event.kind },
  { id: "status", label: "Status", value: (event) => event.status },
];

const ACTIVITY_COLUMNS: DataColumn<CarrierOutbound>[] = [
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
    id: "status",
    header: "Status",
    sortValue: (event) => event.status,
    cell: (event) => <StatusBadge status={event.status} />,
  },
  {
    id: "payload",
    header: "Payload",
    csv: (event) => JSON.stringify({ request: event.request, response: event.response }),
    cell: (event) => <PayloadDetails request={event.request} response={event.response} />,
  },
];

export function CarriersPage() {
  const warehouse = useWarehouse();
  const confirm = useConfirm();
  const write = useWrite();
  const [hub, setHub] = useState<CarrierHub | null>(null);
  const [outbound, setOutbound] = useState<CarrierOutbound[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string>("ups");
  const [enabled, setEnabled] = useState<string[]>([]);
  const [shipFrom, setShipFrom] = useState("");

  const provider = hub?.catalog.find((row) => row.id === selected) ?? null;
  const connection = hub?.connections.find((row) => row.provider === selected) ?? null;
  const schema = useMemo(() => carrierFormSchema(provider, connection), [provider, connection]);
  const form = useZodForm(schema, BLANK_CARRIER_FORM);

  // Keys are only needed for live, so a mode change re-checks any key message already showing.
  const formMode = form.watch("mode");
  const { getFieldState, trigger } = form;
  useEffect(() => {
    const showing = CREDENTIAL_FIELDS.filter((field) => getFieldState(field).invalid);
    if (showing.length) void trigger(showing);
  }, [formMode, getFieldState, trigger]);

  async function load(nextSelected?: string) {
    const [nextHub, nextOutbound] = await Promise.all([
      api<CarrierHub>(`/api/carriers?warehouseId=${encodeURIComponent(warehouse.warehouseId)}`),
      api<CarrierOutbound[]>("/api/carriers/outbound"),
    ]);
    setHub(nextHub);
    setOutbound(nextOutbound);
    setLoaded(true);
    setShipFrom(nextHub.shipFromAddress ?? "");
    const pick = nextSelected || nextHub.connections.find((row) => row.isDefault)?.provider || nextHub.catalog[1]?.id || "ups";
    setSelected(pick);
    applyConnection(
      nextHub.catalog.find((row) => row.id === pick),
      nextHub.connections.find((row) => row.provider === pick),
    );
  }

  function applyConnection(nextProvider?: CarrierCatalogProvider | null, nextConnection?: CarrierConnection | null) {
    form.reset({
      nickname: nextConnection?.nickname || nextProvider?.name || "",
      accountNumber: nextConnection?.accountNumber || "",
      apiKey: "",
      apiSecret: "",
      meterNumber: "",
      webhookSecret: "",
      mode: nextConnection?.mode === "live" ? "live" : "demo",
    });
    setEnabled(nextConnection?.enabledServices ?? nextProvider?.services.map((row) => row.id) ?? []);
  }

  useEffect(() => {
    load().catch((err: unknown) => write.setError(errorText(err, "Could not load carriers.")));
  }, [warehouse.warehouseId]);

  const connectedProviders = useMemo(() => new Set(hub?.connections.map((row) => row.provider) ?? []), [hub]);

  async function saveConnection(values: ZodFormOutput<CarrierFormSchema>) {
    if (!provider) return;
    const { mode } = values;
    if (mode === "live" && connection?.mode !== "live") {
      const ok = await confirm({
        title: `Switch ${provider.name} to live?`,
        body: "Buying a label from an order will purchase real postage through EasyPost or ShipEngine and bill the connected account.",
        confirmLabel: "Go live",
        cancelLabel: "Stay in demo",
      });
      if (!ok) return;
    }
    const body = {
      nickname: values.nickname,
      accountNumber: values.accountNumber || undefined,
      apiKey: values.apiKey || undefined,
      apiSecret: values.apiSecret || undefined,
      meterNumber: values.meterNumber || undefined,
      webhookSecret: values.webhookSecret || undefined,
      mode,
      enabledServices: enabled,
    };
    await write.run(
      "Save carrier",
      async () => {
        if (connection) {
          await api(`/api/carriers/${connection.id}`, { method: "PATCH", body: JSON.stringify(body) });
        } else {
          await api("/api/carriers", {
            method: "POST",
            body: JSON.stringify({ ...body, provider: provider.id }),
          });
        }
        await load(provider.id);
      },
      `${provider.name} connection saved.`,
    );
  }

  const enableDemo = () =>
    write.run(
      "Enable demo carriers",
      async () => {
        await api("/api/carriers/enable-demo", { method: "POST" });
        await load("ups");
      },
      "Demo UPS and USPS accounts are on. Buy a label from an order to mint tracking.",
    );

  async function testConnection() {
    if (!connection) return;
    await write.run(
      "Test",
      async () => {
        const result = await api<{ message?: string }>(`/api/carriers/${connection.id}/test`, { method: "POST" });
        await load(selected);
        return result;
      },
      (result) => result.message || "Connection test passed.",
    );
  }

  async function makeDefault() {
    if (!connection) return;
    await write.run(
      "Set default",
      async () => {
        await api(`/api/carriers/${connection.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isDefault: true }),
        });
        await load(selected);
      },
      `${connection.nickname} is the default carrier.`,
    );
  }

  async function confirmDisconnect() {
    if (!connection) return;
    const ok = await confirm({
      title: `Disconnect ${connection.nickname || connection.name}?`,
      body: `Its stored keys are deleted and its services drop off the ship screen.${
        connection.isDefault ? " Rackline Ground becomes the default carrier." : ""
      } To reconnect you paste the keys again.`,
      confirmLabel: "Disconnect",
      cancelLabel: "Keep connected",
      tone: "danger",
    });
    if (ok) await disconnect();
  }

  async function disconnect() {
    if (!connection) return;
    await write.run(
      "Disconnect",
      async () => {
        await api(`/api/carriers/${connection.id}`, { method: "DELETE" });
        await load(selected);
      },
      `${connection.name} disconnected.`,
    );
  }

  async function saveShipFrom() {
    if (!hub?.warehouseId) return;
    await write.run(
      "Save ship-from",
      () =>
        api(`/api/warehouses/${hub.warehouseId}`, {
          method: "PATCH",
          body: JSON.stringify({ shipFromAddress: shipFrom }),
        }),
      "Ship-from address saved.",
    );
  }

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Carriers"
        description="Connect your own UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine account. Demo mints tracking. Live accounts shop rates and buy postage."
        actions={
          <ActionButton variant="outline" action={{ label: "Enable demo carriers", icon: FlaskConical, onSelect: enableDemo }} />
        }
      />
      <ErrorBanner error={write.error} />

      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold">Accounts</h2>
          <p className="text-sm text-muted-foreground">Pick a carrier to connect it or change its settings.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {(hub?.catalog ?? []).map((row) => {
            const connected = connectedProviders.has(row.id);
            const active = selected === row.id;
            const isDefault = hub?.connections.find((item) => item.provider === row.id)?.isDefault;
            return (
              <button
                key={row.id}
                type="button"
                title={row.description}
                aria-pressed={active}
                onClick={() => {
                  setSelected(row.id);
                  applyConnection(
                    row,
                    hub?.connections.find((item) => item.provider === row.id),
                  );
                }}
                className={cn(
                  "rounded-lg border bg-card px-3 py-2.5 text-left shadow-xs transition-colors hover:border-primary/40",
                  active && "border-primary bg-primary/5 ring-2 ring-primary/15",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="text-sm font-semibold">{row.name}</p>
                  {connected ? (
                    <StatusBadge status={isDefault ? "default" : "connected"} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Off</span>
                  )}
                </div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{row.kind}</p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-(--density-gap) xl:grid-cols-2">
        <Card>
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{provider?.name ?? "Carrier"} connection</h2>
                <p className="text-sm text-muted-foreground">
                  {provider?.description} Leave secret fields blank to keep the current value.
                </p>
              </div>
              {connection ? (
                <span className="flex flex-wrap gap-1">
                  <StatusBadge status={connection.mode} />
                  <StatusBadge status={connection.status} />
                  {connection.isDefault ? <StatusBadge status="default" /> : null}
                </span>
              ) : null}
            </div>

            {connection ? (
              <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2">
                {connection.accountNumber ? (
                  <DocumentFact label="Account">
                    <span className="font-mono text-xs">{connection.accountNumber}</span>
                  </DocumentFact>
                ) : null}
                <DocumentFact label="API key">
                  {connection.apiKeyHint ? (
                    <span className="font-mono text-xs">{connection.apiKeyHint}</span>
                  ) : (
                    <Muted>None</Muted>
                  )}
                </DocumentFact>
                {connection.lastTestedAt ? (
                  <DocumentFact label="Last test">
                    <span className="inline-flex items-center gap-2">
                      {connection.lastTestStatus ? <StatusBadge status={connection.lastTestStatus} /> : null}
                      <RelativeTime at={connection.lastTestedAt} />
                    </span>
                  </DocumentFact>
                ) : null}
                {connection.lastTestError ? <p className="text-xs text-destructive">{connection.lastTestError}</p> : null}
              </div>
            ) : provider ? (
              <p className="text-sm text-muted-foreground">No {provider.name} account connected yet.</p>
            ) : null}

            {provider ? (
              <form className="space-y-4" onSubmit={form.handleSubmit(saveConnection)}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField form={form} name="nickname" label="Nickname" placeholder={provider.name} className="sm:col-span-2" />
                  {provider.credentialFields.includes("accountNumber") ? (
                    <TextField
                      form={form}
                      name="accountNumber"
                      label={CREDENTIAL_LABELS.accountNumber}
                      placeholder={provider.id === "ups" ? "A1B2C3" : "Account number"}
                    />
                  ) : null}
                  {provider.credentialFields.includes("apiKey") ? (
                    <TextField
                      form={form}
                      name="apiKey"
                      label={CREDENTIAL_LABELS.apiKey}
                      type="password"
                      autoComplete="off"
                      placeholder={connection?.hasApiKey ? "Leave blank to keep current" : "API key"}
                    />
                  ) : null}
                  {provider.credentialFields.includes("apiSecret") ? (
                    <TextField
                      form={form}
                      name="apiSecret"
                      label={CREDENTIAL_LABELS.apiSecret}
                      type="password"
                      autoComplete="off"
                      placeholder={connection?.hasApiSecret ? "Leave blank to keep current" : "API secret"}
                    />
                  ) : null}
                  {provider.credentialFields.includes("meterNumber") ? (
                    <TextField
                      form={form}
                      name="meterNumber"
                      label={CREDENTIAL_LABELS.meterNumber}
                      type="password"
                      autoComplete="off"
                      placeholder={connection?.hasMeterNumber ? "Leave blank to keep current" : "Meter number"}
                    />
                  ) : null}
                  {provider.id === "easypost" || provider.id === "shipengine" ? (
                    <TextField
                      form={form}
                      name="webhookSecret"
                      label="Tracker webhook secret"
                      type="password"
                      autoComplete="off"
                      placeholder={connection?.hasWebhookSecret ? "Leave blank to keep current" : "HMAC secret"}
                    />
                  ) : null}
                </div>

                <SelectField form={form} name="mode" label="Mode" options={MODE_OPTIONS} />

                <fieldset className="space-y-2">
                  <legend className="mb-1.5 text-sm font-medium">Services</legend>
                  <ul className="space-y-1.5">
                    {provider.services.map((service) => (
                      <li key={service.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={enabled.includes(service.id)}
                            onCheckedChange={(value) =>
                              setEnabled((current) =>
                                value === true ? [...current, service.id] : current.filter((id) => id !== service.id),
                              )
                            }
                          />
                          <span>
                            {service.company} {service.service}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">{service.id}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <div>
                    {connection && provider.id !== "rackline" ? (
                      <Button
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={write.busy}
                        onClick={() => void confirmDisconnect()}
                      >
                        <Unplug className="size-4" />
                        Disconnect
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {connection ? (
                      <Button variant="outline" disabled={write.busy} onClick={() => void testConnection()}>
                        <Plug className="size-4" />
                        Test connection
                      </Button>
                    ) : null}
                    {connection && !connection.isDefault ? (
                      <Button variant="outline" disabled={write.busy} onClick={() => void makeDefault()}>
                        <Star className="size-4" />
                        Set as default
                      </Button>
                    ) : null}
                    <Button type="submit" disabled={write.busy}>
                      {connection ? "Save connection" : "Connect"}
                    </Button>
                  </div>
                </div>
              </form>
            ) : !loaded ? (
              <p className="text-sm text-muted-foreground">Loading carriers…</p>
            ) : null}
          </div>
        </Card>

        <div className="space-y-(--density-gap)">
          <Card>
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold">Ship-from</h2>
                <p className="text-sm text-muted-foreground">
                  Origin address used when shopping rates and printing labels. Same field as Setup → Warehouse.
                </p>
              </div>
              <form className="space-y-3" onSubmit={onSubmit(saveShipFrom)}>
                <Field label="Ship-from address">
                  <Textarea
                    value={shipFrom}
                    onChange={(e) => setShipFrom(e.target.value)}
                    rows={4}
                    placeholder="14 Dock St, Portland, OR 97209"
                  />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" variant="outline" disabled={write.busy || !hub?.warehouseId}>
                    Save ship-from
                  </Button>
                </div>
              </form>
            </div>
          </Card>

          <Card>
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Enabled for the floor</h2>
                <p className="text-sm text-muted-foreground">Services packers can pick from on the ship screen.</p>
              </div>
              {!hub ? null : hub.enabledServices.length === 0 ? (
                <EmptyState
                  icon={Truck}
                  title="No services on yet."
                  body="Connect a carrier to offer services at ship."
                  className="py-6"
                />
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {hub.enabledServices.map((row) => (
                    <li
                      key={`${row.connectionId ?? "none"}:${row.id}`}
                      className="flex items-center justify-between gap-2 px-3 py-1.5"
                    >
                      <span className="flex items-center gap-2">
                        <Truck className="size-3.5 text-muted-foreground" />
                        {row.company} {row.service}
                        {row.isDefault ? <StatusBadge status="default" /> : null}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{row.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {hub?.trackerWebhookUrl ? (
            <Card>
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Tracker webhook</h2>
                  <p className="text-sm text-muted-foreground">
                    EasyPost and ShipEngine POST tracker updates here. Demo records the payload. HMAC is required when the
                    aggregator connection is live and has a webhook secret.
                  </p>
                </div>
                <CopyValue value={hub.trackerWebhookUrl} label="Tracker webhook URL" />
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold">Carrier activity</h2>
          <p className="text-sm text-muted-foreground">The last 25 requests sent to a carrier, with what came back.</p>
        </div>
        <DataTable
          id="carrier-activity"
          data={outbound}
          loading={!loaded}
          columns={ACTIVITY_COLUMNS}
          getRowId={(event) => event.id}
          facets={ACTIVITY_FACETS}
          defaultSort={{ id: "when", desc: true }}
          search={{
            placeholder: "Search kind or payload",
            text: (event) => `${event.kind} ${event.status} ${JSON.stringify(event.request)}`,
          }}
          exportName="carrier-activity"
          empty={
            <EmptyState
              icon={Truck}
              title="No carrier calls yet."
              body="Test a connection or buy a label to see the payload here."
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
