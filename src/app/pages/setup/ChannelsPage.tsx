import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, type ChannelStatus, type ChannelsPayload } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, ToneBadge } from "../../components/ui";
import { refreshApi, useApiQuery } from "../../query";
import { useSession } from "../../session";
import { useWrite } from "../../use-write";
import { useWarehouse } from "../../warehouse";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/domain/relative-time";
import { channelHealthBadge } from "./channel-health";

const ETSY_ERRORS: Record<string, string> = {
  missing_app: "Etsy is not configured on this deployment.",
  denied: "Etsy access was declined.",
  expired: "The Etsy sign-in took too long. Try again.",
  state: "The Etsy sign-in could not be matched to this account. Try again.",
  token: "Etsy did not issue a token. Try again.",
};

type SyncResult = { created: number; existing: number; skipped: number };

function syncMessage(name: string, r: SyncResult): string {
  if (r.created === 0) return `${name} is up to date`;
  return `${r.created} new ${name} ${r.created === 1 ? "order" : "orders"} on the ship queue`;
}

export function ChannelsPage() {
  const me = useSession();
  const owner = me.role === "owner";
  const channels = useApiQuery<ChannelsPayload>("/api/channels");
  const write = useWrite();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const etsy = params.get("etsy");
    if (!etsy) return;
    if (etsy === "connected") toast.success("Etsy connected. Paid receipts will land on the ship queue.");
    else toast.error(ETSY_ERRORS[params.get("reason") ?? ""] ?? "Etsy did not connect.");
    params.delete("etsy");
    params.delete("reason");
    setParams(params, { replace: true });
    void refreshApi("/api/channels");
  }, [params, setParams]);

  const rows = (channels.data?.channels ?? []).filter((row) => row.id !== "shopify");
  const garage = (channels.data?.operatingMode ?? me.organization.operatingMode) === "garage";

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Sales channels"
        description={
          garage
            ? "Connect the storefronts you sell on. Paid orders land on the ship queue, and tracking goes back to the buyer when you ship."
            : "Storefront and wholesale order sources. Orders land as pick tickets for the next wave; tracking posts back on ship."
        }
      />
      {write.error ? <ErrorBanner error={write.error} /> : null}
      <p className="text-sm text-muted-foreground">
        Shopify has its own setup with sellable-quantity sync.{" "}
        <Link className="underline" to="/setup/shopify">
          Manage Shopify
        </Link>
      </p>
      <div className="grid gap-(--density-gap) lg:grid-cols-2">
        {channels.isLoading
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-lg" />)
          : rows.map((row) => <ChannelCard key={row.id} row={row} owner={owner} write={write} />)}
      </div>
    </div>
  );
}

function ChannelCard({
  row,
  owner,
  write,
}: {
  row: ChannelStatus;
  owner: boolean;
  write: ReturnType<typeof useWrite>;
}) {
  const badge = channelHealthBadge(row);
  const connected = row.health !== "disconnected";
  const live = row.mode === "live" && connected;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-medium">{row.name}</h3>
          <p className="text-sm text-muted-foreground">{row.blurb}</p>
        </div>
        <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
      </div>

      {connected ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {row.externalShop ? (
            <>
              <dt className="text-muted-foreground">Shop</dt>
              <dd className="truncate font-mono text-xs leading-5">{row.externalShop}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Open orders</dt>
          <dd>{row.openOrders}</dd>
          {row.liveOrders && live ? (
            <>
              <dt className="text-muted-foreground">Last pull</dt>
              <dd>{row.lastSyncAt ? relativeTime(row.lastSyncAt) : "Not yet"}</dd>
            </>
          ) : null}
          {row.failedPostBacks ? (
            <>
              <dt className="text-muted-foreground">Tracking</dt>
              <dd className="text-destructive">
                {row.failedPostBacks} shipped {row.failedPostBacks === 1 ? "order" : "orders"} did not post back
              </dd>
            </>
          ) : row.health === "csv" ? (
            <>
              <dt className="text-muted-foreground">Tracking</dt>
              <dd>Not posted back by CSV. Mark orders shipped in {row.name}.</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {row.lastSyncError ? <p className="text-sm text-destructive">{row.lastSyncError}</p> : null}
      {row.webhookUrl ? (
        <Field label="Webhook URL (order.updated)">
          <Input readOnly value={row.webhookUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        </Field>
      ) : null}

      {owner ? (
        <>
          {row.id === "woocommerce" && !live ? <WooConnectForm write={write} /> : null}
          {row.id === "etsy" && !live ? <EtsyConnect row={row} write={write} /> : null}
          {row.csvImport ? <CsvImport row={row} write={write} /> : null}
          <div className="mt-auto flex flex-wrap justify-end gap-2 border-t pt-3">
            {live && row.liveOrders ? (
              <Button
                size="sm"
                variant="outline"
                disabled={write.busy}
                onClick={() =>
                  void write.run(
                    `Sync ${row.name}`,
                    () => api<SyncResult>(`/api/channels/${row.id}/sync`, { method: "POST" }),
                    (r) => syncMessage(row.name, r),
                  )
                }
              >
                Pull orders now
              </Button>
            ) : null}
            {row.liveOrders && !live ? (
              <Button
                size="sm"
                variant="outline"
                disabled={write.busy}
                onClick={() =>
                  void write.run(
                    `Sample ${row.name} order`,
                    () => api<SyncResult>(`/api/channels/${row.id}/demo`, { method: "POST" }),
                    (r) => (r.created ? `Sample ${row.name} order is on the ship queue` : "Sample order already exists"),
                  )
                }
              >
                Send a sample order
              </Button>
            ) : null}
            {connected ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={write.busy}
                onClick={() =>
                  void write.run(
                    `Disconnect ${row.name}`,
                    () => api(`/api/channels/${row.id}`, { method: "DELETE" }),
                    `${row.name} disconnected`,
                  )
                }
              >
                Disconnect
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </Card>
  );
}

function WooConnectForm({ write }: { write: ReturnType<typeof useWrite> }) {
  const { warehouseId } = useWarehouse();
  const [storeUrl, setStoreUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void write.run(
          "Connect WooCommerce",
          () =>
            api<{ webhookCreated: boolean; sync: SyncResult | null }>("/api/channels/woocommerce/connect", {
              method: "POST",
              body: JSON.stringify({ storeUrl, consumerKey, consumerSecret, warehouseId }),
            }),
          (r) =>
            r.webhookCreated
              ? `WooCommerce connected${r.sync?.created ? ` · ${r.sync.created} open orders pulled` : ""}`
              : "WooCommerce connected. Add the webhook URL in WooCommerce → Settings → Advanced → Webhooks.",
        );
      }}
    >
      <Field label="Store URL">
        <Input placeholder="https://shop.example.com" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Consumer key">
          <Input placeholder="ck_…" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} />
        </Field>
        <Field label="Consumer secret">
          <Input type="password" placeholder="cs_…" value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Create a Read/Write key under WooCommerce → Settings → Advanced → REST API. Keys are encrypted at rest.
      </p>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={write.busy || !storeUrl.trim() || !consumerKey.trim() || !consumerSecret.trim()}>
          Connect store
        </Button>
      </div>
    </form>
  );
}

function EtsyConnect({ row, write }: { row: ChannelStatus; write: ReturnType<typeof useWrite> }) {
  if (!row.configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Live Etsy needs an Etsy app key on this deployment (<span className="font-mono text-xs">ETSY_API_KEY</span>).
        Until then, paste a receipts export below.
      </p>
    );
  }
  return (
    <div className="flex justify-end">
      <Button
        size="sm"
        disabled={write.busy}
        onClick={() =>
          void write.run("Connect Etsy", async () => {
            const { url } = await api<{ url: string }>("/api/channels/etsy/connect", { method: "POST" });
            window.location.assign(url);
          })
        }
      >
        Connect Etsy shop
      </Button>
    </div>
  );
}

function CsvImport({ row, write }: { row: ChannelStatus; write: ReturnType<typeof useWrite> }) {
  const { warehouseId } = useWarehouse();
  const [csv, setCsv] = useState("");
  return (
    <details className="rounded-md border px-3 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Import a {row.name} CSV export</summary>
      <div className="mt-2 grid gap-2">
        <textarea
          className="min-h-24 w-full rounded-md border bg-background p-2 font-mono text-xs"
          placeholder={"Order ID,Buyer,SKU,Quantity\n1001,Ada,LAMP,1"}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">SKUs must already exist. Orders already imported are skipped.</p>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={write.busy || !csv.trim()}
            onClick={() =>
              void write.run(
                `Import ${row.name} orders`,
                async () => {
                  const result = await api<{ created: number; duplicates: number }>(`/api/channels/${row.id}/import`, {
                    method: "POST",
                    body: JSON.stringify({ csv, warehouseId }),
                  });
                  setCsv("");
                  return result;
                },
                (r) => `Imported ${r.created} ${r.created === 1 ? "order" : "orders"}${r.duplicates ? ` · ${r.duplicates} already here` : ""}`,
              )
            }
          >
            Import CSV
          </Button>
        </div>
      </div>
    </details>
  );
}
