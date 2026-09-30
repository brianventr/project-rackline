import { useState } from "react";
import { api } from "../../api";
import { Button, Card, ErrorBanner, PageHeader, StatusBadge } from "../../components/ui";
import { refreshApi, useApiQuery } from "../../query";
import { useWrite } from "../../use-write";
import { useWarehouse } from "../../warehouse";

type ChannelRow = {
  channel: string;
  connected: boolean;
  status: string;
  externalShop: string | null;
};

type ChannelsPayload = { channels: ChannelRow[] };

export function ChannelsPage() {
  const { warehouseId } = useWarehouse();
  const channels = useApiQuery<ChannelsPayload>("/api/channels");
  const write = useWrite();
  const [csvByChannel, setCsvByChannel] = useState<Record<string, string>>({});
  const [shopByChannel, setShopByChannel] = useState<Record<string, string>>({});
  const rows =
    channels.data?.channels ??
    ([
      { channel: "etsy", connected: false, status: "disconnected", externalShop: null },
      { channel: "faire", connected: false, status: "disconnected", externalShop: null },
    ] satisfies ChannelRow[]);

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Channels"
        description="Etsy and Faire CSV ingest beside Shopify. Paste an orders export; SKUs must already exist in the catalog."
      />
      {write.error ? <ErrorBanner error={write.error} /> : null}
      <div className="grid gap-(--density-gap) md:grid-cols-2">
        {rows.map((row) => (
          <Card key={row.channel} className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-medium capitalize tracking-tight">{row.channel}</h3>
              <StatusBadge status={row.connected ? row.status : "disconnected"} />
            </div>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Shop / brand name (optional)"
              value={shopByChannel[row.channel] ?? row.externalShop ?? ""}
              onChange={(e) => setShopByChannel((prev) => ({ ...prev, [row.channel]: e.target.value }))}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={write.busy}
              onClick={() =>
                void write.run(
                  "Save channel",
                  async () => {
                    await api(`/api/channels/${row.channel}`, {
                      method: "PUT",
                      body: JSON.stringify({ externalShop: shopByChannel[row.channel] ?? "" }),
                    });
                    await refreshApi("/api/channels");
                  },
                  "Channel saved",
                )
              }
            >
              Save connection
            </Button>
            <textarea
              className="min-h-28 w-full rounded-md border bg-background p-2 font-mono text-xs"
              placeholder={"Order ID,Buyer,SKU,Quantity\n1001,Ada,LAMP,1"}
              value={csvByChannel[row.channel] ?? ""}
              onChange={(e) => setCsvByChannel((prev) => ({ ...prev, [row.channel]: e.target.value }))}
            />
            <Button
              type="button"
              size="sm"
              disabled={write.busy || !(csvByChannel[row.channel] ?? "").trim()}
              onClick={() =>
                void write.run(
                  "Import channel orders",
                  async () => {
                    const result = await api<{ created: number }>(`/api/channels/${row.channel}/import`, {
                      method: "POST",
                      body: JSON.stringify({ csv: csvByChannel[row.channel], warehouseId }),
                    });
                    setCsvByChannel((prev) => ({ ...prev, [row.channel]: "" }));
                    await refreshApi("/api/channels");
                    return result;
                  },
                  (r) => `Imported ${r.created} orders`,
                )
              }
            >
              Import CSV orders
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
