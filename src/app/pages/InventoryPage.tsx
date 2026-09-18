import { useEffect, useMemo, useState } from "react";
import { api, type InventoryRow } from "../api";
import { ErrorBanner, Input, PageHeader, Table } from "../components/ui";

export function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<InventoryRow[]>("/api/inventory")
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.sku.toLowerCase().includes(q) ||
        row.itemName.toLowerCase().includes(q) ||
        row.locationCode.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div>
      <PageHeader
        eyebrow="Stock"
        title="On-hand"
        description="Every unit sits in a location. Search by SKU or bin."
        actions={<Input placeholder="Filter SKU or bin" value={query} onChange={(e) => setQuery(e.target.value)} />}
      />
      <ErrorBanner error={error} />
      <Table columns={["SKU", "Item", "Location", "Type", "Qty"]}>
        {filtered.map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-mono">{row.sku}</td>
            <td className="px-4 py-3">{row.itemName}</td>
            <td className="px-4 py-3 font-mono">{row.locationCode}</td>
            <td className="px-4 py-3 capitalize">{row.itemType}</td>
            <td className="px-4 py-3 font-mono tabular">{row.qty}</td>
          </tr>
        ))}
      </Table>
      {filtered.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No on-hand rows match.</p> : null}
    </div>
  );
}
