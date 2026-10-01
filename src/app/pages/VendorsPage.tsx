import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Factory, Pencil, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { errorText, type Vendor, type VendorDetail } from "../api";
import { Button, EmptyState, ErrorBanner, PageHeader, StatusBadge, Table } from "../components/ui";
import { DetailSkeleton, DocumentFact, DocumentFrame, DocumentHeader, DocumentRail } from "../components/document";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, Muted, ProgressCell, RelativeTime, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { TextField, TextareaField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { apiMutate, useApiQuery } from "../query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { vendorFormSchema } from "@/domain/form-schemas";
import { formatMoney } from "@/domain/parties";
import { RailCard } from "./ReceiptsPage";

export function VendorsPage() {
  const { id } = useParams();
  if (id) return <VendorView id={id} />;
  return <VendorList />;
}

const VENDOR_TABS: TabDef<Vendor>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "open", label: "Open POs", match: (vendor) => (vendor.openPurchaseCount ?? 0) > 0 },
];

const VENDOR_COLUMNS: DataColumn<Vendor>[] = [
  {
    id: "name",
    header: "Vendor",
    sortValue: (vendor) => vendor.name,
    cell: (vendor) => (
      <span className="flex flex-col">
        <DocLink to={`/inbound/vendors/${vendor.id}`}>{vendor.name}</DocLink>
        {vendor.contactName ? <span className="text-xs text-muted-foreground">{vendor.contactName}</span> : null}
      </span>
    ),
  },
  {
    id: "email",
    header: "Email",
    csv: (vendor) => vendor.email ?? "",
    cell: (vendor) => (vendor.email ? <span className="font-mono text-xs">{vendor.email}</span> : <Muted>—</Muted>),
  },
  {
    id: "terms",
    header: "Terms",
    csv: (vendor) => vendor.paymentTerms ?? "",
    cell: (vendor) => vendor.paymentTerms ?? <Muted>—</Muted>,
  },
  {
    id: "lead",
    header: "Lead time",
    sortValue: (vendor) => vendor.leadTimeDays ?? null,
    csv: (vendor) => (vendor.leadTimeDays == null ? "" : String(vendor.leadTimeDays)),
    cell: (vendor) => (vendor.leadTimeDays == null ? <Muted>—</Muted> : `${vendor.leadTimeDays} days`),
  },
  {
    id: "purchases",
    header: "Purchases",
    sortValue: (vendor) => vendor.purchaseCount ?? 0,
    csv: (vendor) => String(vendor.purchaseCount ?? 0),
    cell: (vendor) => (
      <span className="font-mono tabular-nums">
        {vendor.purchaseCount ?? 0}
        {vendor.openPurchaseCount ? <span className="text-muted-foreground"> · {vendor.openPurchaseCount} open</span> : null}
      </span>
    ),
  },
  {
    id: "last",
    header: "Last PO",
    sortValue: (vendor) => vendor.lastPurchaseAt ?? null,
    csv: (vendor) => (vendor.lastPurchaseAt ? new Date(vendor.lastPurchaseAt).toISOString() : ""),
    cell: (vendor) => <RelativeTime at={vendor.lastPurchaseAt} />,
  },
];

function VendorList() {
  const vendors = useApiQuery<Vendor[]>("/api/vendors");
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Inbound"
        title="Vendors"
        description="Who you buy from: contact, terms, lead time, and the last price you paid for each part."
      />
      <DataTable
        id="vendors"
        data={vendors.data ?? []}
        loading={vendors.isLoading}
        error={vendors.error?.message}
        columns={VENDOR_COLUMNS}
        getRowId={(vendor) => vendor.id}
        rowHref={(vendor) => `/inbound/vendors/${vendor.id}`}
        tabs={VENDOR_TABS}
        defaultTab="all"
        defaultSort={{ id: "name", desc: false }}
        search={{
          placeholder: "Search vendor, contact, email",
          text: (vendor) => [vendor.name, vendor.contactName, vendor.email, vendor.notes].filter(Boolean).join(" "),
        }}
        exportName="vendors"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New vendor
          </Button>
        }
        empty={
          <EmptyState
            icon={Factory}
            title="No vendors yet."
            body="A vendor is added the first time you buy from them, or add one here with their terms and lead time."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New vendor
              </Button>
            }
          />
        }
      />
      <VendorSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function vendorDefaults(vendor?: Vendor | null) {
  return {
    name: vendor?.name ?? "",
    contactName: vendor?.contactName ?? "",
    email: vendor?.email ?? "",
    phone: vendor?.phone ?? "",
    address: vendor?.address ?? "",
    paymentTerms: vendor?.paymentTerms ?? "",
    leadTimeDays: vendor?.leadTimeDays == null ? "" : String(vendor.leadTimeDays),
    makeDays: vendor?.makeDays == null ? "" : String(vendor.makeDays),
    transitMode: vendor?.transitMode ?? "",
    transitDays: vendor?.transitDays == null ? "" : String(vendor.transitDays),
    bufferDays: vendor?.bufferDays == null ? "" : String(vendor.bufferDays),
    currency: vendor?.currency ?? "USD",
    notes: vendor?.notes ?? "",
  };
}

function VendorSheet({
  open,
  onOpenChange,
  vendor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: Vendor | null;
  onSaved?: (vendor: Vendor) => void;
}) {
  const navigate = useNavigate();
  const form = useZodForm(vendorFormSchema, vendorDefaults(vendor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reset } = form;
  useEffect(() => {
    if (open) reset(vendorDefaults(vendor));
  }, [open, vendor, reset]);

  async function save(values: ZodFormOutput<typeof vendorFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      const saved = await apiMutate<Vendor>(vendor ? `/api/vendors/${vendor.id}` : "/api/vendors", {
        method: vendor ? "PATCH" : "POST",
        body: JSON.stringify({
          ...values,
          leadTimeDays: values.leadTimeDays === "" ? null : values.leadTimeDays,
          makeDays: values.makeDays ? values.makeDays : null,
          transitDays: values.transitDays ? values.transitDays : null,
          bufferDays: values.bufferDays ? values.bufferDays : null,
          transitMode: values.transitMode?.trim() || null,
        }),
        refresh: "/api/vendors",
      });
      toast.success(vendor ? `${saved.name} saved.` : `${saved.name} added.`);
      onOpenChange(false);
      if (onSaved) onSaved(saved);
      else navigate(`/inbound/vendors/${saved.id}`);
    } catch (err) {
      setError(errorText(err, "Could not save the vendor."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={vendor ? `Edit ${vendor.name}` : "New vendor"}
      description="Renaming changes new purchases. Existing ones keep the name they were sent with."
      submitLabel={vendor ? "Save vendor" : "Add vendor"}
      onSubmit={form.handleSubmit(save)}
      busy={busy}
      error={error}
    >
      <TextField form={form} name="name" label="Name" placeholder="Harbor Components" autoFocus />
      <TextField form={form} name="contactName" label="Contact" placeholder="Dana Ruiz" />
      <TextField
        form={form}
        name="email"
        label="Order email"
        type="email"
        placeholder="orders@vendor.com"
        description="Sending a purchase goes here unless you type another address."
      />
      <TextField form={form} name="phone" label="Phone" />
      <TextareaField form={form} name="address" label="Address" rows={2} />
      <div className="grid grid-cols-3 gap-3">
        <TextField form={form} name="paymentTerms" label="Terms" placeholder="Net 30" />
        <TextField form={form} name="leadTimeDays" label="Lead time (days)" placeholder="7" />
        <TextField form={form} name="makeDays" label="Make days" placeholder="30" />
        <TextField form={form} name="transitMode" label="Transit (ocean, air, or ground)" placeholder="ocean" />
        <TextField form={form} name="transitDays" label="Transit days" placeholder="35" />
        <TextField form={form} name="bufferDays" label="Buffer days" placeholder="14" />
        <TextField form={form} name="currency" label="Currency" placeholder="USD" />
      </div>
      <TextareaField form={form} name="notes" label="Notes" rows={2} />
    </FormSheet>
  );
}

function VendorView({ id }: { id: string }) {
  const detail = useApiQuery<VendorDetail>(`/api/vendors/${id}`);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState("purchases");
  if (!detail.data) return detail.error ? <ErrorBanner error={detail.error.message} /> : <DetailSkeleton />;
  const { vendor, purchases, lastCosts, vendorReturns } = detail.data;
  const open = purchases.filter((row) => row.open).length;

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Inbound"
        list={{ label: "Vendors", to: "/inbound/vendors" }}
        title={vendor.name}
        description={[vendor.contactName, vendor.paymentTerms, vendor.leadTimeDays != null ? `${vendor.leadTimeDays}-day lead time` : null]
          .filter(Boolean)
          .join(" · ")}
        primary={{ label: "Edit vendor", icon: Pencil, onSelect: () => setEditing(true) }}
        menu={[{ label: "New purchase", icon: ShoppingCart, to: "/inbound/purchases" }]}
      />
      <DocumentFrame
        rail={
          <DocumentRail>
            <RailCard>
              <DocumentFact label="Contact">{vendor.contactName ?? <Muted>—</Muted>}</DocumentFact>
              <DocumentFact label="Email">
                {vendor.email ? <a className="underline" href={`mailto:${vendor.email}`}>{vendor.email}</a> : <Muted>—</Muted>}
              </DocumentFact>
              <DocumentFact label="Phone">{vendor.phone ?? <Muted>—</Muted>}</DocumentFact>
              <DocumentFact label="Terms">{vendor.paymentTerms ?? <Muted>—</Muted>}</DocumentFact>
              <DocumentFact label="Lead time">{vendor.leadTimeDays == null ? <Muted>—</Muted> : `${vendor.leadTimeDays} days`}</DocumentFact>
              <DocumentFact label="Currency">{vendor.currency}</DocumentFact>
              <DocumentFact label="Open purchases">{open}</DocumentFact>
            </RailCard>
            {vendor.address || vendor.notes ? (
              <RailCard>
                {vendor.address ? <p className="whitespace-pre-line text-sm">{vendor.address}</p> : null}
                {vendor.notes ? <p className="text-xs text-muted-foreground">{vendor.notes}</p> : null}
              </RailCard>
            ) : null}
          </DocumentRail>
        }
      >
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="purchases">Purchases ({purchases.length})</TabsTrigger>
            <TabsTrigger value="costs">Last cost ({lastCosts.length})</TabsTrigger>
            <TabsTrigger value="returns">Vendor returns ({vendorReturns.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="purchases">
            {purchases.length === 0 ? (
              <EmptyState icon={ShoppingCart} title="No purchases from this vendor yet." body="New purchases pick this vendor by name." />
            ) : (
              <Table columns={["Purchase", "Lines", "Received", "Total", "Created", "Status"]}>
                {purchases.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <DocLink to={`/inbound/purchases/${row.id}`}>{row.number}</DocLink>
                    </td>
                    <td className="font-mono tabular-nums">{row.lineCount}</td>
                    <td>
                      <ProgressCell done={row.unitsReceived} total={row.unitsOrdered} />
                    </td>
                    <td className="font-mono tabular-nums">{formatMoney(row.totalCents, vendor.currency)}</td>
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
          <TabsContent value="costs">
            {lastCosts.length === 0 ? (
              <EmptyState icon={Factory} title="Nothing bought yet." body="Each part's last price shows here once it is on a purchase." />
            ) : (
              <Table columns={["Item", "Last cost", "Qty", "On"]}>
                {lastCosts.map((row) => (
                  <tr key={row.itemId}>
                    <td>
                      <SkuCell sku={row.sku} name={row.itemName} to={`/stock/items/${row.itemId}`} />
                    </td>
                    <td className="font-mono tabular-nums">{formatMoney(row.unitCostCents, vendor.currency)}</td>
                    <td className="font-mono tabular-nums">{row.qtyOrdered}</td>
                    <td>
                      <Link className="font-mono underline" to={`/inbound/purchases/${row.purchaseId}`}>
                        {row.purchaseNumber}
                      </Link>{" "}
                      <RelativeTime at={row.at} className="text-xs text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </TabsContent>
          <TabsContent value="returns">
            {vendorReturns.length === 0 ? (
              <EmptyState title="No vendor returns." body="Parts sent back to this vendor show here." />
            ) : (
              <Table columns={["Return", "Created", "Status"]}>
                {vendorReturns.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <DocLink to={`/inbound/vendor-returns/${row.id}`}>{row.number}</DocLink>
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
      <VendorSheet open={editing} onOpenChange={setEditing} vendor={vendor} onSaved={() => void detail.refetch()} />
    </div>
  );
}
