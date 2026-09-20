import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Order, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { canPickOrder, canStartPick, canCancelOrder, canUnpickOrder } from "@/domain/status";
import { hasUnpicked } from "@/domain/partial-pick";
import { remainingToUnpick } from "@/domain/partial-unpick";

export function FloorPickPage() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [unpickQtys, setUnpickQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function applyOrder(order: Order, nextLocations: Location[]) {
    setActive(order);
    setLocationId(defaultPickLocation(order, nextLocations));
    setQtys(qtyDefaults(order));
    setUnpickQtys(unpickQtyDefaults(order));
  }

  async function load() {
    const [nextOrders, nextLocations] = await Promise.all([
      api<Order[]>("/api/orders"),
      api<Location[]>("/api/locations"),
    ]);
    setOrders(
      nextOrders.filter((row) => {
        const lines = row.lines ?? [];
        const stillToPick = hasUnpicked(
          lines.map((line) => ({
            lineId: line.id,
            sku: line.sku,
            qtyOrdered: line.qty,
            qtyPicked: line.qtyPicked ?? 0,
          })),
        );
        const stillToUnpick = lines.some(
          (line) =>
            remainingToUnpick({
              lineId: line.id,
              sku: line.sku,
              qtyPicked: line.qtyPicked ?? 0,
              qtyPacked: line.qtyPacked ?? 0,
            }) > 0,
        );
        return (canPickOrder(row.status) && stillToPick) || (canUnpickOrder(row.status) && stillToUnpick);
      }),
    );
    setLocations(nextLocations);
    const wanted = params.get("id");
    if (wanted) {
      const match = await api<Order>(`/api/orders/${wanted}`);
      applyOrder(match, nextLocations);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((hit) => {
          if (hit.kind === "order") {
            void api<Order>(`/api/orders/${hit.order.id}`).then((order) => applyOrder(order, locations));
            return;
          }
          if (hit.kind === "location") {
            setLocationId(hit.location.id);
            return;
          }
          if (hit.kind === "item" && active) {
            const line = (active.lines ?? []).find((row) => row.itemId === hit.item.id || row.sku === hit.item.sku);
            if (!line) {
              setError(`${hit.item.sku} is not on this order.`);
              return;
            }
            if (line.suggestedLocation) setLocationId(line.suggestedLocation.locationId);
            setQtys((current) => ({ ...current, [line.id]: String(line.remaining ?? 0) }));
            return;
          }
          setError("Scan an order, a pick bay, or a SKU on the ticket.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [locations, active],
  );

  async function pick() {
    if (!active) return;
    setError(null);
    try {
      if (canStartPick(active.status)) {
        const started = await api<Order>(`/api/orders/${active.id}/start`, { method: "POST" });
        applyOrder(started, locations);
      }
      const lines = (active.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(qtys[line.id] || 0),
          lotCode: lots[line.id] || undefined,
          serials: serials[line.id] || undefined,
          weightGrams: parseWeightGrams(weights[line.id]),
        }))
        .filter((line) => line.qty > 0);
      const picked = await api<Order>(`/api/orders/${active.id}/pick`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      applyOrder(picked, locations);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick failed");
    }
  }

  async function unpick() {
    if (!active) return;
    setError(null);
    try {
      const lines = (active.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(unpickQtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Order>(`/api/orders/${active.id}/unpick`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      applyOrder(next, locations);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unpick failed");
    }
  }

  async function cancel() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<Order>(`/api/orders/${active.id}/cancel`, { method: "POST" });
      applyOrder(next, locations);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  const remaining = active
    ? hasUnpicked(
        (active.lines ?? []).map((line) => ({
          lineId: line.id,
          sku: line.sku,
          qtyOrdered: line.qty,
          qtyPicked: line.qtyPicked ?? 0,
        })),
      )
    : false;
  const thisPick = Object.values(qtys).some((value) => Number(value) > 0);
  const thisUnpick = Object.values(unpickQtys).some((value) => Number(value) > 0);
  const unpickable = (active?.lines ?? []).some((line) => (line.unpickRemaining ?? 0) > 0);

  return (
    <FloorFrame title="Pick" description="Scan the order, go to the suggested bay, pick remaining qty, or unpick back onto the bay." error={error}>
      <FloorScanBox label="Scan order, bay, or SKU" placeholder="ORD-DEMO1, B-01-01, or LAMP" onScan={onScan} />
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open orders</p>
          <ul className="space-y-2 text-sm">
            {orders.map((row) => (
              <li key={row.id}>
                <button
                  className="w-full text-left"
                  onClick={() => {
                    void api<Order>(`/api/orders/${row.id}`).then((order) => applyOrder(order, locations));
                  }}
                >
                  <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {orders.length === 0 ? <li className="text-muted-foreground">Nothing to pick.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>{active.customerName}</p>
          <ul className="space-y-3 text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="flex justify-between gap-3">
                  <span>
                    {line.sku} × {line.qty}
                    {line.qtyPicked ? <span className="text-muted-foreground"> · picked {line.qtyPicked}</span> : null}
                    {(line.allocations ?? []).length ? (
                      <span className="block text-xs text-muted-foreground">
                        Allocated {(line.allocations ?? []).map((row) => `${row.locationCode} ×${row.qty}`).join(", ")}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="font-mono text-xs underline-offset-4 hover:underline"
                    onClick={() => {
                      if (line.suggestedLocation) setLocationId(line.suggestedLocation.locationId);
                    }}
                  >
                    {line.suggestedLocation ? line.suggestedLocation.locationCode : line.remaining > 0 ? "no stock" : "done"}
                  </button>
                </div>
                {line.remaining > 0 ? (
                  <Field label={`This pick (remaining ${line.remaining})`}>
                    <Input
                      type="number"
                      min={0}
                      max={line.remaining}
                      value={qtys[line.id] ?? "0"}
                      onChange={(e) => setQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  </Field>
                ) : (
                  <p className="text-muted-foreground">Picked</p>
                )}
                {(line.unpickRemaining ?? 0) > 0 ? (
                  <Field label={`This unpick (remaining ${line.unpickRemaining})`}>
                    <Input
                      type="number"
                      min={0}
                      max={line.unpickRemaining}
                      value={unpickQtys[line.id] ?? "0"}
                      onChange={(e) => setUnpickQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  </Field>
                ) : null}
                {line.trackLot ? (
                  <Input
                    placeholder="Lot code"
                    value={lots[line.id] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial ? (
                  <Input
                    placeholder="Serials"
                    value={serials[line.id] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  show={line.catchWeight}
                  value={weights[line.id] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.id]: value }))}
                />
              </li>
            ))}
          </ul>
          <Field label="Bay">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            {canPickOrder(active.status) && remaining ? (
              <Button disabled={!thisPick} onClick={() => void pick()}>
                Pick from bay
              </Button>
            ) : null}
            {canUnpickOrder(active.status) && unpickable ? (
              <Button variant="secondary" disabled={!thisUnpick} onClick={() => void unpick()}>
                Unpick to bay
              </Button>
            ) : null}
            {canCancelOrder(active.status) ? (
              <Button variant="secondary" onClick={() => void cancel()}>
                Cancel order
              </Button>
            ) : null}
            {!remaining && !unpickable ? (
              <div className="flex flex-wrap gap-4">
                <Link className="font-medium underline" to={`/floor/pack?id=${active.id}`}>
                  Go pack
                </Link>
                <Link className="font-medium underline" to={`/outbound/orders/${active.id}/pack-slip`}>
                  Pack slip
                </Link>
              </div>
            ) : null}
          </div>
        </Card>
      )}
    </FloorFrame>
  );
}

function qtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.remaining ?? 0)]));
}

function unpickQtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.unpickRemaining ?? 0)]));
}

function defaultPickLocation(order: Order, locations: Location[]): string {
  const remaining = (order.lines ?? []).find((line) => (line.remaining ?? 0) > 0);
  return (
    remaining?.suggestedLocation?.locationId ||
    order.pickLocationId ||
    locations.find((row) => row.slotRole === "pick")?.id ||
    locations.find((row) => row.type === "storage")?.id ||
    locations[0]?.id ||
    ""
  );
}
