import { useEffect, useState } from "react";
import { api, type Client } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Table, onSubmit } from "../../components/ui";

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
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
        body: JSON.stringify({ code, name }),
      });
      setCode("");
      setName("");
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
        body: JSON.stringify({ code: editCode, name: editName }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update client");
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
        description="3PL / multi-client codes for waves, ASNs, and orders."
      />
      <ErrorBanner error={error} />
      <Card className="mb-3">
        <form className="grid gap-3 md:grid-cols-3" onSubmit={onSubmit(create)}>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="ACME" />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Acme Corp" />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Add client</Button>
          </div>
        </form>
      </Card>
      <Table columns={["Code", "Name", ""]}>
        {clients.map((client) => (
          <tr key={client.id}>
            <td className="px-2.5 py-1.5 font-mono">
              {editingId === client.id ? (
                <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
              ) : (
                client.code
              )}
            </td>
            <td className="px-2.5 py-1.5">
              {editingId === client.id ? (
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              ) : (
                client.name
              )}
            </td>
            <td className="px-2.5 py-1.5">
              <div className="flex gap-2">
                {editingId === client.id ? (
                  <>
                    <Button onClick={() => void save(client.id)}>Save</Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingId(client.id);
                        setEditCode(client.code);
                        setEditName(client.name);
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(client.id)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
