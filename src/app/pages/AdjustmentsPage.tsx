import { useEffect, useState } from "react";
import { api, type Item, type Location } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, onSubmit } from "../components/ui";

export function AdjustmentsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [qtyDelta, setQtyDelta] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<Item[]>("/api/items"), api<Location[]>("/api/locations")])
      .then(([nextItems, nextLocations]) => {
        setItems(nextItems);
        setLocations(nextLocations);
        if (nextItems[0]) setItemId(nextItems[0].id);
        if (nextLocations[0]) setLocationId(nextLocations[0].id);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function submit() {
    setError(null);
    setOk(null);
    try {
      await api("/api/adjustments", {
        method: "POST",
        body: JSON.stringify({
          itemId,
          locationId,
          qtyDelta: Number(qtyDelta),
          reason,
        }),
      });
      setReason("");
      setOk("Adjustment posted to the ledger.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjustment failed");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Floor"
        title="Adjust"
        description="Signed quantity change with a reason. Negative qty cannot drive a bin below zero."
      />
      <ErrorBanner error={error} />
      {ok ? <p className="mb-4 text-sm text-ok">{ok}</p> : null}
      <Card className="max-w-xl">
        <form className="space-y-3" onSubmit={onSubmit(submit)}>
          <Field label="Item">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} — {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Qty delta">
            <Input type="number" value={qtyDelta} onChange={(e) => setQtyDelta(e.target.value)} required />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cycle count variance" required />
          </Field>
          <Button type="submit">Post adjustment</Button>
        </form>
      </Card>
    </div>
  );
}
