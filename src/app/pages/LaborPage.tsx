import { useEffect, useState } from "react";
import { api, type LaborBoard } from "../api";
import { ErrorBanner, PageHeader, Table } from "../components/ui";
import { useWarehouse } from "../warehouse";

export function LaborPage() {
  const { warehouseId } = useWarehouse();
  const [board, setBoard] = useState<LaborBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    api<LaborBoard>(`/api/labor${query}`)
      .then(setBoard)
      .catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Labor"
        description="Recent floor events and a rollup by teammate for this warehouse."
      />
      <ErrorBanner error={error} />
      <div className="mb-8">
        <p className="mb-2 text-sm font-medium">Rollup</p>
        <Table columns={["Teammate", "Events", "Qty", "Duration (sec)"]}>
          {(board?.rollup ?? []).map((row) => (
            <tr key={row.userId}>
              <td className="px-4 py-3">{row.userName}</td>
              <td className="px-4 py-3 font-mono">{row.events}</td>
              <td className="px-4 py-3 font-mono">{row.qty}</td>
              <td className="px-4 py-3 font-mono">{row.durationSec}</td>
            </tr>
          ))}
        </Table>
        {board && board.rollup.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No labor events yet.</p> : null}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Events</p>
        <Table columns={["When", "Teammate", "Verb", "Ref", "Qty"]}>
          {(board?.events ?? []).map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3 text-sm text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
              <td className="px-4 py-3">{row.userName}</td>
              <td className="px-4 py-3 font-mono text-sm">{row.verb}</td>
              <td className="px-4 py-3 font-mono text-sm">
                {row.refType}/{row.refId.slice(0, 8)}
              </td>
              <td className="px-4 py-3 font-mono">{row.qty ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}
