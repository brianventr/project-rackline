import { useEffect, useState } from "react";
import { api, type Movement } from "../api";
import { ErrorBanner, PageHeader, Table } from "../components/ui";
import { formatCatchWeight } from "@/domain/catch-weight";

function formatWhen(ms: number) {
  return new Date(ms).toLocaleString();
}

export function LedgerPage() {
  const [rows, setRows] = useState<Movement[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Movement[]>("/api/movements")
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Stock"
        title="Ledger"
        description="Every receive, move, pick, ship, kit, replenishment, and work-order movement."
      />
      <ErrorBanner error={error} />
      <Table columns={["When", "Type", "SKU", "Qty", "Weight", "Lot", "From", "To", "Reason"]}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 text-xs text-muted-foreground">{formatWhen(row.createdAt)}</td>
            <td className="px-4 py-3 font-mono text-xs uppercase">{row.type}</td>
            <td className="px-4 py-3 font-mono">{row.sku}</td>
            <td className="px-4 py-3 font-mono tabular">{row.qty}</td>
            <td className="px-4 py-3 font-mono text-xs">{formatCatchWeight(row.weightGrams)}</td>
            <td className="px-4 py-3 font-mono text-xs">{row.lotCode || "—"}</td>
            <td className="px-4 py-3 font-mono">{row.fromLocationCode || "—"}</td>
            <td className="px-4 py-3 font-mono">{row.toLocationCode || "—"}</td>
            <td className="px-4 py-3 text-muted-foreground">{row.reason || "—"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
