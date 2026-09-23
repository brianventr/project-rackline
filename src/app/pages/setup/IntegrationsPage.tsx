import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Store, Truck, type LucideIcon } from "lucide-react";
import type { CarrierHub, ShopifyConnection } from "../../api";
import { Button, PageHeader, StatusBadge, ToneBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { useApiQuery } from "../../query";
import { useWarehouse } from "../../warehouse";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusTone } from "@/domain/status";

type Connection = {
  tone: StatusTone;
  label: string;
  detail: ReactNode;
  connected: boolean;
};

export function IntegrationsPage() {
  const { warehouseId } = useWarehouse();
  // Same endpoints the Shopify and Carriers pages read.
  const shopify = useApiQuery<ShopifyConnection>("/api/shopify/connection");
  const carriers = useApiQuery<CarrierHub>(`/api/carriers?warehouseId=${encodeURIComponent(warehouseId)}`);

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Integrations"
        description="Connect checkout and shipping so customer orders, fulfillments, and labels stay in one workflow."
      />
      <div className="grid gap-(--density-gap) md:grid-cols-2">
        <IntegrationCard
          icon={Store}
          name="Shopify"
          summary={
            <>
              Checkout → pick ticket. <Term id="sellable">Sellable qty</Term> and fulfillment post back.
            </>
          }
          to="/setup/shopify"
          loading={shopify.isLoading}
          error={shopify.error?.message}
          state={shopify.data ? shopifyState(shopify.data) : null}
        />
        <IntegrationCard
          icon={Truck}
          name="Carriers"
          summary="UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine."
          to="/setup/carriers"
          loading={carriers.isLoading}
          error={carriers.error?.message}
          state={carriers.data ? carrierState(carriers.data) : null}
        />
      </div>
    </div>
  );
}

function shopifyState(row: ShopifyConnection): Connection {
  if (!row.connected) {
    return {
      tone: "neutral",
      label: "Not connected",
      detail: "Orders only come from the floor until a shop is connected.",
      connected: false,
    };
  }
  return {
    tone: "success",
    label: "Connected",
    connected: true,
    detail: (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{row.shopDomain}</span>
        <StatusBadge status={row.mode} />
      </span>
    ),
  };
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

function IntegrationCard({
  icon: Icon,
  name,
  summary,
  to,
  loading,
  error,
  state,
}: {
  icon: LucideIcon;
  name: string;
  /** A card subtitle; may hold a `<Term>`. */
  summary: ReactNode;
  to: string;
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
          <Link to={to}>{state && !state.connected ? "Connect" : "Manage"}</Link>
        </Button>
      </div>
    </div>
  );
}
