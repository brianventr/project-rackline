import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Hold, type Item, type Location, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { useWarehouse } from "../../warehouse";
import { HOLD_REASONS, holdLabel } from "@/domain/holds";
import { canReleaseHold } from "@/domain/status";

export function FloorHoldPage() {
  const [params] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState<Hold | null>(null);
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [reason, setReason] = useState<(typeof HOLD_REASONS)[number]>("QC");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextHolds, nextLocations, nextItems] = await Promise.all([
      api<Hold[]>("/api/holds"),
      api<Location[]>("/api/locations"),
      api<Item[]>("/api/items"),
    ]);
    setHolds(nextHolds.filter((row) => canReleaseHold(row.status)));
    setLocations(nextLocations);
    setItems(nextItems);
    const storage = nextLocations.find((row) => row.type === "storage") ?? nextLocations[0];
    const locationWanted = params.get("location");
    const match = locationWanted
      ? nextLocations.find((row) => row.id === locationWanted)
      : storage;
    if (match) setLocationId(match.id);
    const itemWanted = params.get("item");
    if (itemWanted) setItemId(itemWanted);
    const wanted = params.get("id");
    if (wanted) setActive(await api<Hold>(`/api/holds/${wanted}`));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const selectedItem = items.find((item) => item.id === itemId);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then(async (hit) => {
          if (hit.kind === "hold") {
            setActive(await api<Hold>(`/api/holds/${hit.hold.id}`));
            return;
          }
          if (hit.kind === "location") {
            setLocationId(hit.location.id);
            setActive(null);
            return;
          }
          if (hit.kind === "item") {
            setItemId(hit.item.id);
            return;
          }
          setError("Scan a bay, a SKU, or a hold.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [],
  );

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
        }),
      });
      setActive(created);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place hold");
    }
  }

  async function release() {
    if (!active) return;
    setError(null);
    try {
      setActive(await api<Hold>(`/api/holds/${active.id}/release`, { method: "POST" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release hold");
    }
  }

  const location = locations.find((row) => row.id === locationId);

  return (
    <FloorFrame
      title="Hold"
      description="Scan a bay to lock it. Scan a SKU to lock only that item. Pick, replenish, kit, and move skip held stock."
      error={error}
    >
      <FloorScanBox label="Scan bay, SKU, or hold" placeholder="A-01-02 or LED-BULB" onScan={onScan} />
      {active ? (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {holdLabel(active)} · {active.reason}
          </p>
          {canReleaseHold(active.status) ? (
            <Button onClick={() => void release()}>Release</Button>
          ) : (
            <p>Released.</p>
          )}
          <Button variant="ghost" onClick={() => setActive(null)}>
            Place another
          </Button>
        </Card>
      ) : (
        <Card className="space-y-3">
          <Field label="Bay">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="SKU (optional)">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Whole bay</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku}
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
          <Button onClick={() => void place()}>Place hold{location ? ` on ${location.code}` : ""}</Button>
          <ul className="space-y-2 text-sm">
            {holds.map((row) => (
              <li key={row.id}>
                <button onClick={() => void api<Hold>(`/api/holds/${row.id}`).then(setActive)}>
                  {row.number} · {holdLabel(row)} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </FloorFrame>
  );
}
