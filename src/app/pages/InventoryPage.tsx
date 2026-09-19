import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type InventoryRow } from "../api";
import { ErrorBanner, Input, PageHeader, Table } from "../components/ui";
import { useWarehouse, inWarehouse } from "../warehouse";

export function InventoryPage() {
  const { warehouseId } = useWarehouse();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<InventoryRow[]>("/api/inventory")
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  const filtered = useMemo(() => {
    const scoped = inWarehouse(rows, warehouseId);
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (row) =>
        row.sku.toLowerCase().includes(q) ||
        row.itemName.toLowerCase().includes(q) ||
        row.locationCode.toLowerCase().includes(q),
    );
  }, [rows, query, warehouseId]);

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
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/stock/items/${row.itemId}`}>
                {row.sku}
              </Link>
            </td>
            <td className="px-4 py-3">{row.itemName}</td>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/stock/locations/${row.locationId}`}>
                {row.locationCode}
              </Link>
            </td>
            <td className="px-4 py-3 capitalize">{row.itemType}</td>
            <td className="px-4 py-3 font-mono tabular">{row.qty}</td>
          </tr>
        ))}
      </Table>
      {filtered.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No on-hand rows match.</p> : null}
    </div>
  );
}
