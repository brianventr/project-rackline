import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type Item, type Me } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";
import { formatExpiresOn } from "@/domain/expiry";
import { formatAsBuiltPart } from "@/domain/as-built";
import { SkuHandlers } from "./LaborPage";
import { usePrint } from "../print/PrintProvider";

const types = ["raw", "wip", "finished", "packaging"];

export function ItemsPage({ me }: { me: Me }) {
  const { id } = useParams();
  if (id) return <ItemDetail me={me} id={id} />;
  return <ItemList />;
}

function ItemList() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("raw");
  const [barcode, setBarcode] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [baselineShipRate, setBaselineShipRate] = useState("");
  const [pickMin, setPickMin] = useState("0");
  const [trackLot, setTrackLot] = useState(false);
  const [trackSerial, setTrackSerial] = useState(false);
  const [catchWeight, setCatchWeight] = useState(false);
  const [trackExpiry, setTrackExpiry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState(params.get("labels") === "1");
  const [ready, setReady] = useState(false);
  const printer = usePrint();

  async function load() {
    setItems(await api<Item[]>("/api/items"));
  }

  useEffect(() => {
    load()
      .then(() => setReady(true))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<Item>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          sku,
          name,
          type,
          barcode: barcode || sku,
          reorderPoint: Number(reorderPoint),
          baselineShipRate: baselineShipRate === "" ? null : Number(baselineShipRate),
          pickMin: Number(pickMin),
          trackLot,
          trackSerial,
          catchWeight,
          trackExpiry,
        }),
      });
      setSku("");
      setName("");
      setBarcode("");
      setReorderPoint("0");
      setBaselineShipRate("");
      setPickMin("0");
      setTrackLot(false);
      setTrackSerial(false);
      setCatchWeight(false);
      navigate(`/stock/items/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create item");
    }
  }

  if (labels) {
    return (
      <div>
        <PageHeader
          eyebrow="SKU labels"
          title="Print item barcodes"
          description="Tape these on totes, bags, and finished goods. Scanning the SKU is enough to look up stock."
          actions={
            <div className="flex gap-2 print:hidden">
              <Button
                variant="ghost"
                onClick={() => {
                  setLabels(false);
                  navigate("/stock/items");
                }}
              >
                Back
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void printer
                    .print({
                      kind: "sheet",
                      title: "sku-labels",
                      forceConnection: "download",
                      data: {
                        labelsJson: JSON.stringify(
                          items.map((item) => ({
                            kind: "item",
                            sku: item.sku,
                            name: item.name,
                            barcode: item.barcode || item.sku,
                          })),
                        ),
                      },
                    })
                    .then((result) => {
                      if (!result.ok) setError(result.message);
                    });
                }}
              >
                Download ZPL
              </Button>
              <Button onClick={() => window.print()}>Print</Button>
            </div>
          }
        />
        <ErrorBanner error={error} />
        {!ready ? <p className="text-sm text-muted-foreground">Loading labels…</p> : null}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="break-inside-avoid rounded-xl border border-line bg-card p-3">
              <p className="font-mono text-sm font-semibold">{item.sku}</p>
              <p className="text-xs text-muted-foreground">{item.name}</p>
              <BarcodeLabel value={item.barcode || item.sku} className="mt-2 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow="Stock" title="Items" description="Raw materials, WIP, packaging, and finished goods. Each SKU has a barcode."
        actions={
          <Button variant="ghost" onClick={() => setLabels(true)}>
            Print labels
          </Button>
        }
      />
      <ErrorBanner error={error} />
      <Card className="mb-3">
        <form className="grid gap-3 md:grid-cols-6" onSubmit={onSubmit(create)}>
          <Field label="SKU">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} required />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Barcode">
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Defaults to SKU" />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reorder point">
            <Input type="number" min={0} value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
          </Field>
          <Field label="Baseline / day">
            <Input
              type="number"
              min={0}
              step="0.1"
              value={baselineShipRate}
              onChange={(e) => setBaselineShipRate(e.target.value)}
              placeholder="Auto from ships"
            />
          </Field>
          <Field label="Pick min">
            <Input type="number" min={0} value={pickMin} onChange={(e) => setPickMin(e.target.value)} />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={trackLot} onChange={(e) => setTrackLot(e.target.checked)} />
            Lots
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={trackSerial} onChange={(e) => setTrackSerial(e.target.checked)} />
            Serials
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={catchWeight} onChange={(e) => setCatchWeight(e.target.checked)} />
            Catch-weight
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={trackExpiry} onChange={(e) => setTrackExpiry(e.target.checked)} />
            Expiry
          </label>
          <div className="flex items-end">
            <Button type="submit">Add item</Button>
          </div>
        </form>
      </Card>
      <Table columns={["SKU", "Barcode", "Name", "Type", "Reorder", "Baseline / day", "Pick min"]}>
        {items.map((item) => (
          <tr key={item.id}>
            <td className="px-2.5 py-1.5 font-mono text-sm">
              <Link className="hover:underline" to={`/stock/items/${item.id}`}>
                {item.sku}
              </Link>
            </td>
            <td className="px-2.5 py-1.5 font-mono text-sm">{item.barcode}</td>
            <td className="px-2.5 py-1.5">{item.name}</td>
            <td className="px-2.5 py-1.5 capitalize">{item.type}</td>
            <td className="px-2.5 py-1.5">{item.reorderPoint}</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums">
              {item.baselineShipRate != null && item.baselineShipRate > 0 ? item.baselineShipRate : "auto"}
            </td>
            <td className="px-2.5 py-1.5">{item.pickMin ?? 0}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ItemDetail({ me, id }: { me: Me; id: string }) {
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [baselineShipRate, setBaselineShipRate] = useState("");
  const [pickMin, setPickMin] = useState("0");
  const [trackLot, setTrackLot] = useState(false);
  const [trackSerial, setTrackSerial] = useState(false);
  const [catchWeight, setCatchWeight] = useState(false);
  const [trackExpiry, setTrackExpiry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Item>(`/api/items/${id}`)
      .then((next) => {
        setItem(next);
        setName(next.name);
        setBarcode(next.barcode);
        setReorderPoint(String(next.reorderPoint ?? 0));
        setBaselineShipRate(next.baselineShipRate != null && next.baselineShipRate > 0 ? String(next.baselineShipRate) : "");
        setPickMin(String(next.pickMin ?? 0));
        setTrackLot(Boolean(next.trackLot));
        setTrackSerial(Boolean(next.trackSerial));
        setCatchWeight(Boolean(next.catchWeight));
        setTrackExpiry(Boolean(next.trackExpiry));
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function save() {
    setError(null);
    try {
      setItem(
        await api<Item>(`/api/items/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            barcode,
            reorderPoint: Number(reorderPoint),
            baselineShipRate: baselineShipRate === "" ? null : Number(baselineShipRate),
            pickMin: Number(pickMin),
            trackLot,
            trackSerial,
            catchWeight,
            trackExpiry,
          }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update item");
    }
  }

  async function remove() {
    setError(null);
    try {
      await api(`/api/items/${id}`, { method: "DELETE" });
      navigate("/stock/items");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete item");
    }
  }

  if (!item) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Stock"
        title={item.sku}
        description={item.name}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/stock/items")}>
              All items
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print label
            </Button>
            <Button onClick={() => void save()}>Save</Button>
            {me.role === "owner" ? (
              <Button variant="danger" onClick={() => void remove()}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorBanner error={error} />
      <div className="max-w-sm rounded-lg border p-3">
        <BarcodeLabel value={item.barcode || item.sku} className="mx-auto h-16" />
      </div>
      <Card className="grid gap-3 md:grid-cols-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Barcode">
          <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </Field>
        <Field label="Reorder point">
          <Input type="number" min={0} value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
        </Field>
        <Field label="Baseline / day">
          <Input
            type="number"
            min={0}
            step="0.1"
            value={baselineShipRate}
            onChange={(e) => setBaselineShipRate(e.target.value)}
            placeholder="Auto from ships"
          />
        </Field>
        <Field label="Pick min">
          <Input type="number" min={0} value={pickMin} onChange={(e) => setPickMin(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={trackLot} onChange={(e) => setTrackLot(e.target.checked)} />
          Track lots
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={trackSerial} onChange={(e) => setTrackSerial(e.target.checked)} />
          Track serials
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={catchWeight} onChange={(e) => setCatchWeight(e.target.checked)} />
          Catch-weight
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={trackExpiry} onChange={(e) => setTrackExpiry(e.target.checked)} />
          Track expiry
        </label>
      </Card>
      <Table columns={["Location", "On hand", "Allocated", "ATP"]}>
        {(item.onHand ?? []).map((row) => (
          <tr key={row.locationId}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/stock/locations/${row.locationId}`}>
                {row.locationCode}
              </Link>
            </td>
            <td className="px-2.5 py-1.5 font-mono">{row.qty}</td>
            <td className="px-2.5 py-1.5 font-mono">{row.allocated ?? 0}</td>
            <td className="px-2.5 py-1.5 font-mono">{row.atp ?? row.qty}</td>
          </tr>
        ))}
      </Table>
      {(item.lots ?? []).length ? (
        <Table columns={["Location", "Lot", "Expiry", "Qty"]}>
          {(item.lots ?? []).map((row) => (
            <tr key={`${row.locationId}:${row.lotCode}`}>
              <td className="px-2.5 py-1.5 font-mono">{row.locationCode}</td>
              <td className="px-2.5 py-1.5 font-mono">{row.lotCode}</td>
              <td className="px-2.5 py-1.5 font-mono text-xs">{formatExpiresOn(row.expiresOn)}</td>
              <td className="px-2.5 py-1.5 font-mono">{row.qty}</td>
            </tr>
          ))}
        </Table>
      ) : null}
      {(item.serials ?? []).length ? (
        <Table columns={["Serial", "Status", "Location", "Built from"]}>
          {(item.serials ?? []).map((row) => (
            <tr key={row.serialCode}>
              <td className="px-2.5 py-1.5 font-mono">{row.serialCode}</td>
              <td className="px-2.5 py-1.5">{row.status}</td>
              <td className="px-2.5 py-1.5 font-mono">{row.locationCode || "—"}</td>
              <td className="px-2.5 py-1.5 font-mono text-xs">
                {(row.builtFrom ?? []).length
                  ? (row.builtFrom ?? [])
                      .map((link) =>
                        formatAsBuiltPart({
                          sku: link.componentSku,
                          lotCode: link.componentLotCode,
                          serial: link.componentSerial,
                          qty: link.qty,
                        }),
                      )
                      .join(" · ")
                  : "—"}
              </td>
            </tr>
          ))}
        </Table>
      ) : null}
      <SkuHandlers itemId={item.id} linkStaff={me.role === "owner"} />
    </div>
  );
}
