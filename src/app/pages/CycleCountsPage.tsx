import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type CycleCount, type Item, type Location } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";
import { DocumentHeader, DocumentActivity } from "../components/document";
import { COUNT_STEPS, canPostCount } from "@/domain/status";
import { allLinesEntered, countVariance, formatCountVariance, isBlindCount } from "@/domain/blind-count";
import { useWarehouse, inWarehouse } from "../warehouse";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";

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
      <PageHeader
        eyebrow="Stock"
        title="Cycle counts"
        description="Blind-count a bay, then post. Scan or add a SKU that was not on the snapshot. System qty and variance stay hidden until the count is posted."
      />
      <ErrorBanner error={error} />
      <Card className="mb-3">
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
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/stock/counts/${count.id}`}>
                {count.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5 font-mono">{count.locationCode}</td>
            <td className="px-2.5 py-1.5">
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
  const [items, setItems] = useState<Item[]>([]);
  const [foundItemId, setFoundItemId] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<CycleCount>(`/api/cycle-counts/${id}`), api<Item[]>("/api/items")])
      .then(([count, nextItems]) => {
        setActive(count);
        setItems(nextItems);
      })
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
            lines: (active.lines ?? [])
              .filter((line) => line.entered)
              .map((line) => ({
                id: line.id,
                countedQty: line.countedQty,
                weightGrams: parseWeightGrams(weights[line.id]),
              })),
          }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post count");
    }
  }

  async function addFound() {
    if (!active || !foundItemId) return;
    setError(null);
    try {
      setActive(
        await api<CycleCount>(`/api/cycle-counts/${id}/lines`, {
          method: "POST",
          body: JSON.stringify({ itemId: foundItemId }),
        }),
      );
      setFoundItemId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add SKU");
    }
  }

  if (!active) return <ErrorBanner error={error} />;

  const lines = active.lines ?? [];
  const blind = isBlindCount(active.status);
  const ready = canPostCount(active.status) && allLinesEntered(lines);

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Stock"
        title={active.number}
        description={
          blind
            ? `${active.locationCode || "Bay count"} · Blind — enter every SKU`
            : active.locationCode || "Bay count"
        }
        status={active.status}
        steps={COUNT_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/stock/counts")}>
              All counts
            </Button>
            {active.status === "draft" ? <Button onClick={() => void start()}>Start counting</Button> : null}
            {canPostCount(active.status) ? (
              <Button disabled={!ready} onClick={() => void post()}>
                {lines.length === 0 ? "Confirm empty" : "Post variances"}
              </Button>
            ) : null}
            <Button variant="secondary">
              <Link to={`/floor/count?id=${active.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      {canPostCount(active.status) ? (
        <Card>
          <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit(addFound)}>
            <Field label="Found SKU">
              <Select value={foundItemId} onChange={(e) => setFoundItemId(e.target.value)}>
                <option value="">Choose a SKU not on the snapshot</option>
                {items
                  .filter((item) => !(active.lines ?? []).some((line) => line.itemId === item.id))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Button type="submit" disabled={!foundItemId}>
              Add found SKU
            </Button>
          </form>
        </Card>
      ) : null}
      {canPostCount(active.status) && !ready && lines.length > 0 ? (
        <p className="text-sm text-muted-foreground">Enter every SKU (0 is a real count) before posting.</p>
      ) : null}
      <DocumentActivity refId={active.id} refreshKey={active.status} />
      {lines.length === 0 ? (
        <Card>
          <p className="text-sm">Nothing on the snapshot. Confirm the bay is empty, or add a SKU you found.</p>
        </Card>
      ) : (
        <Table columns={["SKU", "System", "Counted", "Weight", "Variance"]}>
          {lines.map((line) => (
            <tr key={line.id}>
              <td className="px-2.5 py-1.5">
                <span className="font-mono">{line.sku}</span> {line.itemName}
              </td>
              <td className="px-2.5 py-1.5 font-mono">{blind || line.systemQty === null ? "—" : line.systemQty}</td>
              <td className="px-2.5 py-1.5">
                <Input
                  type="number"
                  min={0}
                  placeholder="Count"
                  value={line.entered ? String(line.countedQty) : ""}
                  disabled={!canPostCount(active.status)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const countedQty = raw === "" ? 0 : Number(e.target.value);
                    setActive((current) =>
                      current
                        ? {
                            ...current,
                            lines: (current.lines ?? []).map((row) =>
                              row.id === line.id
                                ? { ...row, countedQty: Number.isFinite(countedQty) ? countedQty : 0, entered: raw !== "" }
                                : row,
                            ),
                          }
                        : current,
                    );
                  }}
                />
              </td>
              <td className="px-2.5 py-1.5">
                <CatchWeightInput
                  show={line.catchWeight}
                  value={weights[line.id] ?? (line.weightGrams != null ? String(line.weightGrams) : "")}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.id]: value }))}
                />
              </td>
              <td className="px-2.5 py-1.5 font-mono">
                {blind || line.systemQty === null
                  ? "—"
                  : formatCountVariance(countVariance(line.countedQty, line.systemQty))}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
