import { useEffect, useMemo, useState } from "react";
import {
  BoxSelect,
  Factory,
  Layers,
  MousePointer2,
  RotateCw,
  ScanLine,
  Trash2,
  Truck,
  Warehouse,
} from "lucide-react";
import { api, type MapLocation, type Me, type WarehouseMapData } from "@/app/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  defaultAreaSpec,
  defaultRackSpec,
  expandArea,
  expandRack,
  groupFloorObjects,
  nextRackAddress,
  objectForLocation,
  rotateSpec,
  translateSpec,
  validateDrafts,
  type FloorObject,
  type RackSpec,
  type Rotation,
} from "@/domain/rack-builder";
import { WarehouseScene, type CameraMode, type Ghost } from "./WarehouseScene";

type Tool = "select" | "rack" | "receiving" | "production" | "shipping";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  min = 1,
  max = 40,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = Number(text);
          if (Number.isFinite(next) && next !== value) onChange(next);
          else setText(String(value));
        }}
        className="h-8"
      />
    </Field>
  );
}

export function FloorBuilder({
  me,
  data,
  selectedId,
  onSelectLocation,
  onReload,
  onError,
}: {
  me: Me;
  data: WarehouseMapData;
  selectedId: string | null;
  onSelectLocation: (location: MapLocation | null) => void;
  onReload: () => Promise<unknown>;
  onError: (message: string | null) => void;
}) {
  const warehouseId = data.warehouse.id;
  const objects = useMemo(() => groupFloorObjects(data.locations), [data.locations]);
  const selectedObject = selectedId ? objectForLocation(objects, selectedId) : null;
  const [tool, setTool] = useState<Tool>("select");
  const [cameraMode, setCameraMode] = useState<CameraMode>("top");
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [rackDraft, setRackDraft] = useState<RackSpec>(() => {
    const next = nextRackAddress(objects);
    return defaultRackSpec({ ...next, posX: 4, posY: 4, bays: 4, levels: 3 });
  });
  const [busy, setBusy] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(selectedObject?.id ?? null);
  const placing = tool !== "select";
  const canEdit = me.role === "owner";

  useEffect(() => {
    if (selectedObject) setSelectedObjectId(selectedObject.id);
  }, [selectedObject]);

  const ghost: Ghost | null = useMemo(() => {
    if (!placing || !cursor || !canEdit) return null;
    if (tool === "rack") {
      const spec = translateSpec(rackDraft, cursor.x, cursor.y);
      const issue = validateDrafts(expandRack(spec), data.locations, data.warehouse);
      return { kind: "rack", spec, valid: !issue };
    }
    const spec = defaultAreaSpec(tool, data.locations, cursor.x, cursor.y);
    const issue = validateDrafts([expandArea(spec)], data.locations, data.warehouse);
    return { kind: "area", spec, valid: !issue };
  }, [placing, cursor, canEdit, tool, rackDraft, data.locations, data.warehouse]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTool("select");
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        setRackDraft((current) => rotateSpec(current, ((current.rotation + 90) % 360) as Rotation));
        return;
      }
      if (event.key === "1") setCameraMode("top");
      if (event.key === "2") setCameraMode("orbit");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function place() {
    if (!ghost || !ghost.valid || !canEdit) {
      if (ghost && !ghost.valid) onError("That footprint overlaps another bay or leaves the warehouse.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      if (ghost.kind === "rack") {
        await api("/api/layout/racks", {
          method: "POST",
          body: JSON.stringify({ warehouseId, ...ghost.spec }),
        });
        const next = nextRackAddress(
          [
            ...objects,
            { kind: "rack", id: "tmp", aisle: ghost.spec.aisle, rack: ghost.spec.rack, spec: ghost.spec, locations: [], occupied: false },
          ],
          ghost.spec.aisle,
        );
        setRackDraft((current) => defaultRackSpec({ ...current, ...next }));
      } else {
        await api("/api/layout/areas", {
          method: "POST",
          body: JSON.stringify({ warehouseId, ...ghost.spec }),
        });
      }
      setTool("select");
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not place that object");
    } finally {
      setBusy(false);
    }
  }

  async function applyRack(patch: Partial<RackSpec>, object: FloorObject) {
    if (object.kind !== "rack" || !canEdit) return;
    setBusy(true);
    onError(null);
    try {
      await api("/api/layout/racks", {
        method: "PATCH",
        body: JSON.stringify({
          warehouseId,
          fromAisle: object.aisle,
          fromRack: object.rack,
          ...object.spec,
          ...patch,
        }),
      });
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update that rack");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selectedObject || !canEdit) return;
    setBusy(true);
    onError(null);
    try {
      if (selectedObject.kind === "rack") {
        await api("/api/layout/racks", {
          method: "DELETE",
          body: JSON.stringify({ warehouseId, aisle: selectedObject.aisle, rack: selectedObject.rack }),
        });
      } else if (selectedObject.location.id) {
        await api(`/api/locations/${selectedObject.location.id}`, { method: "DELETE" });
      }
      onSelectLocation(null);
      setSelectedObjectId(null);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not delete that object");
    } finally {
      setBusy(false);
    }
  }

  const selectedRack = selectedObject?.kind === "rack" ? selectedObject : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[16.5rem_minmax(0,1fr)_18rem]">
      <aside className="space-y-4 rounded-xl border bg-card p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tools</p>
          <h2 className="mt-1 text-sm font-semibold">Place on the floor</h2>
        </div>
        <div className="grid gap-2">
          <ToolButton active={tool === "select"} icon={MousePointer2} label="Select / move" onClick={() => setTool("select")} />
          <ToolButton active={tool === "rack"} icon={Warehouse} label="Pallet rack" onClick={() => setTool("rack")} disabled={!canEdit} />
          <ToolButton active={tool === "receiving"} icon={Truck} label="Receiving dock" onClick={() => setTool("receiving")} disabled={!canEdit} />
          <ToolButton active={tool === "production"} icon={Factory} label="Production cell" onClick={() => setTool("production")} disabled={!canEdit} />
          <ToolButton active={tool === "shipping"} icon={ScanLine} label="Outbound staging" onClick={() => setTool("shipping")} disabled={!canEdit} />
        </div>
        {tool === "rack" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Aisle">
              <Input className="h-8" value={rackDraft.aisle} onChange={(e) => setRackDraft((c) => ({ ...c, aisle: e.target.value }))} />
            </Field>
            <Field label="Rack">
              <Input className="h-8" value={rackDraft.rack} onChange={(e) => setRackDraft((c) => ({ ...c, rack: e.target.value }))} />
            </Field>
            <NumberField label="Bays" value={rackDraft.bays} onChange={(bays) => setRackDraft((c) => ({ ...c, bays }))} />
            <NumberField label="Levels" value={rackDraft.levels} max={12} onChange={(levels) => setRackDraft((c) => ({ ...c, levels }))} />
            <NumberField label="Bay width" value={rackDraft.bayWidth} onChange={(bayWidth) => setRackDraft((c) => ({ ...c, bayWidth, bayPitch: bayWidth }))} />
            <NumberField label="Bay depth" value={rackDraft.bayDepth} onChange={(bayDepth) => setRackDraft((c) => ({ ...c, bayDepth }))} />
            <NumberField label="Level height" value={rackDraft.levelHeight} max={12} onChange={(levelHeight) => setRackDraft((c) => ({ ...c, levelHeight }))} />
            <Field label="Rotation">
              <Button
                type="button"
                variant="outline"
                className="h-8 w-full"
                onClick={() => setRackDraft((c) => rotateSpec(c, ((c.rotation + 90) % 360) as Rotation))}
              >
                <RotateCw className="size-3.5" /> {rackDraft.rotation}°
              </Button>
            </Field>
          </div>
        ) : null}
        <p className="text-[11px] leading-5 text-muted-foreground">
          Click the floor to drop a ghost. <kbd className="rounded border px-1">R</kbd> rotates,{" "}
          <kbd className="rounded border px-1">Esc</kbd> cancels, <kbd className="rounded border px-1">1</kbd>/<kbd className="rounded border px-1">2</kbd> switch cameras.
        </p>
      </aside>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={cameraMode === "top" ? "default" : "outline"} size="sm" onClick={() => setCameraMode("top")}>
            <Layers className="size-3.5" /> Top
          </Button>
          <Button variant={cameraMode === "orbit" ? "default" : "outline"} size="sm" onClick={() => setCameraMode("orbit")}>
            <BoxSelect className="size-3.5" /> Orbit
          </Button>
          {placing ? (
            <span className="text-xs text-muted-foreground">
              {ghost?.valid === false ? "Invalid footprint" : "Click to place"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Select a rack, then edit bays, levels, or origin in the inspector.</span>
          )}
        </div>
        <WarehouseScene
          warehouse={data.warehouse}
          locations={data.locations}
          objects={objects}
          selectedLocationId={selectedId}
          selectedObjectId={selectedObjectId}
          mode="build"
          cameraMode={cameraMode}
          placing={placing}
          ghost={ghost}
          cursor={cursor}
          onSelectLocation={onSelectLocation}
          onSelectObject={setSelectedObjectId}
          onFloorMove={(x, y) => setCursor({ x, y })}
          onFloorClick={() => {
            if (placing) void place();
          }}
        />
      </div>

      <aside className="space-y-4 rounded-xl border bg-card p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Inspector</p>
          <h2 className="mt-1 text-sm font-semibold">
            {selectedRack
              ? `Rack ${selectedRack.aisle}-${selectedRack.rack}`
              : selectedObject?.kind === "area"
                ? selectedObject.spec.name
                : "Nothing selected"}
          </h2>
        </div>
        {selectedRack ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Bays" value={selectedRack.spec.bays} onChange={(bays) => void applyRack({ bays }, selectedRack)} />
            <NumberField label="Levels" value={selectedRack.spec.levels} max={12} onChange={(levels) => void applyRack({ levels }, selectedRack)} />
            <NumberField
              label="Origin X"
              value={selectedRack.spec.posX}
              min={0}
              onChange={(posX) => void applyRack({ posX }, selectedRack)}
            />
            <NumberField
              label="Origin Y"
              value={selectedRack.spec.posY}
              min={0}
              onChange={(posY) => void applyRack({ posY }, selectedRack)}
            />
            <div className="col-span-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() => void applyRack({ rotation: ((selectedRack.spec.rotation + 90) % 360) as Rotation }, selectedRack)}
              >
                <RotateCw className="size-3.5" /> Rotate 90°
              </Button>
            </div>
            <p className="col-span-2 text-[11px] text-muted-foreground">
              {selectedRack.spec.bays * selectedRack.spec.levels} bins · {selectedRack.occupied ? "has stock" : "empty"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a rack to change bays and levels. Each cell becomes a scannable location with its own barcode.
          </p>
        )}
        <Separator />
        <Button variant="destructive" className="w-full" disabled={!selectedObject || busy || !canEdit} onClick={() => void removeSelected()}>
          <Trash2 className="size-3.5" /> Delete object
        </Button>
      </aside>
    </div>
  );
}

function ToolButton({
  active,
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  icon: typeof Warehouse;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant={active ? "default" : "outline"} className="justify-start" onClick={onClick} disabled={disabled}>
      <Icon className="size-4" />
      {label}
    </Button>
  );
}
