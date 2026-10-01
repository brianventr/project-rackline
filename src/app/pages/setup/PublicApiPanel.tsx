import { useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "../../components/ui";
import { apiMutate, useApiQuery } from "../../query";
import { toastError } from "../../use-write";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  revokedAt: number | null;
};

type EndpointRow = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: number;
};

type DeliveryRow = {
  id: string;
  event: string;
  status: string;
  responseCode: number | null;
  error: string | null;
  createdAt: number;
  url: string;
};

const SCOPES = [
  ["orders:read", "Orders"],
  ["stock:read", "Stock"],
  ["shipments:read", "Shipments"],
] as const;

const EVENTS = [
  ["order.created", "Order created"],
  ["order.shipped", "Order shipped"],
  ["stock.changed", "Stock changed"],
] as const;

/** Keys (prefix only) and signed outbound endpoints. The secret is shown once, on create. */
export function PublicApiPanel() {
  const keys = useApiQuery<ApiKeyRow[]>("/api/integrations/keys");
  const endpoints = useApiQuery<EndpointRow[]>("/api/integrations/webhooks");
  const deliveries = useApiQuery<DeliveryRow[]>("/api/integrations/webhooks/deliveries");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["orders:read"]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["order.shipped"]);
  const [apiSecret, setApiSecret] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toastError(err, `${label} did not go through. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Public API and outbound webhooks</h2>
        <p className="text-xs text-muted-foreground">
          Read orders, stock, and shipments with a bearer key. Rackline signs order, ship, and stock events to an https URL.
        </p>
      </div>
      <div className="grid gap-(--density-gap) lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-medium">API keys</h3>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run("Create key", async () => {
                const created = await apiMutate<{ secret: string }>("/api/integrations/keys", {
                  body: JSON.stringify({ name, scopes }),
                });
                setApiSecret(created.secret);
                setName("");
                toast.success("API key created. Copy the secret now.");
              });
            }}
          >
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Key name" required />
            <Checks options={SCOPES} value={scopes} onChange={setScopes} />
            <Button type="submit" size="sm" disabled={busy || scopes.length === 0}>
              Create key
            </Button>
          </form>
          {apiSecret ? <SecretOnce label="API secret" value={apiSecret} /> : null}
          <RowList
            loading={keys.isLoading}
            error={keys.error?.message}
            empty="No keys yet."
            rows={(keys.data ?? []).map((key) => ({
              id: key.id,
              title: key.name,
              detail: `${key.prefix}… · ${key.scopes.join(", ") || "no scopes"}${key.revokedAt ? " · revoked" : ""}`,
              action: key.revokedAt
                ? null
                : {
                    label: "Revoke",
                    onSelect: () =>
                      void run("Revoke key", async () => {
                        await apiMutate(`/api/integrations/keys/${key.id}/revoke`);
                        if (apiSecret?.startsWith(key.prefix)) setApiSecret(null);
                        toast.success("API key revoked.");
                      }),
                  },
            }))}
          />
        </div>
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-medium">Outbound webhooks</h3>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run("Create endpoint", async () => {
                const created = await apiMutate<{ secret: string }>("/api/integrations/webhooks", {
                  body: JSON.stringify({ url, events }),
                });
                setWebhookSecret(created.secret);
                setUrl("");
                toast.success("Webhook endpoint created. Copy the signing secret now.");
              });
            }}
          >
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/rackline" required />
            <Checks options={EVENTS} value={events} onChange={setEvents} />
            <Button type="submit" size="sm" disabled={busy || events.length === 0}>
              Add endpoint
            </Button>
          </form>
          {webhookSecret ? <SecretOnce label="Signing secret" value={webhookSecret} /> : null}
          <RowList
            loading={endpoints.isLoading}
            error={endpoints.error?.message}
            empty="No endpoints yet."
            rows={(endpoints.data ?? []).map((endpoint) => ({
              id: endpoint.id,
              title: endpoint.url,
              detail: endpoint.events.join(", "),
              action: {
                label: "Remove",
                onSelect: () =>
                  void run("Remove endpoint", async () => {
                    await apiMutate(`/api/integrations/webhooks/${endpoint.id}`, { method: "DELETE" });
                    toast.success("Webhook endpoint removed.");
                  }),
              },
            }))}
          />
          <h3 className="text-sm font-medium">Recent deliveries</h3>
          <RowList
            loading={deliveries.isLoading}
            error={deliveries.error?.message}
            empty="No deliveries yet."
            rows={(deliveries.data ?? []).map((row) => ({
              id: row.id,
              title: `${row.event} · ${row.status}`,
              detail: [row.responseCode ? String(row.responseCode) : null, row.error, row.url].filter(Boolean).join(" · "),
              action:
                row.status === "failed"
                  ? {
                      label: "Send again",
                      onSelect: () =>
                        void run("Send again", async () => {
                          const result = await apiMutate<{ status: string; error?: string }>(
                            `/api/integrations/webhooks/deliveries/${row.id}/send`,
                          );
                          if (result.status === "failed") throw new Error(result.error || "Delivery failed");
                          toast.success("Webhook delivered.");
                        }),
                    }
                  : null,
            }))}
          />
        </div>
      </div>
    </section>
  );
}

function Checks({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [string, string])[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
      {options.map(([id, label]) => (
        <label key={id} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={value.includes(id)}
            onChange={(event) => onChange(event.target.checked ? [...value, id] : value.filter((item) => item !== id))}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function SecretOnce({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}. Shown once. Rackline does not store it in the clear.</p>
      <Input readOnly value={value} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
    </div>
  );
}

function RowList({
  rows,
  loading,
  error,
  empty,
}: {
  rows: { id: string; title: string; detail: string; action: { label: string; onSelect: () => void } | null }[];
  loading: boolean;
  error?: string;
  empty: string;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.title}</p>
            <p className="truncate text-xs text-muted-foreground">{row.detail}</p>
          </div>
          {row.action ? (
            <Button type="button" size="sm" variant="outline" onClick={row.action.onSelect}>
              {row.action.label}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
