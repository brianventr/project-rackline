import { useEffect, useState } from "react";
import { api, type Client } from "../../api";
import { RATE_KINDS, RATE_LABELS, type RateKind } from "@/domain/billing";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Table, onSubmit } from "../../components/ui";

const emptyRates = (): Record<RateKind, string> => ({
  receive: "",
  storage: "",
  pick: "",
  carton: "",
  kit: "",
  work_order: "",
  rma: "",
});

function ratesFrom(client: Client): Record<RateKind, string> {
  const next = emptyRates();
  for (const kind of RATE_KINDS) {
    const value = client.rates?.[kind];
    if (value !== undefined) next[kind] = String(value);
  }
  return next;
}

function ratesPayload(rates: Record<RateKind, string>): Record<string, number | null> {
  const payload: Record<string, number | null> = {};
  for (const kind of RATE_KINDS) {
    const raw = rates[kind].trim();
    payload[kind] = raw === "" ? null : Number(raw);
  }
  return payload;
}

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRates, setEditRates] = useState(emptyRates);
  const [portalName, setPortalName] = useState("");
  const [portalEmail, setPortalEmail] = useState("");
  const [portalPassword, setPortalPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setClients(await api<Client[]>("/api/clients"));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api<Client>("/api/clients", {
        method: "POST",
        body: JSON.stringify({ code, name, billingEmail: billingEmail || null }),
      });
      setCode("");
      setName("");
      setBillingEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create client");
    }
  }

  async function save(id: string) {
    setError(null);
    try {
      await api<Client>(`/api/clients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          code: editCode,
          name: editName,
          billingEmail: editEmail || null,
          rates: ratesPayload(editRates),
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update client");
    }
  }

  async function createPortal(id: string) {
    setError(null);
    try {
      await api(`/api/clients/${id}/portal`, {
        method: "POST",
        body: JSON.stringify({ name: portalName, email: portalEmail, password: portalPassword }),
      });
      setPortalName("");
      setPortalEmail("");
      setPortalPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create portal login");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/api/clients/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete client");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Clients"
        description="Rate card and billing email for each brand. A blank rate is not billed."
      />
      <ErrorBanner error={error} />
      <Card className="mb-3">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(create)}>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="ACME" />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Acme Corp" />
          </Field>
          <Field label="Billing email">
            <Input value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="ap@acme.example" />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Add client</Button>
          </div>
        </form>
      </Card>
      <Table columns={["Code", "Name", "Billing email", "Rates", ""]}>
        {clients.map((client) => (
          <tr key={client.id}>
            <td className="px-2.5 py-1.5 font-mono">{client.code}</td>
            <td className="px-2.5 py-1.5">{client.name}</td>
            <td className="px-2.5 py-1.5">{client.billingEmail || "—"}</td>
            <td className="px-2.5 py-1.5 text-xs text-muted-foreground">
              {RATE_KINDS.filter((kind) => client.rates?.[kind] !== undefined)
                .map((kind) => `${kind} ${client.rates?.[kind]}¢`)
                .join(" · ") || "—"}
            </td>
            <td className="px-2.5 py-1.5">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingId(client.id);
                    setEditCode(client.code);
                    setEditName(client.name);
                    setEditEmail(client.billingEmail ?? "");
                    setEditRates(ratesFrom(client));
                  }}
                >
                  Edit
                </Button>
                <Button variant="ghost" onClick={() => void remove(client.id)}>
                  Delete
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </Table>
      {editingId ? (
        <Card className="mt-3 space-y-4">
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={onSubmit(() => save(editingId))}
          >
            <Field label="Code">
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} required />
            </Field>
            <Field label="Name">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </Field>
            <Field label="Billing email">
              <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
            </Field>
            {RATE_KINDS.map((kind) => (
              <Field key={kind} label={`${RATE_LABELS[kind]} (¢)`}>
                <Input
                  inputMode="numeric"
                  value={editRates[kind]}
                  onChange={(e) => setEditRates((current) => ({ ...current, [kind]: e.target.value }))}
                  placeholder="blank = not billed"
                />
              </Field>
            ))}
            <div className="flex items-end gap-2">
              <Button type="submit">Save rates</Button>
              <Button variant="ghost" type="button" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          </form>
          <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(() => createPortal(editingId))}>
            <Field label="Portal name">
              <Input value={portalName} onChange={(e) => setPortalName(e.target.value)} required />
            </Field>
            <Field label="Portal email">
              <Input value={portalEmail} onChange={(e) => setPortalEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <Input type="password" value={portalPassword} onChange={(e) => setPortalPassword(e.target.value)} required />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Create portal login
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
