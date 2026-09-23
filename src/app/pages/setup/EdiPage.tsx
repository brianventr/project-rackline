import { useState } from "react";
import { Link } from "react-router-dom";
import { FileCode2, Send } from "lucide-react";
import { api } from "../../api";
import {
  Button,
  Card,
  DoneBanner,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  ToneBadge,
  onSubmit,
  summarizeLines,
} from "../../components/ui";
import { DataTable, type DataColumn, type FacetDef } from "../../components/data-table/DataTable";
import { DocLink, LineChips, Muted, RelativeTime } from "../../components/cells";
import { Term } from "../../components/term";
import { refreshApi, useApiQuery } from "../../query";
import { useWrite } from "../../use-write";
import { useWarehouse } from "../../warehouse";
import { statusText, statusTone, type StatusTone } from "@/domain/status";
import type { EdiInboxLine } from "@/domain/edi-inbox";

/**
 * A `GET /api/edi/inbox` row, newest first. Declared here rather than in `api.ts`, which another
 * track owns this wave. Refused ASNs are kept too: `status` "failed", no ASN, and the reason in `error`.
 */
type EdiInboxRow = {
  id: string;
  kind: string;
  status: string;
  createdAt: number;
  error: string | null;
  createdAsnId: string | null;
  createdAsnNumber: string | null;
  vendorName: string | null;
  reference: string | null;
  lineCount: number;
  /** First readable lines of the payload (`summarizeEdiPayload`), for chips and search. `lineCount` counts them all. */
  lines?: EdiInboxLine[];
};

function inboxStatusLabel(status: string): string {
  if (status === "processed") return "Processed";
  if (status === "failed") return "Refused";
  return statusText(status);
}

function inboxStatusTone(status: string): StatusTone {
  if (status === "processed") return "success";
  if (status === "failed") return "danger";
  return statusTone(status);
}

function kindLabel(kind: string): string {
  return kind === "asn" ? "ASN" : kind.toUpperCase();
}

function asnHref(row: EdiInboxRow): string | null {
  return row.createdAsnId && row.createdAsnNumber ? `/inbound/asns/${row.createdAsnId}` : null;
}

const INBOX_FACETS: FacetDef<EdiInboxRow>[] = [
  { id: "status", label: "Status", value: (row) => row.status, format: inboxStatusLabel },
];

const INBOX_COLUMNS: DataColumn<EdiInboxRow>[] = [
  {
    id: "received",
    header: "Received",
    sortValue: (row) => row.createdAt,
    csv: (row) => new Date(row.createdAt).toISOString(),
    cell: (row) => <RelativeTime at={row.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (row) => inboxStatusLabel(row.status),
    csv: (row) => (row.error ? `${inboxStatusLabel(row.status)}: ${row.error}` : inboxStatusLabel(row.status)),
    className: "min-w-40 max-w-[22rem]",
    cell: (row) => (
      <span className="flex min-w-0 flex-col items-start gap-1">
        <ToneBadge tone={inboxStatusTone(row.status)}>{inboxStatusLabel(row.status)}</ToneBadge>
        {row.error ? (
          <span className="line-clamp-2 text-xs text-tone-danger" title={row.error}>
            {row.error}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: "asn",
    header: "ASN",
    sortValue: (row) => row.createdAsnNumber,
    cell: (row) => {
      const href = asnHref(row);
      return href ? <DocLink to={href}>{row.createdAsnNumber}</DocLink> : <Muted>—</Muted>;
    },
  },
  {
    id: "vendor",
    header: "Vendor",
    sortValue: (row) => row.vendorName,
    cell: (row) => (row.vendorName ? <span className="font-medium">{row.vendorName}</span> : <Muted>Not given</Muted>),
  },
  {
    id: "reference",
    header: "Reference",
    sortValue: (row) => row.reference,
    cell: (row) => (row.reference ? <span className="font-mono text-[13px]">{row.reference}</span> : <Muted>—</Muted>),
  },
  {
    id: "lines",
    header: "Lines",
    sortValue: (row) => row.lineCount,
    csv: (row) => (row.lines?.length ? summarizeLines(row.lines) : row.lineCount),
    cell: (row) => <InboxLines row={row} />,
  },
  {
    id: "kind",
    header: "Kind",
    defaultHidden: true,
    sortValue: (row) => row.kind,
    csv: (row) => kindLabel(row.kind),
    cell: (row) => <span className="font-mono text-xs">{kindLabel(row.kind)}</span>,
  },
];

/** SKU chips when the payload carried readable lines, otherwise just the count. */
function InboxLines({ row }: { row: EdiInboxRow }) {
  const lines = row.lines ?? [];
  if (!lines.length) {
    return row.lineCount > 0 ? (
      <span className="tabular-nums">{row.lineCount === 1 ? "1 line" : `${row.lineCount} lines`}</span>
    ) : (
      <Muted>None</Muted>
    );
  }
  // The server echoes the first lines only; count the rest from `lineCount`.
  if (row.lineCount <= lines.length) return <LineChips lines={lines} />;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <LineChips lines={lines.slice(0, 2)} />
      <span className="text-[11px] text-muted-foreground">+{row.lineCount - Math.min(2, lines.length)} more</span>
    </span>
  );
}

function inboxSearchText(row: EdiInboxRow): string {
  return [
    row.createdAsnNumber,
    row.vendorName,
    row.reference,
    row.error,
    inboxStatusLabel(row.status),
    ...(row.lines ?? []).map((line) => line.sku),
  ]
    .filter(Boolean)
    .join(" ");
}

export function EdiPage() {
  const { warehouseId, warehouse } = useWarehouse();
  const [vendorName, setVendorName] = useState("Harbor Components");
  const [sku, setSku] = useState("LED-BULB");
  const [qty, setQty] = useState("12");
  const [clientCode, setClientCode] = useState("ACME");
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  const write = useWrite();
  const inbox = useApiQuery<EdiInboxRow[]>("/api/edi/inbox");

  const body = {
    warehouseId,
    vendorName,
    clientCode: clientCode.trim() || undefined,
    lines: [{ sku, qty: Number(qty) }],
  };

  async function submit() {
    setCreated(null);
    const res = await write.run(
      "EDI",
      () => api<{ asn: { id: string; number: string } }>("/api/edi/asn", { method: "POST", body: JSON.stringify(body) }),
      (result) => `Created ${result.asn.number}.`,
    );
    if (res) setCreated(res.asn);
    // A refused ASN is logged in the inbox too, and a failed write does not refresh on its own.
    else void refreshApi("/api/edi/inbox");
  }

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Supplier EDI"
        description={
          <>
            Thin <Term id="asn">ASN</Term> ingest (JSON stub). A supplier posts one ASN and it lands as expected inbound.
          </>
        }
      />
      <ErrorBanner error={write.error} />
      {created ? (
        <DoneBanner>
          Created{" "}
          <Link className="font-mono font-medium underline" to={`/inbound/asns/${created.id}`}>
            {created.number}
          </Link>
          . It is expected at {warehouse?.name ?? "this warehouse"} now.
        </DoneBanner>
      ) : null}

      <div className="grid gap-(--density-gap) lg:grid-cols-2">
        <Card className="min-w-0">
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Post a test ASN</h2>
              <p className="text-sm text-muted-foreground">
                Runs the same ingest a supplier would. The SKU must be in the catalog; the client code is optional.
              </p>
            </div>
            <form className="space-y-3" onSubmit={onSubmit(submit)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vendor">
                  <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required />
                </Field>
                <Field label="Client code">
                  <Input value={clientCode} onChange={(e) => setClientCode(e.target.value)} placeholder="ACME" />
                </Field>
                <Field label="SKU">
                  <Input value={sku} onChange={(e) => setSku(e.target.value)} required />
                </Field>
                <Field label="Qty">
                  <Input value={qty} onChange={(e) => setQty(e.target.value)} required type="number" min={1} />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={write.busy}>
                  <Send className="size-4" />
                  Post ASN
                </Button>
              </div>
            </form>
          </div>
        </Card>

        <Card className="min-w-0">
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Payload</h2>
              <p className="text-sm text-muted-foreground">
                The JSON this form sends to <span className="font-mono">POST /api/edi/asn</span>.
              </p>
            </div>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
              {JSON.stringify(body, null, 2)}
            </pre>
          </div>
        </Card>
      </div>

      <section className="space-y-2">
        <SectionHeading
          title="Inbox"
          description="Every ASN a supplier posts, newest first. Refused ones stay here with the reason, so you can tell the supplier what to fix."
        />
        <DataTable
          id="edi-inbox"
          data={inbox.data}
          loading={inbox.isLoading}
          error={inbox.error?.message}
          columns={INBOX_COLUMNS}
          getRowId={(row) => row.id}
          rowHref={asnHref}
          facets={INBOX_FACETS}
          defaultSort={{ id: "received", desc: true }}
          search={{ placeholder: "Search ASN, vendor, SKU, reason", text: inboxSearchText }}
          exportName="edi-inbox"
          empty={
            <EmptyState
              icon={FileCode2}
              title="No supplier ASNs yet."
              body={
                <>
                  Each ASN posted to the <Term id="edi">EDI</Term> endpoint lands here, including refused ones and why. Post a
                  test ASN above to see one.
                </>
              }
            />
          }
        />
      </section>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="min-w-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
