import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Item, type Location, type Order, type WarehouseMapInfo, type Wave } from "../../api";
import { Button, Card, ErrorBanner, Input, PageHeader, Select } from "../../components/ui";
import { packSlipJobs, pickListJobs, shippingLabelJobs, wavePickListJobs } from "@/domain/print-station";
import { SCAN_PREFIX_CHEATSHEET } from "@/domain/barcodes";
import { usePrint, type PrinterRecord, type PrintStationRecord } from "../../print/PrintProvider";
import { useScanner } from "../../scanner/ScannerProvider";

type PrintJobRow = {
  id: string;
  kind: string;
  payloadFormat: string;
  status: string;
  error: string | null;
  createdAt: number;
};

export function LabelsSetupPage() {
  const printerCtx = usePrint();
  const scanner = useScanner();
  const [orders, setOrders] = useState<Order[]>([]);
  const [waves, setWaves] = useState<Wave[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseMapInfo[]>([]);
  const [jobs, setJobs] = useState<PrintJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [printerName, setPrinterName] = useState("Thermal 4x6");
  const [printerConnection, setPrinterConnection] = useState<"browser" | "qz" | "download">("download");
  const [printerMedia, setPrinterMedia] = useState<"letter" | "4x6" | "2x1">("4x6");
  const [qzName, setQzName] = useState("");

  const [stationName, setStationName] = useState("Pack bench");
  const [stationWarehouseId, setStationWarehouseId] = useState("");
  const [stationDefault, setStationDefault] = useState("");
  const [stationBay, setStationBay] = useState("");
  const [stationShipping, setStationShipping] = useState("");

  async function loadQueues() {
    const [nextOrders, nextWaves, nextItems, nextLocations, nextWarehouses, nextJobs] = await Promise.all([
      api<Order[]>("/api/orders"),
      api<Wave[]>("/api/waves").catch(() => [] as Wave[]),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
      api<WarehouseMapInfo[]>("/api/warehouses").catch(() => [] as WarehouseMapInfo[]),
      api<PrintJobRow[]>("/api/print-jobs?limit=20"),
    ]);
    setOrders(nextOrders);
    setWaves(nextWaves);
    setItems(nextItems);
    setLocations(nextLocations);
    setWarehouses(nextWarehouses);
    setJobs(nextJobs);
  }

  useEffect(() => {
    Promise.all([loadQueues(), printerCtx.refresh()])
      .catch((err: Error) => setError(err.message));
  }, []);

  const lists = [...pickListJobs(orders), ...wavePickListJobs(waves)];
  const slips = packSlipJobs(orders);
  const labels = shippingLabelJobs(orders);

  async function createPrinter() {
    setError(null);
    try {
      await api("/api/printers", {
        method: "POST",
        body: JSON.stringify({
          name: printerName,
          connection: printerConnection,
          media: printerMedia,
          dpi: 203,
          qzPrinterName: qzName || undefined,
          isDefault: printerCtx.printers.length === 0,
        }),
      });
      setMessage("Printer added");
      await printerCtx.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create printer");
    }
  }

  async function createStation() {
    setError(null);
    try {
      await api("/api/print-stations", {
        method: "POST",
        body: JSON.stringify({
          name: stationName,
          warehouseId: stationWarehouseId || null,
          defaultPrinterId: stationDefault || null,
          bayPrinterId: stationBay || null,
          shippingPrinterId: stationShipping || null,
        }),
      });
      setMessage("Station added");
      await printerCtx.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create station");
    }
  }

  async function removePrinter(id: string) {
    setError(null);
    try {
      await api(`/api/printers/${id}`, { method: "DELETE" });
      await printerCtx.refresh();
      await loadQueues();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete printer");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Printers"
        description="Register printers and stations. Floor Print and shipping labels follow this workstation binding."
        actions={
          <Button variant="secondary" asChild>
            <Link to="/floor/print">Floor print</Link>
          </Button>
        }
      />
      <ErrorBanner error={error} />
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <Card className="space-y-3">
        <p className="font-medium">This workstation</p>
        <p className="text-sm text-muted-foreground">{printerCtx.statusLabel}</p>
        <Select
          value={printerCtx.stationId ?? ""}
          onChange={(e) => printerCtx.setStationId(e.target.value || null)}
        >
          <option value="">Select a station…</option>
          {printerCtx.stations.map((station) => (
            <option key={station.id} value={station.id}>
              {station.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scanner.prefs.beep}
            onChange={(e) => scanner.setPrefs({ beep: e.target.checked })}
          />
          Beep on scan
        </label>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="space-y-3">
          <p className="font-medium">Printers</p>
          <ul className="space-y-2 text-sm">
            {printerCtx.printers.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{row.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {row.connection} · {row.media}
                    {row.isDefault ? " · default" : ""}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => void removePrinter(row.id)}>
                  Remove
                </Button>
              </li>
            ))}
            {printerCtx.printers.length === 0 ? <li className="text-muted-foreground">No printers yet.</li> : null}
          </ul>
          <Input value={printerName} onChange={(e) => setPrinterName(e.target.value)} placeholder="Printer name" />
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={printerConnection}
              onChange={(e) => setPrinterConnection(e.target.value as PrinterRecord["connection"])}
            >
              <option value="browser">Browser</option>
              <option value="download">ZPL download</option>
              <option value="qz">QZ Tray</option>
            </Select>
            <Select value={printerMedia} onChange={(e) => setPrinterMedia(e.target.value as PrinterRecord["media"])}>
              <option value="letter">Letter</option>
              <option value="4x6">4×6</option>
              <option value="2x1">2×1</option>
            </Select>
          </div>
          {printerConnection === "qz" ? (
            <Input value={qzName} onChange={(e) => setQzName(e.target.value)} placeholder="QZ printer name" />
          ) : null}
          <Button onClick={() => void createPrinter()}>Add printer</Button>
        </Card>

        <Card className="space-y-3">
          <p className="font-medium">Stations</p>
          <ul className="space-y-2 text-sm">
            {printerCtx.stations.map((station) => (
              <StationLine key={station.id} station={station} printers={printerCtx.printers} />
            ))}
            {printerCtx.stations.length === 0 ? <li className="text-muted-foreground">No stations yet.</li> : null}
          </ul>
          <Input value={stationName} onChange={(e) => setStationName(e.target.value)} placeholder="Station name" />
          <Select value={stationWarehouseId} onChange={(e) => setStationWarehouseId(e.target.value)}>
            <option value="">Any warehouse</option>
            {warehouses.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <PrinterPick label="Default" value={stationDefault} onChange={setStationDefault} printers={printerCtx.printers} />
          <PrinterPick label="Bay / SKU" value={stationBay} onChange={setStationBay} printers={printerCtx.printers} />
          <PrinterPick
            label="Shipping"
            value={stationShipping}
            onChange={setStationShipping}
            printers={printerCtx.printers}
          />
          <Button onClick={() => void createStation()}>Add station</Button>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="space-y-3">
          <p className="font-medium">Sheets</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link className="underline" to="/stock/locations?labels=1">
                Print bay labels
              </Link>
              <span className="text-muted-foreground"> · {locations.length} bays</span>
            </li>
            <li>
              <Link className="underline" to="/stock/items?labels=1">
                Print SKU labels
              </Link>
              <span className="text-muted-foreground"> · {items.length} items</span>
            </li>
            <li>
              <Link className="underline" to="/equipment?labels=1">
                Print equipment labels
              </Link>
            </li>
          </ul>
        </Card>
        <Card className="space-y-3">
          <p className="font-medium">Scan prefixes</p>
          <p className="text-sm text-muted-foreground">
            {SCAN_PREFIX_CHEATSHEET.map((prefix) => (
              <span key={prefix} className="mr-2 inline-block font-mono">
                {prefix}
              </span>
            ))}
          </p>
          <p className="text-sm text-muted-foreground">
            USB and Bluetooth guns work on every screen. Camera scan uses BarcodeDetector or ZXing fallback.
          </p>
        </Card>
      </div>

      <Card>
        <p className="mb-3 font-medium">Pick lists</p>
        <ul className="space-y-2 text-sm">
          {lists.map((job) => (
            <li key={job.href}>
              <Link className="font-mono underline" to={job.href}>
                {job.title}
              </Link>
              <span className="text-muted-foreground"> · {job.subtitle}</span>
            </li>
          ))}
          {lists.length === 0 ? <li className="text-muted-foreground">No open or picking tickets.</li> : null}
        </ul>
      </Card>
      <Card>
        <p className="mb-3 font-medium">Pack slips</p>
        <ul className="space-y-2 text-sm">
          {slips.map((job) => (
            <li key={job.href}>
              <Link className="font-mono underline" to={job.href}>
                {job.title}
              </Link>
              <span className="text-muted-foreground"> · {job.subtitle}</span>
            </li>
          ))}
          {slips.length === 0 ? <li className="text-muted-foreground">No orders far enough along to print a slip.</li> : null}
        </ul>
      </Card>
      <Card>
        <p className="mb-3 font-medium">Shipping labels</p>
        <ul className="space-y-2 text-sm">
          {labels.map((job) => (
            <li key={job.href}>
              <Link className="font-mono underline" to={job.href}>
                {job.title}
              </Link>
              <span className="text-muted-foreground"> · {job.subtitle}</span>
            </li>
          ))}
          {labels.length === 0 ? <li className="text-muted-foreground">No picked or packed orders.</li> : null}
        </ul>
      </Card>

      <Card>
        <p className="mb-3 font-medium">Recent print jobs</p>
        <ul className="space-y-2 text-sm">
          {jobs.map((job) => (
            <li key={job.id} className="flex justify-between gap-2">
              <span>
                <span className="font-mono">{job.kind}</span> · {job.payloadFormat} · {job.status}
                {job.error ? <span className="text-destructive"> · {job.error}</span> : null}
              </span>
              <span className="text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</span>
            </li>
          ))}
          {jobs.length === 0 ? <li className="text-muted-foreground">No jobs yet.</li> : null}
        </ul>
      </Card>
    </div>
  );
}

function PrinterPick({
  label,
  value,
  onChange,
  printers,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  printers: PrinterRecord[];
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {printers.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function StationLine({ station, printers }: { station: PrintStationRecord; printers: PrinterRecord[] }) {
  const nameFor = (id: string | null) => printers.find((row) => row.id === id)?.name || "—";
  return (
    <li>
      <span className="font-medium">{station.name}</span>
      <span className="text-muted-foreground">
        {" "}
        · default {nameFor(station.defaultPrinterId)} · bay {nameFor(station.bayPrinterId)} · ship{" "}
        {nameFor(station.shippingPrinterId)}
      </span>
    </li>
  );
}
