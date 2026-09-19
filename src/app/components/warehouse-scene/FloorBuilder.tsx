import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxSelect,
  Factory,
  Layers,
  Minus,
  MousePointer2,
  Move,
  Plus,
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
  applyRackPreset,
  defaultAreaSpec,
  defaultRackSpec,
  expandArea,
  expandRack,
  findOpenPosition,
  groupFloorObjects,
  nextRackAddress,
  objectForLocation,
  padBay,
  RACK_PRESETS,
  rotateSpec,
  translateSpec,
  validateDrafts,
  type AreaSpec,
  type FloorObject,
  type RackObject,
  type RackSpec,
  type Rotation,
} from "@/domain/rack-builder";
import { WarehouseScene, type CameraMode, type Ghost } from "./WarehouseScene";

type Tool = "select" | "rack" | "receiving" | "production" | "shipping";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

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

function Stepper({
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
  return (
    <Field label={label}>
      <div className="flex h-8 overflow-hidden rounded-md border border-input">
        <button
          type="button"
          className="px-2 text-muted-foreground hover:bg-accent"
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-3.5" />
        </button>
        <span className="flex flex-1 items-center justify-center font-mono text-sm tabular-nums">{value}</span>
        <button
          type="button"
          className="px-2 text-muted-foreground hover:bg-accent"
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
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
  const [explode, setExplode] = useState(false);
  const [levelFilter, setLevelFilter] = useState<"all" | number>("all");
  const [rackDraft, setRackDraft] = useState<RackSpec>(() => {
    const next = nextRackAddress(objects);
    return defaultRackSpec({ ...next, posX: 4, posY: 4, bays: 4, levels: 3, bayPitch: 4 });
  });
  const [busy, setBusy] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(selectedObject?.id ?? null);
  const [drag, setDrag] = useState<{
    id: string;
    ox: number;
    oy: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const placing = tool !== "select";
  const canEdit = me.role === "owner";
  const levels = useMemo(() => {
    const set = new Set(data.locations.map((row) => row.level));
    if (tool === "rack") {
      for (let level = 1; level <= rackDraft.levels; level += 1) set.add(level);
    }
    return [...set].sort((a, b) => a - b);
  }, [data.locations, tool, rackDraft.levels]);

  useEffect(() => {
    if (selectedObject) setSelectedObjectId(selectedObject.id);
  }, [selectedObject]);

  const ignoreIds = useMemo(() => {
    if (!drag) return new Set<string>();
    const object = objects.find((row) => row.id === drag.id);
    if (!object || object.kind !== "rack") return new Set<string>();
    return new Set(object.locations.map((row) => row.id).filter((id): id is string => Boolean(id)));
  }, [drag, objects]);

  const ghost: Ghost | null = useMemo(() => {
    if (drag?.moved) {
      const object = objects.find((row) => row.id === drag.id);
      if (!object || object.kind !== "rack") return null;
      const spec = translateSpec(object.spec, drag.x, drag.y);
      const issue = validateDrafts(expandRack(spec), data.locations, data.warehouse, ignoreIds);
      return { kind: "rack", spec, valid: !issue, message: issue?.message ?? null };
    }
    if (!placing || !cursor || !canEdit) return null;
    if (tool === "rack") {
      const spec = translateSpec(rackDraft, cursor.x, cursor.y);
      const issue = validateDrafts(expandRack(spec), data.locations, data.warehouse);
      return { kind: "rack", spec, valid: !issue, message: issue?.message ?? null };
    }
    const spec = defaultAreaSpec(tool, data.locations, cursor.x, cursor.y);
    const issue = validateDrafts([expandArea(spec)], data.locations, data.warehouse);
    return { kind: "area", spec, valid: !issue, message: issue?.message ?? null };
  }, [placing, cursor, canEdit, tool, rackDraft, data.locations, data.warehouse, drag, objects, ignoreIds]);

  function parkGhost(nextTool: Tool, draft: RackSpec = rackDraft) {
    if (nextTool === "select") {
      setCursor(null);
      return;
    }
    if (nextTool === "rack") {
      const open = findOpenPosition(
        (posX, posY) => expandRack({ ...draft, posX, posY }),
        data.locations,
        data.warehouse,
        new Set(),
        cursor ? { posX: cursor.x, posY: cursor.y } : { posX: draft.posX, posY: draft.posY },
      );
      if (open) setCursor({ x: open.posX, y: open.posY });
      return;
    }
    const seed = defaultAreaSpec(nextTool, data.locations, cursor?.x ?? 2, cursor?.y ?? 2);
    const open = findOpenPosition(
      (posX, posY) => [expandArea({ ...seed, posX, posY })],
      data.locations,
      data.warehouse,
    );
    if (open) setCursor({ x: open.posX, y: open.posY });
  }

  function chooseTool(next: Tool) {
    onError(null);
    setDrag(null);
    setTool(next);
    parkGhost(next);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        setTool("select");
        setDrag(null);
        setCursor(null);
        onError(null);
        return;
      }
      if ((event.key === "r" || event.key === "R") && (tool === "rack" || Boolean(drag))) {
        event.preventDefault();
        setRackDraft((current) => rotateSpec(current, ((current.rotation + 90) % 360) as Rotation));
        return;
      }
      if (event.key === "1") setCameraMode("top");
      if (event.key === "2") setCameraMode("orbit");
      if (event.key === "Enter" && placing) {
        event.preventDefault();
        if (cursor) void placeAt(cursor.x, cursor.y);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && tool === "select") {
        event.preventDefault();
        void removeSelected();
        return;
      }
      const step: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = step[event.key];
      if (delta && (placing || drag)) {
        event.preventDefault();
        if (drag) {
          setDrag((current) =>
            current ? { ...current, x: current.x + delta[0], y: current.y + delta[1], moved: true } : current,
          );
          return;
        }
        setCursor((current) => {
          if (!current) return { x: 2 + delta[0], y: 2 + delta[1] };
          return { x: current.x + delta[0], y: current.y + delta[1] };
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, placing, cursor, drag, onError]);

  async function placeAt(x: number, y: number) {
    if (!canEdit || busy) return;
    setCursor({ x, y });
    let spec: RackSpec | AreaSpec;
    let kind: "rack" | "area";
    if (tool === "rack") {
      spec = translateSpec(rackDraft, x, y);
      kind = "rack";
    } else if (tool === "select") {
      return;
    } else {
      spec = defaultAreaSpec(tool, data.locations, x, y);
      kind = "area";
    }
    const drafts = kind === "rack" ? expandRack(spec as RackSpec) : [expandArea(spec as AreaSpec)];
    const issue = validateDrafts(drafts, data.locations, data.warehouse);
    if (issue) {
      onError(issue.message);
      return;
    }
    setBusy(true);
    onError(null);
    try {
      if (kind === "rack") {
        const rackSpec = spec as RackSpec;
        const created = await api<{ locations: { id: string }[] }>("/api/layout/racks", {
          method: "POST",
          body: JSON.stringify({ warehouseId, ...rackSpec }),
        });
        const next = nextRackAddress(
          [
            ...objects,
            {
              kind: "rack",
              id: "tmp",
              aisle: rackSpec.aisle,
              rack: rackSpec.rack,
              spec: rackSpec,
              locations: [],
              occupied: false,
            },
          ],
          rackSpec.aisle,
        );
        setRackDraft((current) => defaultRackSpec({ ...current, ...next }));
        setTool("select");
        setCursor(null);
        await onReload();
        if (created.locations[0]?.id) onSelectLocation({ id: created.locations[0].id } as MapLocation);
        return;
      } else {
        await api("/api/layout/areas", {
          method: "POST",
          body: JSON.stringify({ warehouseId, ...spec }),
        });
      }
      setTool("select");
      setCursor(null);
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

  async function commitDrag() {
    const current = dragRef.current;
    if (!current || !canEdit) {
      setDrag(null);
      return;
    }
    const object = objects.find((row) => row.id === current.id);
    if (!object || object.kind !== "rack") {
      setDrag(null);
      return;
    }
    if (!current.moved || (current.x === current.originX && current.y === current.originY)) {
      setDrag(null);
      return;
    }
    const spec = translateSpec(object.spec, current.x, current.y);
    const issue = validateDrafts(
      expandRack(spec),
      data.locations,
      data.warehouse,
      new Set(object.locations.map((row) => row.id).filter((id): id is string => Boolean(id))),
    );
    setDrag(null);
    if (issue) {
      onError(issue.message);
      return;
    }
    await applyRack({ posX: current.x, posY: current.y }, object);
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
  const selectedBin = selectedRack?.locations.find((row) => row.id === selectedId) ?? null;
  const highlightBay = selectedBin?.bay ?? null;

  return (
    <div className="grid gap-4 xl:grid-cols-[16.5rem_minmax(0,1fr)_19rem]">
      <aside className="space-y-4 rounded-xl border bg-card p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tools</p>
          <h2 className="mt-1 text-sm font-semibold">Place on the floor</h2>
        </div>
        <div className="grid gap-2">
          <ToolButton active={tool === "select"} icon={MousePointer2} label="Select / move" onClick={() => chooseTool("select")} />
          <ToolButton active={tool === "rack"} icon={Warehouse} label="Pallet rack" onClick={() => chooseTool("rack")} disabled={!canEdit} />
          <ToolButton active={tool === "receiving"} icon={Truck} label="Receiving dock" onClick={() => chooseTool("receiving")} disabled={!canEdit} />
          <ToolButton active={tool === "production"} icon={Factory} label="Production cell" onClick={() => chooseTool("production")} disabled={!canEdit} />
          <ToolButton active={tool === "shipping"} icon={ScanLine} label="Outbound staging" onClick={() => chooseTool("shipping")} disabled={!canEdit} />
        </div>
        {tool === "rack" ? (
          <>
            <div className="grid gap-1.5">
              <p className="text-[11px] text-muted-foreground">Rack section presets</p>
              {RACK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="rounded-md border px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    const next = applyRackPreset(rackDraft, preset);
                    setRackDraft(next);
                    parkGhost("rack", next);
                  }}
                >
                  <span className="font-medium">{preset.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{preset.hint}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Aisle">
                <Input className="h-8" value={rackDraft.aisle} onChange={(e) => setRackDraft((c) => ({ ...c, aisle: e.target.value }))} />
              </Field>
              <Field label="Rack">
                <Input className="h-8" value={rackDraft.rack} onChange={(e) => setRackDraft((c) => ({ ...c, rack: e.target.value }))} />
              </Field>
              <Stepper label="Bays" value={rackDraft.bays} onChange={(bays) => setRackDraft((c) => ({ ...c, bays }))} />
              <Stepper label="Levels" value={rackDraft.levels} max={12} onChange={(levels) => setRackDraft((c) => ({ ...c, levels }))} />
              <NumberField label="Bay width" value={rackDraft.bayWidth} onChange={(bayWidth) => setRackDraft((c) => ({ ...c, bayWidth }))} />
              <NumberField label="Bay depth" value={rackDraft.bayDepth} onChange={(bayDepth) => setRackDraft((c) => ({ ...c, bayDepth }))} />
              <NumberField label="Bay pitch" value={rackDraft.bayPitch} onChange={(bayPitch) => setRackDraft((c) => ({ ...c, bayPitch }))} />
              <NumberField label="Level height" value={rackDraft.levelHeight} max={12} onChange={(levelHeight) => setRackDraft((c) => ({ ...c, levelHeight }))} />
              <div className="col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-full"
                  onClick={() => setRackDraft((c) => rotateSpec(c, ((c.rotation + 90) % 360) as Rotation))}
                >
                  <RotateCw className="size-3.5" /> {rackDraft.rotation}°
                </Button>
              </div>
            </div>
          </>
        ) : null}
        <p className="text-[11px] leading-5 text-muted-foreground">
          Ghost follows the grid. <kbd className="rounded border px-1">R</kbd> rotates, arrows nudge,{" "}
          <kbd className="rounded border px-1">Enter</kbd> places, <kbd className="rounded border px-1">Esc</kbd> cancels. Right-drag
          pans, wheel zooms.
        </p>
      </aside>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={cameraMode === "top" ? "default" : "outline"} size="sm" onClick={() => setCameraMode("top")}>
            <Layers className="size-3.5" /> Plan
          </Button>
          <Button variant={cameraMode === "orbit" ? "default" : "outline"} size="sm" onClick={() => setCameraMode("orbit")}>
            <BoxSelect className="size-3.5" /> Orbit
          </Button>
          <Button variant={explode ? "default" : "outline"} size="sm" onClick={() => setExplode((value) => !value)}>
            <Move className="size-3.5" /> Explode levels
          </Button>
          <span className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 text-xs ${levelFilter === "all" ? "bg-primary text-primary-foreground" : "border"}`}
            onClick={() => setLevelFilter("all")}
          >
            All levels
          </button>
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              className={`rounded-full px-2.5 py-1 text-xs ${levelFilter === level ? "bg-primary text-primary-foreground" : "border"}`}
              onClick={() => setLevelFilter(level)}
            >
              L{level}
            </button>
          ))}
          {placing ? (
            <span className="text-xs text-muted-foreground">
              {ghost?.valid === false ? "Invalid footprint" : "Click the floor to place"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Drag a rack to move it. Click a bay to inspect that section.</span>
          )}
        </div>
        <WarehouseScene
          warehouse={data.warehouse}
          locations={data.locations}
          objects={objects}
          selectedLocationId={selectedId}
          selectedObjectId={selectedObjectId}
          highlightBay={highlightBay}
          mode="build"
          cameraMode={cameraMode}
          placing={placing}
          translating={Boolean(drag)}
          explode={explode}
          levelFilter={levelFilter}
          hiddenObjectId={drag?.moved ? drag.id : null}
          ghost={ghost}
          cursor={cursor}
          onSelectLocation={onSelectLocation}
          onSelectObject={setSelectedObjectId}
          onFloorMove={(x, y) => {
            if (drag) {
              setDrag((current) => {
                if (!current) return current;
                const nx = x - current.ox;
                const ny = y - current.oy;
                return { ...current, x: nx, y: ny, moved: current.moved || nx !== current.originX || ny !== current.originY };
              });
              return;
            }
            setCursor({ x, y });
          }}
          onFloorClick={(x, y) => {
            if (placing) void placeAt(x, y);
          }}
          onTranslateBegin={(objectId, x, y) => {
            if (placing || !canEdit) return;
            const object = objects.find((row) => row.id === objectId);
            if (!object || object.kind !== "rack") return;
            setDrag({
              id: objectId,
              ox: x - object.spec.posX,
              oy: y - object.spec.posY,
              x: object.spec.posX,
              y: object.spec.posY,
              originX: object.spec.posX,
              originY: object.spec.posY,
              moved: false,
            });
          }}
          onTranslateMove={(x, y) => {
            setDrag((current) => {
              if (!current) return current;
              const nx = x - current.ox;
              const ny = y - current.oy;
              return { ...current, x: nx, y: ny, moved: current.moved || nx !== current.originX || ny !== current.originY };
            });
          }}
          onTranslateEnd={() => {
            void commitDrag();
          }}
        />
      </div>

      <aside className="space-y-4 rounded-xl border bg-card p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Inspector</p>
          <h2 className="mt-1 text-sm font-semibold">
            {selectedRack
              ? `Rack section ${selectedRack.aisle}-${selectedRack.rack}`
              : selectedObject?.kind === "area"
                ? selectedObject.spec.name
                : "Nothing selected"}
          </h2>
          {selectedBin ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Bay section {padBay(selectedBin.bay ?? "01")} · level {selectedBin.level} · {selectedBin.code}
            </p>
          ) : null}
        </div>
        {selectedRack ? (
          <div className="grid grid-cols-2 gap-2">
            <Stepper label="Bays" value={selectedRack.spec.bays} onChange={(bays) => void applyRack({ bays }, selectedRack)} />
            <Stepper
              label="Levels"
              value={selectedRack.spec.levels}
              max={12}
              onChange={(nextLevels) => void applyRack({ levels: nextLevels }, selectedRack)}
            />
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
            <NumberField label="Bay pitch" value={selectedRack.spec.bayPitch} onChange={(bayPitch) => void applyRack({ bayPitch }, selectedRack)} />
            <NumberField
              label="Level height"
              value={selectedRack.spec.levelHeight}
              max={12}
              onChange={(levelHeight) => void applyRack({ levelHeight }, selectedRack)}
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
            <BayLevelGrid rack={selectedRack} selectedId={selectedId} onSelectLocation={onSelectLocation} locations={data.locations} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a rack to edit bays and levels. Each cell becomes a scannable location with its own barcode.
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

function BayLevelGrid({
  rack,
  selectedId,
  onSelectLocation,
  locations,
}: {
  rack: RackObject;
  selectedId: string | null;
  onSelectLocation: (location: MapLocation | null) => void;
  locations: MapLocation[];
}) {
  const bays = Array.from({ length: rack.spec.bays }, (_, i) => padBay(i + 1));
  const levels = Array.from({ length: rack.spec.levels }, (_, i) => i + 1);
  return (
    <div className="col-span-2 space-y-2">
      <p className="text-[11px] text-muted-foreground">
        {rack.spec.bays * rack.spec.levels} bins · {rack.occupied ? "has stock" : "empty"} · click a cell to select that bay
        section
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-center font-mono text-[11px]">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="px-1.5 py-1 font-medium">Bay</th>
              {levels.map((level) => (
                <th key={level} className="px-1.5 py-1 font-medium">
                  L{level}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bays.map((bay) => (
              <tr key={bay} className="border-t">
                <td className="px-1.5 py-1 text-muted-foreground">{bay}</td>
                {levels.map((level) => {
                  const loc = locations.find(
                    (row) => row.id && rack.locations.some((bin) => bin.id === row.id) && padBay(row.bay ?? "01") === bay && row.level === level,
                  );
                  const occupied = (loc?.unitsOnHand ?? 0) > 0;
                  const selected = loc?.id === selectedId;
                  return (
                    <td key={`${bay}-${level}`} className="p-0.5">
                      <button
                        type="button"
                        disabled={!loc}
                        onClick={() => loc && onSelectLocation(loc)}
                        className={`h-7 w-full rounded-sm ${
                          selected
                            ? "bg-primary text-primary-foreground"
                            : occupied
                              ? "bg-primary/20 text-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                        title={loc?.code}
                      >
                        {occupied ? loc?.unitsOnHand : "·"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
