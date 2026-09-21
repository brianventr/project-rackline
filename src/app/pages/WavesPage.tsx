import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Wave, type WaveOpenOrder } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { WAVE_STEPS, canCompleteWave, canReleaseWave } from "@/domain/status";
import { useWarehouse, inWarehouse } from "../warehouse";

export function WavesPage() {
  const { id } = useParams();
  if (id) return <WaveDetail id={id} />;
  return <WaveList />;
}

function WaveList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [waves, setWaves] = useState<Wave[]>([]);
  const [openOrders, setOpenOrders] = useState<WaveOpenOrder[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"wave" | "batch">("wave");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    const [nextWaves, nextOpen] = await Promise.all([
      api<Wave[]>("/api/waves"),
      api<WaveOpenOrder[]>(`/api/waves-open-orders${query}`),
    ]);
    setWaves(nextWaves);
    setOpenOrders(nextOpen);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  function toggle(orderId: string) {
    setSelected((current) => (current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]));
  }

  async function create() {
    setError(null);
    try {
      const created = await api<Wave>("/api/waves", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          mode,
          notes: notes.trim() || undefined,
          orderIds: selected,
        }),
      });
      navigate(`/outbound/waves/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create wave");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Outbound"
        title="Waves"
        description="Group open orders into a wave or batch pick, release to the floor, then complete."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New wave"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-6 space-y-4">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Mode">
                <Select value={mode} onChange={(e) => setMode(e.target.value as "wave" | "batch")}>
                  <option value="wave">Wave (pick per order)</option>
                  <option value="batch">Batch (aggregate SKUs)</option>
                </Select>
              </Field>
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Open orders</p>
              <ul className="max-h-56 space-y-2 overflow-auto text-sm">
                {openOrders.map((order) => (
                  <li key={order.id}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggle(order.id)} />
                      <span className="font-mono">{order.number}</span>
                      <span className="text-muted-foreground">{order.customerName}</span>
                    </label>
                  </li>
                ))}
                {openOrders.length === 0 ? <li className="text-muted-foreground">No open orders without a wave.</li> : null}
              </ul>
            </div>
            <Button type="submit" disabled={selected.length === 0}>
              Create wave
            </Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Mode", "Orders", "Status"]}>
        {inWarehouse(waves, warehouseId).map((wave) => (
          <tr key={wave.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/outbound/waves/${wave.id}`}>
                {wave.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5 capitalize">{wave.mode}</td>
            <td className="px-2.5 py-1.5 font-mono">{wave.orderCount ?? wave.orders?.length ?? 0}</td>
            <td className="px-2.5 py-1.5">
              <StatusBadge status={wave.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function WaveDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [wave, setWave] = useState<Wave | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Wave>(`/api/waves/${id}`)
      .then(setWave)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function release() {
    setError(null);
    try {
      setWave(await api<Wave>(`/api/waves/${id}/release`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release wave");
    }
  }

  async function complete() {
    setError(null);
    try {
      setWave(await api<Wave>(`/api/waves/${id}/complete`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete wave");
    }
  }

  if (!wave) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Outbound"
        title={wave.number}
        description={`${wave.mode} · ${(wave.orders ?? []).length} orders${wave.notes ? ` · ${wave.notes}` : ""}`}
        status={wave.status}
        steps={WAVE_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/outbound/waves")}>
              All waves
            </Button>
            {canReleaseWave(wave.status) ? <Button onClick={() => void release()}>Release</Button> : null}
            {canCompleteWave(wave.status) ? <Button onClick={() => void complete()}>Complete</Button> : null}
            <Button variant="secondary" asChild>
              <Link to={`/floor/wave?id=${wave.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <DocumentActivity refId={wave.id} refreshKey={wave.status} />
          </DocumentRail>
        }
      >
        <Table columns={["Order", "Customer", "Status"]}>
          {(wave.orders ?? []).map((order) => (
            <tr key={order.id}>
              <td className="px-2.5 py-1.5 font-mono">
                <Link className="hover:underline" to={`/outbound/orders/${order.id}`}>
                  {order.number}
                </Link>
              </td>
              <td className="px-2.5 py-1.5">{order.customerName}</td>
              <td className="px-2.5 py-1.5">
                <StatusBadge status={order.status} />
              </td>
            </tr>
          ))}
        </Table>
        {wave.mode === "batch" ? (
          <div className="mt-6">
            <p className="mb-2 text-sm font-medium">Batch lines</p>
            <Table columns={["SKU", "Item", "Qty", "Picked", "Remaining"]}>
              {(wave.batchLines ?? []).map((line) => (
                <tr key={line.id}>
                  <td className="px-2.5 py-1.5 font-mono">{line.sku}</td>
                  <td className="px-2.5 py-1.5">{line.itemName}</td>
                  <td className="px-2.5 py-1.5 font-mono">{line.qty}</td>
                  <td className="px-2.5 py-1.5 font-mono">{line.qtyPicked}</td>
                  <td className="px-2.5 py-1.5 font-mono">{line.remaining}</td>
                </tr>
              ))}
            </Table>
          </div>
        ) : null}
      </DocumentFrame>
    </div>
  );
}
