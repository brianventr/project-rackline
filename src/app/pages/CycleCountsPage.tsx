import { useEffect, useState } from "react";
import { api, type CycleCount, type Location, type Me } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";

export function CycleCountsPage({ me }: { me: Me }) {
  const [counts, setCounts] = useState<CycleCount[]>([]);
  const [active, setActive] = useState<CycleCount | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const warehouseId = me.warehouses[0]?.id;

  async function load() {
    const [nextCounts, nextLocations] = await Promise.all([
      api<CycleCount[]>("/api/cycle-counts"),
      api<Location[]>("/api/locations"),
    ]);
    setCounts(nextCounts);
    setLocations(nextLocations);
    if (!locationId) {
      const storage = nextLocations.find((location) => location.type === "storage") ?? nextLocations[0];
      if (storage) setLocationId(storage.id);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function start() {
    setError(null);
    try {
      const created = await api<CycleCount>("/api/cycle-counts", {
        method: "POST",
        body: JSON.stringify({ warehouseId, locationId }),
      });
      setActive(created);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start count");
    }
  }

  async function openCount(id: string) {
    setError(null);
    try {
      setActive(await api<CycleCount>(`/api/cycle-counts/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load count");
    }
  }

  async function post() {
    if (!active) return;
    setError(null);
    try {
      const posted = await api<CycleCount>(`/api/cycle-counts/${active.id}/post`, {
        method: "POST",
        body: JSON.stringify({
          lines: (active.lines ?? []).map((line) => ({ id: line.id, countedQty: line.countedQty })),
        }),
      });
      setActive(posted);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post count");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Accuracy"
        title="Cycle counts"
        description="Snapshot a bin, enter what you see, and post variances to the ledger."
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit(start)}>
          <Field label="Location">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Start count</Button>
        </form>
      </Card>
      {active ? (
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase text-muted">{active.number}</p>
              <h2 className="font-semibold">Count worksheet</h2>
            </div>
            <StatusBadge status={active.status} />
          </div>
          <Table columns={["SKU", "System", "Counted", "Variance"]}>
            {(active.lines ?? []).map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <span className="font-mono">{line.sku}</span> {line.itemName}
                </td>
                <td className="px-4 py-3 font-mono tabular">{line.systemQty}</td>
                <td className="px-4 py-3">
                  <Input
                    type="number"
                    min={0}
                    value={String(line.countedQty)}
                    disabled={active.status !== "draft"}
                    onChange={(e) => {
                      const countedQty = Number(e.target.value);
                      setActive((current) =>
                        current
                          ? {
                              ...current,
                              lines: (current.lines ?? []).map((row) =>
                                row.id === line.id ? { ...row, countedQty } : row,
                              ),
                            }
                          : current,
                      );
                    }}
                  />
                </td>
                <td className="px-4 py-3 font-mono tabular">{line.countedQty - line.systemQty}</td>
              </tr>
            ))}
          </Table>
          {active.status === "draft" ? (
            <div className="mt-4">
              <Button onClick={post}>Post variances</Button>
            </div>
          ) : null}
        </Card>
      ) : null}
      <Table columns={["Number", "Location", "Status", ""]}>
        {counts.map((count) => (
          <tr key={count.id}>
            <td className="px-4 py-3 font-mono">{count.number}</td>
            <td className="px-4 py-3 font-mono">{count.locationCode}</td>
            <td className="px-4 py-3">
              <StatusBadge status={count.status} />
            </td>
            <td className="px-4 py-3 text-right">
              <Button variant="ghost" onClick={() => openCount(count.id)}>
                Open
              </Button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
