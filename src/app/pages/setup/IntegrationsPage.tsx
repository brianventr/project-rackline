import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Boxes,
  Building2,
  Calculator,
  FileInput,
  Package,
  Printer,
  Split,
  Store,
  Truck,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { api, type CarrierHub, type ChannelStatus, type ChannelsPayload, type ShipRulesPayload } from "../../api";
import { useWrite } from "../../use-write";
import { Button, Input, PageHeader, StatusBadge, ToneBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { useApiQuery } from "../../query";
import { useSession } from "../../session";
import { useWarehouse } from "../../warehouse";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusTone } from "@/domain/status";
import { relativeTime } from "@/domain/relative-time";
import { GORGIAS_WIDGET_TEMPLATE } from "@/domain/gorgias";
import { channelHealthBadge } from "./channel-health";
import { PublicApiPanel } from "./PublicApiPanel";

function GorgiasCard({ origin }: { origin: string }) {
  const url = `${origin}/api/v1/warranty?email={{ticket.customer.email}}`;
  return (
    <IntegrationCard
      icon={Webhook}
      name="Gorgias"
      summary="Shows the order, serial, and warranty inside a ticket. Read-only."
      to="/setup/integrations"
      loading={false}
      state={{
        tone: "neutral",
        label: "HTTP widget",
        connected: true,
        detail: (
          <div className="grid gap-2 text-sm">
            <p>GET this URL with an API key that can read orders. Header: Authorization Bearer.</p>
            <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{url}</code>
            <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(GORGIAS_WIDGET_TEMPLATE, null, 2)}</pre>
          </div>
        ),
      }}
    />
  );
}

function KlaviyoCard() {
  const [mode, setMode] = useState("demo");
  const [privateKey, setPrivateKey] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const write = useWrite();
  return (
    <IntegrationCard
      icon={Webhook}
      name="Klaviyo"
      summary="Sends order being prepared, shipped with serial, and return received. ModGav owns the flows."
      to="/setup/integrations"
      loading={false}
      state={{
        tone: mode === "live" ? "success" : "neutral",
        label: mode === "live" ? "Live" : "Demo",
        connected: mode === "live",
        detail: (
          <div className="grid gap-2">
            <label className="text-sm">
              Mode
              <select className="mt-1 block rounded-md border bg-background px-2 py-1" value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="demo">Demo — record only</option>
                <option value="live">Live</option>
              </select>
            </label>
            <label className="text-sm">
              Private key
              <input
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1"
                type="password"
                value={privateKey}
                placeholder="Leave blank to keep the saved key"
                onChange={(event) => setPrivateKey(event.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              disabled={write.busy}
              onClick={() =>
                void write.run("Save Klaviyo", async () => {
                  const data = await api<{ mode: string; hasKey: boolean }>("/api/integrations/klaviyo", {
                    method: "PUT",
                    body: JSON.stringify({ mode, privateKey: privateKey.trim() ? privateKey : undefined }),
                  });
                  setSaved(data.hasKey ? `${data.mode}, key saved` : data.mode);
                  return data;
                })
              }
            >
              Save
            </Button>
            {saved ? <p className="text-sm text-muted-foreground">{saved}</p> : null}
            {write.error ? <p className="text-sm text-destructive">{write.error}</p> : null}
          </div>
        ),
      }}
    />
  );
}

type Connection = {
  tone: StatusTone;
  label: string;
  detail: ReactNode;
  connected: boolean;
};

type EdiRow = { id: string; status: string; createdAt: number };
type ClientRow = { id: string; code: string; name: string };

export function IntegrationsPage() {
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const garage = me.organization.operatingMode === "garage";
  const owner = me.role === "owner";
  const channels = useApiQuery<ChannelsPayload>("/api/channels");
  const carriers = useApiQuery<CarrierHub>(`/api/carriers?warehouseId=${encodeURIComponent(warehouseId)}`);
  const shipRules = useApiQuery<ShipRulesPayload>("/api/ship/rules");
  const edi = useApiQuery<EdiRow[]>(!garage && owner ? "/api/edi/inbox" : null);
  const clients = useApiQuery<ClientRow[]>(!garage ? "/api/clients" : null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Integrations"
        description={
          garage
            ? "Connect where you sell and how you ship. Orders land on the ship queue; tracking goes back to the buyer."
            : "Order sources, carriers, trading partners, and systems that read from Rackline."
        }
      />

      <Group title="Sales channels" hint={garage ? "Paid orders become ship-queue rows." : "Orders become pick tickets for the next wave."}>
        {channels.isLoading
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-lg" />)
          : (channels.data?.channels ?? []).map((row) => (
              <IntegrationCard
                key={row.id}
                icon={Store}
                name={row.name}
                summary={
                  row.id === "shopify" ? (
                    <>
                      Checkout → pick ticket. <Term id="sellable">Sellable qty</Term> and fulfillment post back.
                    </>
                  ) : (
                    row.blurb
                  )
                }
                to={row.setupPath}
                loading={false}
                state={channelState(row)}
              />
            ))}
        {channels.error ? <p className="text-sm text-destructive">{channels.error.message}</p> : null}
      </Group>

      <Group title="Shipping">
        <IntegrationCard
          icon={Truck}
          name="Carriers"
          summary="UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine."
          to="/setup/carriers"
          loading={carriers.isLoading}
          error={carriers.error?.message}
          state={carriers.data ? carrierState(carriers.data) : null}
        />
        {garage ? (
          <IntegrationCard
            icon={Package}
            name="Boxes & default service"
            summary="Saved box sizes and the service each label uses unless you pick another."
            to="/ship?setup=box"
            loading={carriers.isLoading}
            error={carriers.error?.message}
            state={carriers.data ? defaultServiceState(carriers.data) : null}
          />
        ) : (
          <IntegrationCard
            icon={Printer}
            name="Label printers"
            summary="Thermal printers per station for cartons, pallets, and bays."
            to="/setup/labels"
            loading={false}
            state={{ tone: "neutral", label: "Per station", detail: "Browser print works without setup.", connected: true }}
          />
        )}
        <IntegrationCard
          icon={Split}
          name="Shipping rules"
          summary={
            garage
              ? "Pick the box and service per order, or hold an order for a look before one-click ship."
              : "Box and service per order for one-click ship. They apply in Garage mode."
          }
          to="/setup/shipping-rules"
          action={shipRules.data?.rules.length ? "Manage" : "Add a rule"}
          loading={shipRules.isLoading}
          error={shipRules.error?.message}
          state={shipRules.data ? shipRulesState(shipRules.data) : null}
        />
      </Group>

      {!garage ? (
        <Group title="Trading partners & systems" hint="Manufacturer mode only.">
          <IntegrationCard
            icon={Building2}
            name="EDI"
            summary="Inbound 856 ASNs from suppliers become receipts on the dock."
            to="/setup/edi"
            loading={edi.isLoading}
            error={edi.error?.message}
            state={owner ? ediState(edi.data) : { tone: "neutral", label: "Owner only", detail: "Ask an owner to manage EDI.", connected: true }}
          />
          <IntegrationCard
            icon={Boxes}
            name="3PL clients"
            summary="Client-owned stock, per-client billing, and client-scoped orders."
            to="/setup/clients"
            loading={clients.isLoading}
            error={clients.error?.message}
            state={clients.data ? clientState(clients.data) : null}
          />
          <IntegrationCard
            icon={Webhook}
            name="Webhooks & API"
            summary="Endpoints outside systems post to. Every write is in the audit log."
            to="/setup/audit"
            action="Audit log"
            loading={false}
            state={{
              tone: "neutral",
              label: "Inbound",
              connected: true,
              detail: (
                <div className="grid gap-1">
                  <EndpointRow label="Shopify orders" url={`${origin}/api/shopify/webhooks`} />
                  <EndpointRow label="Carrier tracking" url={`${origin}/api/carriers/trackers/webhooks`} />
                  <EndpointRow label="EDI 856" url={`${origin}/api/edi/asn`} />
                </div>
              ),
            }}
          />
        </Group>
      ) : null}

      <Group title="Events">
        <KlaviyoCard />
        <GorgiasCard origin={origin} />
      </Group>

      <Group title="Imports & accounting">
        <IntegrationCard
          icon={FileInput}
          name="Crowdfunding imports"
          summary="BackerKit, Gamefound, and Kickstarter-style pledge CSV → orders and waves."
          to="/setup/imports"
          loading={false}
          state={{
            tone: "neutral",
            label: "Pledge CSV",
            detail: "Map reward SKUs to catalog items, then ship the wave.",
            connected: true,
          }}
        />
        <IntegrationCard
          icon={Calculator}
          name="Accounting exports"
          summary="QBO/Xero-ready valuation, invoice, and COGS CSVs. Set unit cost on each SKU."
          to="/setup/accounting"
          loading={false}
          state={{ tone: "neutral", label: "CSV export", detail: "Download valuation, invoices, and COGS.", connected: true }}
        />
      </Group>

      {owner ? <PublicApiPanel /> : null}

      {garage ? (
        <p className="text-sm text-muted-foreground">
          EDI, 3PL clients, and inbound API endpoints appear in Manufacturer mode.
        </p>
      ) : null}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="grid gap-(--density-gap) md:grid-cols-2">{children}</div>
    </section>
  );
}

function EndpointRow({ label, url }: { label: string; url: string }) {
  return (
    <label className="grid grid-cols-[7rem_1fr] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-7 font-mono text-xs" />
    </label>
  );
}

function channelState(row: ChannelStatus): Connection {
  const badge = channelHealthBadge(row);
  const connected = row.health !== "disconnected";
  const parts: string[] = [];
  if (row.externalShop) parts.push(row.externalShop);
  if (connected) parts.push(`${row.openOrders} open`);
  if (row.lastSyncAt) parts.push(`pulled ${relativeTime(row.lastSyncAt)}`);
  let detail: ReactNode = parts.join(" · ");
  if (!connected) {
    detail = row.liveOrders
      ? row.configured
        ? "Connect to pull paid orders automatically."
        : "Needs an app key on this deployment; CSV works today."
      : "Paste an orders export.";
  }
  if (row.lastSyncError) detail = <span className="text-destructive">{row.lastSyncError}</span>;
  else if (row.failedPostBacks) {
    detail = (
      <span className="text-destructive">
        {row.failedPostBacks} shipped {row.failedPostBacks === 1 ? "order" : "orders"} did not post tracking
      </span>
    );
  }
  if (row.id === "shopify" && row.mode) {
    detail = (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{row.externalShop}</span>
        <StatusBadge status={row.mode} />
      </span>
    );
  }
  return { tone: badge.tone, label: badge.label, detail, connected };
}

function carrierState(hub: CarrierHub): Connection {
  const accounts = hub.connections.filter((row) => row.provider !== "rackline");
  const failing = hub.connections.find((row) => row.status === "error" || row.lastTestStatus === "failed");
  const fallback = hub.connections.find((row) => row.isDefault);
  if (failing) {
    return {
      tone: "danger",
      label: "Needs attention",
      connected: true,
      detail: `${failing.nickname || failing.name} failed its last test.`,
    };
  }
  if (!accounts.length) {
    return {
      tone: "neutral",
      label: "Demo labels only",
      connected: false,
      detail: "Rackline Ground mints demo tracking. Connect a carrier to buy postage.",
    };
  }
  const services = hub.enabledServices.length;
  return {
    tone: "success",
    label: `${accounts.length} connected`,
    connected: true,
    detail: (
      <span>
        {accounts.map((row) => row.nickname || row.name).join(", ")}
        <span className="text-muted-foreground">
          {" "}
          · {services} {services === 1 ? "service" : "services"} on the ship screen
          {fallback ? ` · default ${fallback.nickname || fallback.name}` : ""}
        </span>
      </span>
    ),
  };
}

function defaultServiceState(hub: CarrierHub): Connection {
  const service = hub.enabledServices.find((row) => row.id === hub.defaultService?.serviceId);
  const change = (
    <Link to="/setup/warehouse" className="underline">
      Setup → Warehouse
    </Link>
  );
  return {
    tone: "neutral",
    label: "Ship queue",
    connected: true,
    detail: service ? (
      <span>
        Default service: {service.company} {service.service}. Change it in {change}.
      </span>
    ) : (
      <span>No default service yet. Set one in {change} or with Save as default on the ship queue.</span>
    ),
  };
}

function shipRulesState(payload: ShipRulesPayload): Connection {
  const on = payload.rules.filter((rule) => rule.enabled).sort((a, b) => a.position - b.position);
  const broken = payload.rules.find((rule) => rule.problem);
  if (!payload.rules.length) {
    return {
      tone: "neutral",
      label: "None yet",
      detail: "Every order ships in the default box with the default service.",
      connected: true,
    };
  }
  return {
    tone: broken ? "warning" : on.length ? "success" : "neutral",
    label: broken ? "Needs attention" : `${on.length} on`,
    connected: true,
    detail: broken ? (
      <span className="text-tone-warning">
        {broken.name}: {broken.problem}.
      </span>
    ) : on.length ? (
      <span>
        {on
          .slice(0, 3)
          .map((rule) => rule.name)
          .join(" → ")}
        {on.length > 3 ? <span className="text-muted-foreground"> · {on.length - 3} more</span> : null}
      </span>
    ) : (
      "All rules are off."
    ),
  };
}

function ediState(rows: EdiRow[] | undefined): Connection | null {
  if (!rows) return null;
  if (!rows.length) {
    return { tone: "neutral", label: "No documents", detail: "Post an 856 to start.", connected: false };
  }
  const failed = rows.filter((row) => row.status === "error" || row.status === "failed").length;
  const latest = Math.max(...rows.map((row) => row.createdAt));
  return {
    tone: failed ? "danger" : "success",
    label: failed ? `${failed} failed` : "Receiving",
    detail: `${rows.length} documents · last ${relativeTime(latest)}`,
    connected: true,
  };
}

function clientState(rows: ClientRow[]): Connection {
  if (!rows.length) {
    return { tone: "neutral", label: "None yet", detail: "Add a client to track stock you hold for them.", connected: false };
  }
  return {
    tone: "success",
    label: `${rows.length} ${rows.length === 1 ? "client" : "clients"}`,
    detail: rows
      .slice(0, 4)
      .map((row) => row.code)
      .join(", "),
    connected: true,
  };
}

function IntegrationCard({
  icon: Icon,
  name,
  summary,
  to,
  action,
  loading,
  error,
  state,
}: {
  icon: LucideIcon;
  name: string;
  /** A card subtitle; may hold a `<Term>`. */
  summary: ReactNode;
  to: string;
  action?: string;
  loading: boolean;
  error?: string;
  state: Connection | null;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-(--density-gap) shadow-xs">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{name}</p>
            {loading ? (
              <Skeleton className="h-5 w-24 rounded-full" />
            ) : state ? (
              <ToneBadge tone={state.tone}>{state.label}</ToneBadge>
            ) : error ? (
              <ToneBadge tone="danger">Could not load</ToneBadge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
      </div>
      <div className="min-h-5 text-sm">
        {loading ? (
          <Skeleton className="h-4 w-2/3" />
        ) : state ? (
          state.detail
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : null}
      </div>
      <div className="mt-auto flex justify-end border-t pt-3">
        <Button asChild size="sm" variant={state && !state.connected ? "primary" : "outline"}>
          <Link to={to}>{action ?? (state && !state.connected ? "Connect" : "Manage")}</Link>
        </Button>
      </div>
    </div>
  );
}
