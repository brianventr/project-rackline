import { ScrollText } from "lucide-react";
import type { AuditEvent } from "../../api";
import { EmptyState, PageHeader, ToneBadge } from "../../components/ui";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../../components/data-table/DataTable";
import { Muted, PersonAvatar, RelativeTime } from "../../components/cells";
import { useApiQuery } from "../../query";
import type { StatusTone } from "@/domain/status";

function actorOf(row: AuditEvent): string | null {
  return row.actorName || row.actorEmail || null;
}

/** 2xx reads green, a 409 conflict amber, anything else refused red. */
function httpTone(status: number): StatusTone {
  if (status < 400) return "success";
  if (status === 409) return "warning";
  return "danger";
}

const AUDIT_TABS: TabDef<AuditEvent>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "posted", label: "Posted", match: (row) => row.status < 400 },
  { id: "refused", label: "Refused", match: (row) => row.status >= 400 },
];

const AUDIT_FACETS: FacetDef<AuditEvent>[] = [
  { id: "action", label: "Action", value: (row) => row.action || null },
  { id: "user", label: "User", value: actorOf },
];

const AUDIT_COLUMNS: DataColumn<AuditEvent>[] = [
  {
    id: "when",
    header: "When",
    sortValue: (row) => row.createdAt,
    csv: (row) => new Date(row.createdAt).toISOString(),
    cell: (row) => <RelativeTime at={row.createdAt} />,
  },
  {
    id: "who",
    header: "Who",
    sortValue: (row) => actorOf(row),
    csv: (row) => [row.actorName, row.actorEmail].filter(Boolean).join(" "),
    cell: (row) => {
      const actor = actorOf(row);
      if (!actor) return <Muted>—</Muted>;
      return (
        <span className="flex min-w-0 items-center gap-2">
          <PersonAvatar name={actor} />
          <span className="min-w-0">
            <span className="block truncate">{actor}</span>
            {row.actorName && row.actorEmail ? (
              <span className="block truncate text-xs text-muted-foreground">{row.actorEmail}</span>
            ) : null}
          </span>
        </span>
      );
    },
  },
  {
    id: "action",
    header: "Action",
    sortValue: (row) => row.action,
    cell: (row) => <span className="font-mono text-xs">{row.action}</span>,
  },
  {
    id: "path",
    header: "Path",
    sortValue: (row) => row.path,
    csv: (row) => `${row.method} ${row.path}`,
    cell: (row) => (
      <span className="font-mono text-xs">
        <span className="text-muted-foreground">{row.method}</span> {row.path}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    align: "right",
    sortValue: (row) => row.status,
    cell: (row) => (
      <ToneBadge tone={httpTone(row.status)} className="font-mono">
        {row.status}
      </ToneBadge>
    ),
  },
  {
    id: "code",
    header: "Code",
    sortValue: (row) => row.code,
    cell: (row) => (row.code ? <span className="font-mono text-xs">{row.code}</span> : <Muted>—</Muted>),
  },
  {
    id: "summary",
    header: "Summary",
    csv: (row) => row.summary,
    cell: (row) => <span className="text-muted-foreground">{row.summary}</span>,
  },
];

export function AuditPage() {
  const audit = useApiQuery<AuditEvent[]>("/api/audit");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Audit"
        description="Who posted which mutation, 409, or owner-only action. Passwords and tokens are redacted."
      />
      <DataTable
        id="audit"
        data={audit.data}
        loading={audit.isLoading}
        error={audit.error?.message}
        columns={AUDIT_COLUMNS}
        getRowId={(row) => row.id}
        tabs={AUDIT_TABS}
        defaultTab="all"
        facets={AUDIT_FACETS}
        defaultSort={{ id: "when", desc: true }}
        search={{
          placeholder: "Search user, action, path",
          text: (row) =>
            [row.actorName, row.actorEmail, row.action, row.method, row.path, row.code, row.summary].filter(Boolean).join(" "),
        }}
        exportName="audit-log"
        empty={
          <EmptyState
            icon={ScrollText}
            title="No audit entries yet."
            body="Every write, 409, and owner-only action lands here with who did it. Receive, pick, or invite a teammate to see one."
          />
        }
      />
    </div>
  );
}
