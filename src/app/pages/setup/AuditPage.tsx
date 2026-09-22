import { useEffect, useState } from "react";
import { api, type AuditEvent } from "../../api";
import { ErrorBanner, PageHeader, Table } from "../../components/ui";

function formatWhen(ms: number) {
  return new Date(ms).toLocaleString();
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AuditEvent[]>("/api/audit")
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <PageHeader
        eyebrow="Setup"
        title="Audit"
        description="Who posted which mutation, 409, or owner-only action. Passwords and tokens are redacted."
      />
      <ErrorBanner error={error} />
      <Table columns={["When", "Who", "Action", "Path", "Status", "Code", "Summary"]}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="px-2.5 py-1.5 text-xs text-muted-foreground">{formatWhen(row.createdAt)}</td>
            <td className="px-2.5 py-1.5 text-sm">{row.actorName || row.actorEmail || "—"}</td>
            <td className="px-2.5 py-1.5 font-mono text-xs">{row.action}</td>
            <td className="px-2.5 py-1.5 font-mono text-xs">{row.path}</td>
            <td className="px-2.5 py-1.5 font-mono tabular">{row.status}</td>
            <td className="px-2.5 py-1.5 font-mono text-xs">{row.code || "—"}</td>
            <td className="px-2.5 py-1.5 text-muted-foreground">{row.summary}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
