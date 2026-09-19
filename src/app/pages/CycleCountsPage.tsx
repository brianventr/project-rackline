import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type CycleCount, type Location } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";
import { DocumentHeader, DocumentActivity } from "../components/document";
import { COUNT_STEPS, canPostCount } from "@/domain/status";
import { useWarehouse, inWarehouse } from "../warehouse";

export function CycleCountsPage() {
  const { id } = useParams();
  if (id) return <CountDetail id={id} />;
  return <CountList />;
}

function CountList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [counts, setCounts] = useState<CycleCount[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextCounts, nextLocations] = await Promise.all([
      api<CycleCount[]>("/api/cycle-counts"),
      api<Location[]>("/api/locations"),
    ]);
    setCounts(nextCounts);
    setLocations(nextLocations);
    const storage = nextLocations.find((location) => location.type === "storage") ?? nextLocations[0];
    if (storage) setLocationId(storage.id);
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
      navigate(`/stock/counts/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start count");
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Stock" title="Cycle counts" description="Snapshot a bin, enter what you see, and post variances." />
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
      <Table columns={["Number", "Location", "Status"]}>
        {inWarehouse(counts, warehouseId).map((count) => (
          <tr key={count.id}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/stock/counts/${count.id}`}>
                {count.number}
              </Link>
            </td>
            <td className="px-4 py-3 font-mono">{count.locationCode}</td>
            <td className="px-4 py-3">
              <StatusBadge status={count.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function CountDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [active, setActive] = useState<CycleCount | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CycleCount>(`/api/cycle-counts/${id}`)
      .then(setActive)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    if (!active) return;
    setError(null);
    try {
      setActive(await api<CycleCount>(`/api/cycle-counts/${id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    }
  }

  async function post() {
    if (!active) return;
    setError(null);
    try {
      setActive(
        await api<CycleCount>(`/api/cycle-counts/${id}/post`, {
          method: "POST",
          body: JSON.stringify({
            lines: (active.lines ?? []).map((line) => ({ id: line.id, countedQty: line.countedQty })),
          }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post count");
    }
  }

  if (!active) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-6">
      <DocumentHeader
        eyebrow="Stock"
        title={active.number}
        description={active.locationCode || "Bay count"}
        status={active.status}
        steps={COUNT_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/stock/counts")}>
              All counts
            </Button>
            {active.status === "draft" ? <Button onClick={() => void start()}>Start counting</Button> : null}
            {canPostCount(active.status) ? <Button onClick={() => void post()}>Post variances</Button> : null}
            <Button variant="secondary">
              <Link to={`/floor/count?id=${active.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      <DocumentActivity refId={active.id} />
      <Table columns={["SKU", "System", "Counted", "Variance"]}>
        {(active.lines ?? []).map((line) => (
          <tr key={line.id}>
            <td className="px-4 py-3">
              <span className="font-mono">{line.sku}</span> {line.itemName}
            </td>
            <td className="px-4 py-3 font-mono">{line.systemQty}</td>
            <td className="px-4 py-3">
              <Input
                type="number"
                min={0}
                value={String(line.countedQty)}
                disabled={!canPostCount(active.status)}
                onChange={(e) => {
                  const countedQty = Number(e.target.value);
                  setActive((current) =>
                    current
                      ? {
                          ...current,
                          lines: (current.lines ?? []).map((row) => (row.id === line.id ? { ...row, countedQty } : row)),
                        }
                      : current,
                  );
                }}
              />
            </td>
            <td className="px-4 py-3 font-mono">{line.countedQty - line.systemQty}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
