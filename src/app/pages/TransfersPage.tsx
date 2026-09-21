import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Location, type Transfer } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { TRANSFER_STEPS, canPostTransfer } from "@/domain/status";
import { hasUnmoved } from "@/domain/partial-transfer";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields } from "./ReceiptsPage";

type Line = { itemId: string; qty: string };

export function TransfersPage() {
  const { id } = useParams();
  if (id) return <TransferDetail id={id} />;
  return <TransferList />;
}

function TransferList() {
  const navigate = useNavigate();
  const { warehouseId, warehouses } = useWarehouse();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextTransfers, nextItems, nextLocations] = await Promise.all([
      api<Transfer[]>("/api/transfers"),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
    ]);
    setTransfers(nextTransfers);
    setItems(nextItems);
    setLocations(nextLocations);
    const fromPool = inWarehouse(nextLocations, warehouseId);
    const recv = fromPool.find((location) => location.type === "receiving") ?? fromPool[0] ?? nextLocations[0];
    const bulk =
      nextLocations.find((location) => location.slotRole === "bulk") ??
      nextLocations.find((location) => location.type === "storage") ??
      nextLocations[1];
    if (recv) setFromLocationId(recv.id);
    if (bulk) setToLocationId(bulk.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  const fromLocations = inWarehouse(locations, warehouseId);
  const warehouseName = (id: string) => warehouses.find((row) => row.id === id)?.name ?? id;

  async function create() {
    setError(null);
    try {
      const created = await api<Transfer>("/api/transfers", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          fromLocationId,
          toLocationId,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      navigate(`/inbound/putaway/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create transfer");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inbound"
        title="Putaway"
        description="Documented bin-to-bin moves. Destination can be any warehouse. Scan-to-move lives on the floor."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link to="/floor/putaway">Scan move</Link>
            </Button>
            <Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New putaway"}</Button>
          </div>
        }
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-3">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="From">
                <Select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
                  {fromLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To (any warehouse)">
                <Select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.warehouseName || warehouseName(location.warehouseId)} · {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <LineFields items={items} lines={lines} setLines={setLines} />
            <Button type="submit">Create putaway</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "From", "To", "To WH", "Lines", "Status"]}>
        {inWarehouse(transfers, warehouseId).map((transfer) => (
          <tr key={transfer.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/inbound/putaway/${transfer.id}`}>
                {transfer.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5 font-mono">{transfer.fromCode}</td>
            <td className="px-2.5 py-1.5 font-mono">{transfer.toCode}</td>
            <td className="px-2.5 py-1.5 text-sm text-muted-foreground">
              {(() => {
                if (transfer.toWarehouseId) return warehouseName(transfer.toWarehouseId);
                const toLoc = locations.find((row) => row.id === transfer.toLocationId);
                if (toLoc && toLoc.warehouseId !== transfer.warehouseId) {
                  return toLoc.warehouseName || warehouseName(toLoc.warehouseId);
                }
                return "—";
              })()}
            </td>
            <td className="px-2.5 py-1.5 text-sm">{summarizeLines(transfer.lines)}</td>
            <td className="px-2.5 py-1.5">
              <StatusBadge status={transfer.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function TransferDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { warehouses } = useWarehouse();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [moveQtys, setMoveQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function applyTransfer(next: Transfer) {
    setTransfer(next);
    setMoveQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.id, String(line.remaining ?? 0)])));
  }

  useEffect(() => {
    Promise.all([api<Transfer>(`/api/transfers/${id}`), api<Location[]>("/api/locations")])
      .then(([next, nextLocations]) => {
        applyTransfer(next);
        setLocations(nextLocations);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    setError(null);
    try {
      applyTransfer(await api<Transfer>(`/api/transfers/${id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    }
  }

  async function post() {
    setError(null);
    try {
      const lines = (transfer?.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(moveQtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      applyTransfer(await api<Transfer>(`/api/transfers/${id}/post`, { method: "POST", body: JSON.stringify({ lines }) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post");
    }
  }

  if (!transfer) return <ErrorBanner error={error} />;

  const remaining = hasUnmoved(
    (transfer.lines ?? []).map((line) => ({
      lineId: line.id,
      sku: line.sku,
      qtyExpected: line.qty,
      qtyMoved: line.qtyMoved ?? 0,
    })),
  );
  const thisMove = Object.values(moveQtys).some((value) => Number(value) > 0);
  const toLoc = locations.find((row) => row.id === transfer.toLocationId);
  const toWhId = transfer.toWarehouseId || (toLoc && toLoc.warehouseId !== transfer.warehouseId ? toLoc.warehouseId : null);
  const toWh = toWhId ? warehouses.find((row) => row.id === toWhId)?.name ?? toLoc?.warehouseName ?? toWhId : null;

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Putaway"
        title={transfer.number}
        description={`${transfer.fromCode ?? transfer.fromLocationId} → ${transfer.toCode ?? transfer.toLocationId}${toWh ? ` · to ${toWh}` : ""}`}
        status={transfer.status}
        steps={TRANSFER_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/inbound/putaway")}>
              All putaway
            </Button>
            {transfer.status === "draft" ? <Button onClick={() => void start()}>Start</Button> : null}
            {canPostTransfer(transfer.status) && remaining ? (
              <Button disabled={!thisMove} onClick={() => void post()}>
                Post
              </Button>
            ) : null}
            <Button variant="secondary" asChild>
              <Link to={`/floor/putaway?id=${transfer.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <DocumentActivity
              refId={transfer.id}
              refreshKey={`${transfer.status}:${(transfer.lines ?? []).map((line) => line.qtyMoved).join(",")}`}
            />
          </DocumentRail>
        }
      >
        <Table columns={["SKU", "Item", "Expected", "Moved", "This move"]}>
          {(transfer.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-2.5 py-1.5 font-mono">{line.sku}</td>
              <td className="px-2.5 py-1.5">{line.itemName}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qty}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyMoved ?? 0}</td>
              <td className="px-2.5 py-1.5">
                {(line.remaining ?? 0) > 0 ? (
                  <Input
                    type="number"
                    min={0}
                    max={line.remaining}
                    value={moveQtys[line.id] ?? "0"}
                    onChange={(e) => setMoveQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : (
                  <span className="text-muted-foreground">Done</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </DocumentFrame>
    </div>
  );
}
