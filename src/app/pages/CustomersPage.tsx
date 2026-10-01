import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ClipboardList, Contact, Pencil, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { errorText, type Customer, type CustomerDetail } from "../api";
import { Button, EmptyState, ErrorBanner, PageHeader, StatusBadge, Table } from "../components/ui";
import { DetailSkeleton, DocumentFact, DocumentFrame, DocumentHeader, DocumentRail } from "../components/document";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, RelativeTime } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { TextField, TextareaField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { apiMutate, useApiQuery } from "../query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { customerFormSchema } from "@/domain/form-schemas";
import { RailCard } from "./ReceiptsPage";

export function CustomersPage() {
  const { id } = useParams();
  if (id) return <CustomerView id={id} />;
  return <CustomerList />;
}

const CUSTOMER_TABS: TabDef<Customer>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "open", label: "Open orders", match: (customer) => (customer.openOrderCount ?? 0) > 0 },
  { id: "repeat", label: "Repeat", match: (customer) => (customer.orderCount ?? 0) > 1 },
];

function firstLine(address: string | null | undefined): string | null {
  return address?.split("\n").find((line) => line.trim())?.trim() ?? null;
}

const CUSTOMER_COLUMNS: DataColumn<Customer>[] = [
  {
    id: "name",
    header: "Customer",
    sortValue: (customer) => customer.name,
    cell: (customer) => (
      <span className="flex flex-col">
        <DocLink to={`/outbound/customers/${customer.id}`}>{customer.name}</DocLink>
        {customer.email ? <span className="font-mono text-xs text-muted-foreground">{customer.email}</span> : null}
      </span>
    ),
  },
  {
    id: "shipTo",
    header: "Ship to",
    csv: (customer) => customer.shipToAddress ?? "",
    cell: (customer) => firstLine(customer.shipToAddress) ?? <Muted>—</Muted>,
  },
  {
    id: "orders",
    header: "Orders",
    sortValue: (customer) => customer.orderCount ?? 0,
    csv: (customer) => String(customer.orderCount ?? 0),
    cell: (customer) => (
      <span className="font-mono tabular-nums">
        {customer.orderCount ?? 0}
        {customer.openOrderCount ? <span className="text-muted-foreground"> · {customer.openOrderCount} open</span> : null}
      </span>
    ),
  },
  {
    id: "returns",
    header: "Returns",
    sortValue: (customer) => customer.returnCount ?? 0,
    csv: (customer) => String(customer.returnCount ?? 0),
    cell: (customer) => <span className="font-mono tabular-nums">{customer.returnCount ?? 0}</span>,
  },
  {
    id: "channels",
    header: "Channels",
    csv: (customer) => customer.channelRefs.map((ref) => ref.channel).join(" "),
    cell: (customer) =>
      customer.channelRefs.length ? [...new Set(customer.channelRefs.map((ref) => ref.channel))].join(", ") : <Muted>—</Muted>,
  },
  {
    id: "last",
    header: "Last order",
    sortValue: (customer) => customer.lastOrderAt ?? null,
    csv: (customer) => (customer.lastOrderAt ? new Date(customer.lastOrderAt).toISOString() : ""),
    cell: (customer) => <RelativeTime at={customer.lastOrderAt} />,
  },
];

function CustomerList() {
  const customers = useApiQuery<Customer[]>("/api/customers");
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Outbound"
        title="Customers"
        description="Everyone you ship to. Channel and CSV orders join a customer by email, or by name and ship-to when there is no email."
      />
      <DataTable
        id="customers"
        data={customers.data ?? []}
        loading={customers.isLoading}
        error={customers.error?.message}
        columns={CUSTOMER_COLUMNS}
        getRowId={(customer) => customer.id}
        rowHref={(customer) => `/outbound/customers/${customer.id}`}
        tabs={CUSTOMER_TABS}
        defaultTab="all"
        defaultSort={{ id: "last", desc: true }}
        search={{
          placeholder: "Search name, email, address",
          text: (customer) => [customer.name, customer.email, customer.phone, customer.shipToAddress].filter(Boolean).join(" "),
        }}
        exportName="customers"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New customer
          </Button>
        }
        empty={
          <EmptyState
            icon={Contact}
            title="No customers yet."
            body="Each order adds or joins a customer, so this fills in as orders arrive."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New customer
              </Button>
            }
          />
        }
      />
      <CustomerSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function customerDefaults(customer?: Customer | null) {
  return {
    name: customer?.name ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    shipToAddress: customer?.shipToAddress ?? "",
    notes: customer?.notes ?? "",
  };
}

function CustomerSheet({
  open,
  onOpenChange,
  customer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | null;
  onSaved?: (customer: Customer) => void;
}) {
  const navigate = useNavigate();
  const form = useZodForm(customerFormSchema, customerDefaults(customer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reset } = form;
  useEffect(() => {
    if (open) reset(customerDefaults(customer));
  }, [open, customer, reset]);

  async function save(values: ZodFormOutput<typeof customerFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      const saved = await apiMutate<Customer>(customer ? `/api/customers/${customer.id}` : "/api/customers", {
        method: customer ? "PATCH" : "POST",
        body: JSON.stringify(values),
        refresh: "/api/customers",
      });
      toast.success(customer ? `${saved.name} saved.` : `${saved.name} added.`);
      onOpenChange(false);
      if (onSaved) onSaved(saved);
      else navigate(`/outbound/customers/${saved.id}`);
    } catch (err) {
      setError(errorText(err, "Could not save the customer."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={customer ? `Edit ${customer.name}` : "New customer"}
      description="New orders for this customer start from this ship-to. Existing orders keep theirs."
      submitLabel={customer ? "Save customer" : "Add customer"}
      onSubmit={form.handleSubmit(save)}
      busy={busy}
      error={error}
    >
      <TextField form={form} name="name" label="Name" placeholder="Rosa Diaz" autoFocus />
      <TextField form={form} name="email" label="Email" type="email" placeholder="rosa@example.com" />
      <TextField form={form} name="phone" label="Phone" />
      <TextareaField form={form} name="shipToAddress" label="Default ship-to" rows={3} placeholder={"14 Dock Street\nPortland, OR 97201"} />
      <TextareaField form={form} name="notes" label="Notes" rows={2} />
    </FormSheet>
  );
}

function CustomerView({ id }: { id: string }) {
  const detail = useApiQuery<CustomerDetail>(`/api/customers/${id}`);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState("orders");
  if (!detail.data) return detail.error ? <ErrorBanner error={detail.error.message} /> : <DetailSkeleton />;
  const { customer, orders, returns } = detail.data;
  const openOrders = orders.filter((row) => row.open).length;

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Outbound"
        list={{ label: "Customers", to: "/outbound/customers" }}
        title={customer.name}
        description={[customer.email, firstLine(customer.shipToAddress)].filter(Boolean).join(" · ")}
        primary={{ label: "Edit customer", icon: Pencil, onSelect: () => setEditing(true) }}
      />
      <DocumentFrame
        rail={
          <DocumentRail>
            <RailCard>
              <DocumentFact label="Email">
                {customer.email ? <a className="underline" href={`mailto:${customer.email}`}>{customer.email}</a> : <Muted>—</Muted>}
              </DocumentFact>
              <DocumentFact label="Phone">{customer.phone ?? <Muted>—</Muted>}</DocumentFact>
              <DocumentFact label="Orders">{orders.length}</DocumentFact>
              <DocumentFact label="Open">{openOrders}</DocumentFact>
              <DocumentFact label="Returns">{returns.length}</DocumentFact>
              {customer.channelRefs.length ? (
                <DocumentFact label="Channel ids">
                  <span className="flex flex-col items-end font-mono text-xs">
                    {customer.channelRefs.map((ref) => (
                      <span key={`${ref.channel}:${ref.ref}`}>
                        {ref.channel} {ref.ref}
                      </span>
                    ))}
                  </span>
                </DocumentFact>
              ) : null}
            </RailCard>
            {customer.shipToAddress || customer.notes ? (
              <RailCard title="Default ship-to">
                {customer.shipToAddress ? <p className="whitespace-pre-line text-sm">{customer.shipToAddress}</p> : null}
                {customer.notes ? <p className="text-xs text-muted-foreground">{customer.notes}</p> : null}
              </RailCard>
            ) : null}
          </DocumentRail>
        }
      >
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="orders">Orders ({orders.length})</TabsTrigger>
            <TabsTrigger value="returns">Returns ({returns.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="orders">
            {orders.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No orders yet." body="Orders for this customer show here." />
            ) : (
              <Table columns={["Order", "Lines", "Source", "Created", "Status"]}>
                {orders.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <DocLink to={`/outbound/orders/${row.id}`}>{row.number}</DocLink>
                    </td>
                    <td>
                      <LineChips lines={row.lines} />
                    </td>
                    <td className="text-xs text-muted-foreground">{row.source ?? "manual"}</td>
                    <td>
                      <RelativeTime at={row.createdAt} />
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </TabsContent>
          <TabsContent value="returns">
            {returns.length === 0 ? (
              <EmptyState icon={Undo2} title="No returns." body="Returns from this customer show here." />
            ) : (
              <Table columns={["Return", "Created", "Status"]}>
                {returns.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <DocLink to={`/outbound/returns/${row.id}`}>{row.number}</DocLink>
                    </td>
                    <td>
                      <RelativeTime at={row.createdAt} />
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </DocumentFrame>
      <CustomerSheet open={editing} onOpenChange={setEditing} customer={customer} onSaved={() => void detail.refetch()} />
    </div>
  );
}
