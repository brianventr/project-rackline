import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Hold, type Item, type Location } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";
import { DocumentHeader, DocumentActivity } from "../components/document";
import { HOLD_STEPS, canReleaseHold } from "@/domain/status";
import { HOLD_REASONS, holdLabel } from "@/domain/holds";
import { useWarehouse, inWarehouse } from "../warehouse";

export function HoldsPage() {
  const { id } = useParams();
  if (id) return <HoldDetail id={id} />;
  return <HoldList />;
}

function HoldList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [reason, setReason] = useState<(typeof HOLD_REASONS)[number]>("QC");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextHolds, nextLocations, nextItems] = await Promise.all([
      api<Hold[]>("/api/holds"),
      api<Location[]>("/api/locations"),
      api<Item[]>("/api/items"),
    ]);
    setHolds(nextHolds);
    setLocations(nextLocations);
    setItems(nextItems);
    const storage = nextLocations.find((location) => location.type === "storage") ?? nextLocations[0];
    if (storage) setLocationId(storage.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const selectedItem = items.find((item) => item.id === itemId);

  async function place() {
    setError(null);
    try {
      const created = await api<Hold>("/api/holds", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          locationId,
          itemId: itemId || undefined,
          lotCode: lotCode.trim() || undefined,
          reason,
          notes: notes.trim() || undefined,
        }),
      });
      navigate(`/stock/holds/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place hold");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Stock"
        title="Holds"
        description="Lock a bay, a SKU in a bay, or a lot so pick, replenish, kit, and move skip it. Qty stays on the ledger until you release."
      />
      <ErrorBanner error={error} />
      <Card className="mb-3">
        <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit(place)}>
          <Field label="Location">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="SKU (optional)">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Whole bay</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} — {item.name}
                </option>
              ))}
            </Select>
          </Field>
          {selectedItem?.trackLot ? (
            <Field label="Lot (optional)">
              <Input value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="LOT-…" />
            </Field>
          ) : null}
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value as (typeof HOLD_REASONS)[number])}>
              {HOLD_REASONS.map((row) => (
                <option key={row} value={row}>
                  {row}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Place hold</Button>
          </div>
        </form>
      </Card>
      <Table columns={["Number", "Scope", "Reason", "Status"]}>
        {inWarehouse(holds, warehouseId).map((hold) => (
          <tr key={hold.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/stock/holds/${hold.id}`}>
                {hold.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5 font-mono">{holdLabel(hold)}</td>
            <td className="px-2.5 py-1.5">{hold.reason}</td>
            <td className="px-2.5 py-1.5">
              <StatusBadge status={hold.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function HoldDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [active, setActive] = useState<Hold | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Hold>(`/api/holds/${id}`)
      .then(setActive)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function release() {
    if (!active) return;
    setError(null);
    try {
      setActive(await api<Hold>(`/api/holds/${id}/release`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release hold");
    }
  }

  if (!active) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Stock"
        title={active.number}
        description={`${holdLabel(active)} · ${active.reason}`}
        status={active.status}
        steps={HOLD_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/stock/holds")}>
              All holds
            </Button>
            {canReleaseHold(active.status) ? <Button onClick={() => void release()}>Release</Button> : null}
            <Button variant="secondary">
              <Link to={`/floor/hold?id=${active.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      {active.notes ? <Card><p className="text-sm">{active.notes}</p></Card> : null}
      <DocumentActivity refId={active.id} refreshKey={active.status} />
    </div>
  );
}
