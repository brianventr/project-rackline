import { Link } from "react-router-dom";
import { FileText, Receipt } from "lucide-react";
import { api } from "../../api";
import { Button, Card, EmptyState, ErrorBanner, PageHeader, StatusBadge } from "../../components/ui";
import { DataTable, type DataColumn, type FacetDef } from "../../components/data-table/DataTable";
import { Muted, RelativeTime } from "../../components/cells";
import { ActionButton, DocumentFact, type DocumentAction } from "../../components/document";
import { Term } from "../../components/term";
import { useApiQuery } from "../../query";
import { useWrite } from "../../use-write";
import { Skeleton } from "@/components/ui/skeleton";

type InvoiceLine = { kind: string; label: string; qty: number; amountCents: number };

type Invoice = {
  id: string;
  number: string;
  amountCents: number;
  status: string;
  clientCode: string | null;
  clientName: string | null;
  lines: InvoiceLine[];
  createdAt?: number;
  periodStart?: number;
  periodEnd?: number;
};

type BillingPayload = {
  account: { plan: string; status: string } | null;
  invoices: Invoice[];
  clientCount: number;
  rates: { storageCentsPerPiece: number; pickCentsPerUnit: number; cartonCents: number };
  periodDays: number;
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function day(at: number | undefined): string {
  return at ? new Date(at).toISOString().slice(0, 10) : "—";
}

const INVOICE_FACETS: FacetDef<Invoice>[] = [
  { id: "status", label: "Status", value: (invoice) => invoice.status },
  { id: "client", label: "Client", value: (invoice) => invoice.clientCode },
];

const INVOICE_COLUMNS: DataColumn<Invoice>[] = [
  {
    id: "number",
    header: "Invoice",
    sortValue: (invoice) => invoice.number,
    cell: (invoice) => <span className="font-mono font-medium">{invoice.number}</span>,
  },
  {
    id: "client",
    header: "Client",
    sortValue: (invoice) => invoice.clientCode,
    csv: (invoice) => [invoice.clientCode, invoice.clientName].filter(Boolean).join(" "),
    cell: (invoice) =>
      invoice.clientCode ? (
        <span className="flex flex-col">
          <span className="font-mono">{invoice.clientCode}</span>
          {invoice.clientName ? <span className="text-xs text-muted-foreground">{invoice.clientName}</span> : null}
        </span>
      ) : (
        <Muted>No client</Muted>
      ),
  },
  {
    id: "period",
    header: "Period",
    sortValue: (invoice) => invoice.periodStart ?? null,
    csv: (invoice) => `${day(invoice.periodStart)} to ${day(invoice.periodEnd)}`,
    cell: (invoice) =>
      invoice.periodStart ? (
        <span className="whitespace-nowrap font-mono text-xs">
          {day(invoice.periodStart)} – {day(invoice.periodEnd)}
        </span>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "lines",
    header: "Lines",
    csv: (invoice) => invoice.lines.map((line) => `${line.label} x ${line.qty} = ${money(line.amountCents)}`).join("; "),
    cell: (invoice) =>
      invoice.lines.length ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {invoice.lines.map((line) => (
            <li key={line.kind} className="flex justify-between gap-3">
              <span>
                {line.label} <span className="font-mono">× {line.qty}</span>
              </span>
              <span className="font-mono tabular-nums">{money(line.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    sortValue: (invoice) => invoice.amountCents,
    csv: (invoice) => (invoice.amountCents / 100).toFixed(2),
    cell: (invoice) => <span className="font-mono font-medium">{money(invoice.amountCents)}</span>,
  },
  {
    id: "created",
    header: "Created",
    sortValue: (invoice) => invoice.createdAt ?? null,
    csv: (invoice) => (invoice.createdAt ? new Date(invoice.createdAt).toISOString() : ""),
    cell: (invoice) => <RelativeTime at={invoice.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (invoice) => invoice.status,
    cell: (invoice) => <StatusBadge status={invoice.status} />,
  },
];

export function BillingPage() {
  const billing = useApiQuery<BillingPayload>("/api/billing");
  const write = useWrite();
  const data = billing.data;

  const generate = () =>
    write.run(
      "Generate",
      () => api<{ invoices: Invoice[] }>("/api/billing/invoices/generate", { method: "POST" }),
      (result) => {
        const count = result?.invoices?.length ?? 0;
        return `Drafted ${count} ${count === 1 ? "invoice" : "invoices"}.`;
      },
    );

  const generateAction: DocumentAction = {
    label: "Generate draft invoices",
    icon: FileText,
    onSelect: generate,
    disabled: !data,
    confirm: {
      title: "Generate draft invoices?",
      body: `One draft per 3PL client with activity in the last ${data?.periodDays ?? 30} days. Running it again makes another set.`,
      confirmLabel: "Generate drafts",
    },
  };

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Billing"
        description={
          <>
            Draft one invoice per <Term id="3pl-client">3PL client</Term> from on-hand pieces, picks, and shipped{" "}
            <Term id="carton">cartons</Term>.
          </>
        }
      />
      <ErrorBanner error={billing.error?.message ?? null} />

      <Card>
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Plan and rates</h2>
            <p className="text-sm text-muted-foreground">
              What each draft charges. Storage counts pieces on hand; picks and cartons cover the last {data?.periodDays ?? 30}{" "}
              days.
            </p>
          </div>
          {data ? (
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <DocumentFact label="Plan">
                <span className="font-mono">{data.account?.plan ?? "—"}</span>
                {data.account?.status ? <StatusBadge status={data.account.status} className="ml-2" /> : null}
              </DocumentFact>
              <DocumentFact label="Clients">
                <span className="font-mono">{data.clientCount}</span>
              </DocumentFact>
              <DocumentFact label="Storage">
                <span className="font-mono">{data.rates.storageCentsPerPiece}¢</span> / piece
              </DocumentFact>
              <DocumentFact label="Picks">
                <span className="font-mono">{data.rates.pickCentsPerUnit}¢</span> / unit
              </DocumentFact>
              <DocumentFact label="Cartons">
                <span className="font-mono">{money(data.rates.cartonCents)}</span> / carton
              </DocumentFact>
              <DocumentFact label="Activity window">
                <span className="font-mono">{data.periodDays}</span> days
              </DocumentFact>
            </div>
          ) : billing.isLoading ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-5 w-full" />
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Invoices</h2>
            <p className="text-sm text-muted-foreground">The 50 most recent invoices.</p>
          </div>
          <ActionButton action={generateAction} />
        </div>
        <ErrorBanner error={write.error} />
        <DataTable
          id="billing-invoices"
          data={data?.invoices}
          loading={billing.isLoading}
          columns={INVOICE_COLUMNS}
          getRowId={(invoice) => invoice.id}
          facets={INVOICE_FACETS}
          defaultSort={{ id: "created", desc: true }}
          search={{
            placeholder: "Search invoice or client",
            text: (invoice) => [invoice.number, invoice.clientCode, invoice.clientName].filter(Boolean).join(" "),
          }}
          exportName="invoices"
          empty={
            <EmptyState
              icon={Receipt}
              title="No invoices yet."
              body={
                data?.clientCount === 0
                  ? "Add a client first. Drafts cover each client's stock on hand, picks, and shipped cartons."
                  : "Generate drafts once clients have stock on hand, picks, or shipped cartons."
              }
              action={
                data?.clientCount === 0 ? (
                  <Button size="sm" asChild>
                    <Link to="/setup/clients">Add a client</Link>
                  </Button>
                ) : (
                  <ActionButton action={generateAction} />
                )
              }
            />
          }
        />
      </section>
    </div>
  );
}
