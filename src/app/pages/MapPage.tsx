import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type MapLocation, type Me, type ScanHit, type WarehouseMapData } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { WarehouseMap, type MapView } from "../components/WarehouseMap";
import { Button, Card, ErrorBanner, PageHeader } from "../components/ui";
import { useScanner } from "../scanner/ScannerProvider";
import { groupFloorObjects, objectForLocation } from "@/domain/rack-builder";

const FloorBuilder = lazy(() =>
  import("../components/warehouse-scene/FloorBuilder").then((mod) => ({ default: mod.FloorBuilder })),
);
const WarehouseScene = lazy(() =>
  import("../components/warehouse-scene/WarehouseScene").then((mod) => ({ default: mod.WarehouseScene })),
);

export function MapPage({ me }: { me: Me }) {
  const [params] = useSearchParams();
  const [data, setData] = useState<WarehouseMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<MapView>(params.get("edit") ? "build" : "floor");
  const [levelFilter, setLevelFilter] = useState<"all" | number>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scanner = useScanner();
  const handledAt = useMemo(() => ({ current: 0 }), []);

  async function load() {
    const next = await api<WarehouseMapData>("/api/map");
    setData(next);
    return next;
  }

  useEffect(() => {
    load()
      .then((next) => {
        const wanted = params.get("location") || params.get("code");
        if (!wanted) return;
        const match = next.locations.find(
          (row) => row.id === wanted || row.code === wanted.toUpperCase() || row.barcode === wanted.toUpperCase(),
        );
        if (match) setSelectedId(match.id);
      })
      .catch((err: Error) => setError(err.message));
  }, [params]);

  useEffect(() => {
    const scan = scanner.lastScan;
    if (!scan || scan.at === handledAt.current) return;
    handledAt.current = scan.at;
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(scan.raw)}`)
      .then((hit) => {
        if (hit.kind === "location") setSelectedId(hit.location.id);
        else if (hit.onHand[0]) setSelectedId(hit.onHand[0].locationId);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [scanner.lastScan, handledAt]);

  const selected = data?.locations.find((row) => row.id === selectedId) ?? null;
  const levels = useMemo(() => {
    const set = new Set(data?.locations.map((row) => row.level) ?? []);
    return [...set].sort((a, b) => a - b);
  }, [data]);

  async function reposition(locationId: string, posX: number, posY: number) {
    setError(null);
    try {
      const object = data ? objectForLocation(groupFloorObjects(data.locations), locationId) : null;
      const location = data?.locations.find((row) => row.id === locationId);
      if (data && object?.kind === "rack" && location) {
        await api("/api/layout/racks", {
          method: "PATCH",
          body: JSON.stringify({
            warehouseId: data.warehouse.id,
            fromAisle: object.aisle,
            fromRack: object.rack,
            ...object.spec,
            posX: object.spec.posX + (posX - location.posX),
            posY: object.spec.posY + (posY - location.posY),
          }),
        });
      } else {
        await api(`/api/locations/${locationId}`, {
          method: "PATCH",
          body: JSON.stringify({ posX, posY }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move that bay on the map");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Floor geometry"
        title="Rack & area map"
        description="Every bin is a physical bay. Click a rack to see on-hand, or scan a location barcode to jump there."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant={view === "floor" ? "primary" : "ghost"} onClick={() => { setView("floor"); setError(null); }}>
              Floor plan
            </Button>
            <Button variant={view === "iso" ? "primary" : "ghost"} onClick={() => { setView("iso"); setError(null); }}>
              3D racks
            </Button>
            {me.role === "owner" ? (
              <Button variant={view === "build" ? "primary" : "ghost"} onClick={() => { setView("build"); setError(null); }}>
                Build floor
              </Button>
            ) : null}
            <Button variant="secondary" onClick={scanner.openCamera}>
              Scan bay
            </Button>
          </div>
        }
      />
      <ErrorBanner error={error} />
      {view !== "build" ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Level</span>
          <button
            className={`rounded-full px-3 py-1 ${levelFilter === "all" ? "bg-ink text-paper" : "bg-card border border-line"}`}
            onClick={() => setLevelFilter("all")}
          >
            All
          </button>
          {levels.map((level) => (
            <button
              key={level}
              className={`rounded-full px-3 py-1 ${levelFilter === level ? "bg-ink text-paper" : "bg-card border border-line"}`}
              onClick={() => setLevelFilter(level)}
            >
              L{level}
            </button>
          ))}
          {view === "floor" && me.role === "owner" ? (
            <span className="text-xs text-muted-foreground">Drag a bay to slide the whole rack on the grid.</span>
          ) : null}
        </div>
      ) : null}
      {data && view === "build" ? (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Opening the floor builder…</p>}>
          <FloorBuilder
            me={me}
            data={data}
            selectedId={selectedId}
            onSelectLocation={(location) => setSelectedId(location?.id ?? null)}
            onReload={load}
            onError={setError}
          />
        </Suspense>
      ) : data && view === "iso" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Suspense fallback={<div className="grid h-[min(74vh,820px)] place-items-center rounded-xl border text-sm text-muted-foreground">Loading 3D floor…</div>}>
            <WarehouseScene
            warehouse={data.warehouse}
            locations={data.locations.filter((location) => levelFilter === "all" || location.level === levelFilter)}
            objects={groupFloorObjects(
              data.locations.filter((location) => levelFilter === "all" || location.level === levelFilter),
            )}
            selectedLocationId={selectedId}
            selectedObjectId={selected ? objectForLocation(groupFloorObjects(data.locations), selected.id)?.id ?? null : null}
            highlightBay={selected?.bay ?? null}
            mode="view"
            cameraMode="orbit"
            onSelectLocation={(location) => setSelectedId(location?.id ?? null)}
            onSelectObject={() => undefined}
          />
          </Suspense>
          <BayDetail location={selected} />
        </div>
      ) : data ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <WarehouseMap
            warehouse={data.warehouse}
            locations={data.locations}
            selectedId={selectedId}
            view={view}
            levelFilter={levelFilter}
            canDrag={me.role === "owner"}
            onSelect={(location) => setSelectedId(location.id)}
            onReposition={reposition}
          />
          <BayDetail location={selected} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading floor…</p>
      )}
    </div>
  );
}

function BayDetail({ location }: { location: MapLocation | null }) {
  if (!location) {
    return (
      <Card>
        <p className="font-semibold">Select a bay</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Occupied storage bays are orange. Use Build floor to drop a whole rack of bays and levels.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{location.area}</p>
      <h2 className="mt-1 text-xl font-semibold">{location.code}</h2>
      <p className="text-sm text-muted-foreground">{location.name}</p>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Type</dt>
          <dd className="capitalize">{location.type}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Level</dt>
          <dd>{location.level}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Aisle / rack / bay</dt>
          <dd className="font-mono">
            {[location.aisle, location.rack, location.bay].filter(Boolean).join("-") || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Map position</dt>
          <dd className="font-mono">
            {location.posX},{location.posY},{location.posZ}
          </dd>
        </div>
      </dl>
      <div className="mt-4 rounded-lg border border-line bg-paper p-2">
        <BarcodeLabel value={location.barcode} className="mx-auto h-16" />
      </div>
      <h3 className="mt-4 text-sm font-semibold">On-hand</h3>
      {location.contents.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {location.contents.map((row) => (
            <li key={row.itemId} className="flex justify-between gap-3">
              <span>
                <span className="font-mono">{row.sku}</span> {row.itemName}
              </span>
              <span className="font-mono tabular">{row.qty}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Empty bay.</p>
      )}
      <Link
        className="mt-4 inline-flex rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper"
        to={`/move?from=${encodeURIComponent(location.barcode)}`}
      >
        Move this bay
      </Link>
    </Card>
  );
}
