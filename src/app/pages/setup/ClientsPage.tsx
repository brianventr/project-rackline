import { useEffect, useMemo, useState } from "react";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type Client } from "../../api";
import { Button, EmptyState, PageHeader } from "../../components/ui";
import { DataTable, type DataColumn } from "../../components/data-table/DataTable";
import { RelativeTime } from "../../components/cells";
import { ActionMenu } from "../../components/document";
import { FormSheet } from "../../components/form-sheet";
import { TextField, useZodForm, type ZodFormOutput } from "../../components/form-kit";
import { Term } from "../../components/term";
import { apiMutate, useApiQuery } from "../../query";
import { useWrite } from "../../use-write";
import { clientFormSchema } from "@/domain/form-schemas";

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
      <PageHeader
        eyebrow="Setup"
        title="Clients"
        description={
          <>
            <Term id="3pl-client">3PL</Term> / multi-client codes for waves, <Term id="asn">ASNs</Term>, and orders.
          </>
        }
      />
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
  const form = useZodForm(clientFormSchema, { code: "", name: "" });
  const write = useWrite();

  // A new client starts blank; an edit loads the client's code and name.
  const { reset } = form;
  useEffect(() => {
    if (!state) return;
    reset({ code: editing?.code ?? "", name: editing?.name ?? "" });
    write.setError(null);
  }, [state]);

  async function submit(values: ZodFormOutput<typeof clientFormSchema>) {
    const saved = await write.run(
      editing ? "Save client" : "Add client",
      () =>
        api<Client>(editing ? `/api/clients/${editing.id}` : "/api/clients", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify({ code: values.code, name: values.name }),
        }),
      (row) => `Client ${row?.code ?? values.code.toUpperCase()} ${editing ? "saved" : "added"}.`,
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
      onSubmit={form.handleSubmit(submit)}
      busy={write.busy}
      error={write.error}
    >
      <TextField form={form} name="code" label="Code" placeholder="ACME" autoFocus />
      <TextField form={form} name="name" label="Name" placeholder="Acme Corp" />
    </FormSheet>
  );
}
