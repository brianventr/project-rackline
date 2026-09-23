import { useEffect, useMemo, useState } from "react";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type Client } from "../../api";
import { Button, EmptyState, Field, Input, PageHeader } from "../../components/ui";
import { DataTable, type DataColumn } from "../../components/data-table/DataTable";
import { RelativeTime } from "../../components/cells";
import { ActionMenu } from "../../components/document";
import { FormSheet } from "../../components/form-sheet";
import { apiMutate, useApiQuery } from "../../query";
import { useWrite } from "../../use-write";

const CLIENT_COLUMNS: DataColumn<Client>[] = [
  {
    id: "code",
    header: "Code",
    sortValue: (client) => client.code,
    cell: (client) => <span className="font-mono font-medium">{client.code}</span>,
  },
  {
    id: "name",
    header: "Name",
    sortValue: (client) => client.name,
    cell: (client) => client.name,
  },
  {
    id: "created",
    header: "Added",
    sortValue: (client) => client.createdAt,
    csv: (client) => new Date(client.createdAt).toISOString(),
    cell: (client) => <RelativeTime at={client.createdAt} />,
  },
];

type SheetState = { mode: "new" } | { mode: "edit"; client: Client } | null;

export function ClientsPage() {
  const clients = useApiQuery<Client[]>("/api/clients");
  const [sheet, setSheet] = useState<SheetState>(null);

  const columns = useMemo<DataColumn<Client>[]>(
    () => [
      ...CLIENT_COLUMNS,
      {
        id: "actions",
        header: "",
        hideable: false,
        align: "right",
        className: "w-px",
        cell: (client) => (
          <ActionMenu
            label={`${client.code} actions`}
            actions={[
              { label: "Edit", icon: Pencil, onSelect: () => setSheet({ mode: "edit", client }) },
              {
                label: "Delete client",
                icon: Trash2,
                tone: "danger",
                onSelect: () => apiMutate(`/api/clients/${client.id}`, { method: "DELETE" }),
                success: `Client ${client.code} deleted.`,
                confirm: {
                  title: `Delete client ${client.code}?`,
                  body: "Its per-client stock balances are deleted. Waves, ASNs, and invoices keep their history without the client code. This cannot be undone.",
                  confirmLabel: "Delete client",
                  cancelLabel: "Keep client",
                  tone: "danger",
                },
              },
            ]}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader eyebrow="Setup" title="Clients" description="3PL / multi-client codes for waves, ASNs, and orders." />
      <DataTable
        id="clients"
        data={clients.data}
        loading={clients.isLoading}
        error={clients.error?.message}
        columns={columns}
        getRowId={(client) => client.id}
        defaultSort={{ id: "code", desc: false }}
        search={{ placeholder: "Search code or name", text: (client) => `${client.code} ${client.name}` }}
        toolbar={
          <Button size="sm" onClick={() => setSheet({ mode: "new" })}>
            <Plus className="size-4" />
            New client
          </Button>
        }
        empty={
          <EmptyState
            icon={Building2}
            title="No clients yet."
            body="Add a code for each 3PL customer so waves, ASNs, and invoices can be tagged to them."
            action={
              <Button size="sm" onClick={() => setSheet({ mode: "new" })}>
                New client
              </Button>
            }
          />
        }
      />
      <ClientSheet state={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

function ClientSheet({ state, onClose }: { state: SheetState; onClose: () => void }) {
  const editing = state?.mode === "edit" ? state.client : null;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const write = useWrite();

  useEffect(() => {
    if (!state) return;
    setCode(editing?.code ?? "");
    setName(editing?.name ?? "");
    write.setError(null);
  }, [state]);

  async function submit() {
    const saved = await write.run(
      editing ? "Save client" : "Add client",
      () =>
        api<Client>(editing ? `/api/clients/${editing.id}` : "/api/clients", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify({ code, name }),
        }),
      (row) => `Client ${row?.code ?? code.toUpperCase()} ${editing ? "saved" : "added"}.`,
    );
    if (saved) onClose();
  }

  return (
    <FormSheet
      open={!!state}
      onOpenChange={(open) => (open ? null : onClose())}
      title={editing ? `Edit ${editing.code}` : "New client"}
      description="The code prints on waves, ASNs, and invoices. Keep it short."
      submitLabel={editing ? "Save client" : "Add client"}
      onSubmit={submit}
      busy={write.busy}
      error={write.error}
    >
      <Field label="Code">
        <Input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="ACME" autoFocus />
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Acme Corp" />
      </Field>
    </FormSheet>
  );
}
