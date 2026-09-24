import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxSelect,
  Factory,
  Grid3x3,
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
import { api, type MapLocation, type Me, type WarehouseMapData, type Zone } from "@/app/api";
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
  footprint,
  groupFloorObjects,
  nextRackAddress,
  nextRotation,
  objectForLocation,
  objectLocationIds,
  padBay,
  RACK_PRESETS,
  rotateAreaSpec,
  rotateSpec,
  translateAreaSpec,
  translateSpec,
  validateDrafts,
  type AreaObject,
  type AreaSpec,
  type FloorObject,
  type LocationDraft,
  type RackObject,
  type RackSpec,
  type Rotation,
} from "@/domain/rack-builder";
import {
  countZoneBays,
  hasFootprint,
  nextZoneCode,
  rectFromCorners,
  validateZoneFootprint,
  zoneForBox,
  type ZoneRect,
} from "@/domain/zones";
import { WarehouseScene, type CameraMode, type Ghost } from "./WarehouseScene";

type Tool = "select" | "zone" | "rack" | "receiving" | "production" | "shipping";

/** An object on the move: where the pointer grabbed it, where it is now, and how it has been turned. */
type Drag = {
  id: string;
  kind: "rack" | "area";
  ox: number;
  oy: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  /** Racks: the rotation the ghost shows. */
  rotation: Rotation;
  /** Areas: sides swapped by a quarter turn. */
  swapped: boolean;
  moved: boolean;
};

type ZoneDraw = { x0: number; y0: number; x1: number; y1: number };
/** A rectangle that has been drawn and is waiting for a code and name (or an existing tag-only zone to attach to). */
type ZoneDraft = ZoneRect & { zoneId: string | null; code: string; name: string };

const PLACING_TOOLS: ReadonlySet<Tool> = new Set(["rack", "receiving", "production", "shipping"]);
const SELECT_CLASS =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function objectOrigin(object: FloorObject): { x: number; y: number } {
  return { x: object.spec.posX, y: object.spec.posY };
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`grid gap-1 text-xs ${className ?? ""}`}>
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
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
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
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = Number(text);
          if (Number.isFinite(next) && next !== value) onChange(next);
          else setText(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        className="h-8"
      />
    </Field>
  );
}

/** A text input that commits on blur or Enter, so a half-typed code never hits the API. */
function TextField({
  label,
  value,
  disabled,
  mono,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  mono?: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <Field label={label}>
      <Input
        value={text}
        disabled={disabled}
        className={`h-8 ${mono ? "font-mono" : ""}`}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = text.trim();
          if (next && next !== value) onCommit(next);
          else setText(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            setText(value);
            (event.target as HTMLInputElement).blur();
          }
        }}
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
  const zones = useMemo(() => (data.zones ?? []).slice().sort((a, b) => a.code.localeCompare(b.code)), [data.zones]);
  const drawnZones = useMemo(() => zones.filter(hasFootprint), [zones]);
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
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
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [zoneDraw, setZoneDraw] = useState<ZoneDraw | null>(null);
  const [zoneDraft, setZoneDraft] = useState<ZoneDraft | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const zoneDrawRef = useRef(zoneDraw);
  zoneDrawRef.current = zoneDraw;
  const placing = PLACING_TOOLS.has(tool);
  const drawing = tool === "zone";
  const canEdit = me.role === "owner";
  const activeObject = selectedObjectId ? (objects.find((row) => row.id === selectedObjectId) ?? null) : selectedObject;
  const selectedZone = selectedZoneId ? (zoneById.get(selectedZoneId) ?? null) : null;
  const levels = useMemo(() => {
    const set = new Set(data.locations.map((row) => row.level));
    if (tool === "rack") {
      for (let level = 1; level <= rackDraft.levels; level += 1) set.add(level);
    }
    return [...set].sort((a, b) => a - b);
  }, [data.locations, tool, rackDraft.levels]);

  useEffect(() => {
    if (selectedObject) {
      setSelectedObjectId(selectedObject.id);
      setSelectedZoneId(null);
    }
  }, [selectedObject]);

  const ignoreIds = useMemo(() => {
    if (!drag) return new Set<string>();
    const object = objects.find((row) => row.id === drag.id);
    return object ? objectLocationIds(object) : new Set<string>();
  }, [drag, objects]);

  /** The zone a set of bays would land in, for the ghost's caption. */
  function zoneLabelFor(drafts: LocationDraft[]): string | null {
    const box = footprint(drafts);
    const zone = box ? zoneForBox(drawnZones, box) : null;
    return zone ? zone.code : null;
  }

  const ghost: Ghost | null = useMemo(() => {
    if (drag?.moved) {
      const object = objects.find((row) => row.id === drag.id);
      if (!object) return null;
      if (object.kind === "rack") {
        const spec = rotateSpec(translateSpec(object.spec, drag.x, drag.y), drag.rotation);
        const drafts = expandRack(spec);
        const issue = validateDrafts(drafts, data.locations, data.warehouse, ignoreIds);
        return { kind: "rack", spec, valid: !issue, message: issue?.message ?? null, zoneLabel: zoneLabelFor(drafts) };
      }
      let spec = translateAreaSpec(object.spec, drag.x, drag.y);
      if (drag.swapped) spec = rotateAreaSpec(spec);
      const draft = expandArea(spec);
      const issue = validateDrafts([draft], data.locations, data.warehouse, ignoreIds);
      return { kind: "area", spec, valid: !issue, message: issue?.message ?? null, zoneLabel: zoneLabelFor([draft]) };
    }
    if (zoneDraw) {
      const rect = rectFromCorners(zoneDraw.x0, zoneDraw.y0, zoneDraw.x1, zoneDraw.y1);
      const issue = validateZoneFootprint(rect, drawnZones, data.warehouse);
      return { kind: "zone", spec: rect, valid: !issue, message: issue?.message ?? null };
    }
    if (zoneDraft) {
      const issue = validateZoneFootprint(
        { ...zoneDraft, code: zoneDraft.zoneId ? undefined : zoneDraft.code },
        zones,
        data.warehouse,
        zoneDraft.zoneId,
      );
      return { kind: "zone", spec: { ...zoneDraft }, valid: !issue, message: issue?.message ?? null };
    }
    if (!placing || !cursor || !canEdit) return null;
    if (tool === "rack") {
      const spec = translateSpec(rackDraft, cursor.x, cursor.y);
      const drafts = expandRack(spec);
      const issue = validateDrafts(drafts, data.locations, data.warehouse);
      return { kind: "rack", spec, valid: !issue, message: issue?.message ?? null, zoneLabel: zoneLabelFor(drafts) };
    }
    const spec = defaultAreaSpec(tool as AreaSpec["type"], data.locations, cursor.x, cursor.y);
    const draft = expandArea(spec);
    const issue = validateDrafts([draft], data.locations, data.warehouse);
    return { kind: "area", spec, valid: !issue, message: issue?.message ?? null, zoneLabel: zoneLabelFor([draft]) };
  }, [placing, cursor, canEdit, tool, rackDraft, data.locations, data.warehouse, drag, objects, ignoreIds, zoneDraw, zoneDraft, zones, drawnZones]);

  function parkGhost(nextTool: Tool, draft: RackSpec = rackDraft) {
    if (nextTool === "select" || nextTool === "zone") {
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
    setZoneDraw(null);
    if (next !== "zone") setZoneDraft(null);
    setTool(next);
    parkGhost(next);
  }

  function clearSelection() {
    setSelectedObjectId(null);
    setSelectedZoneId(null);
    onSelectLocation(null);
  }

  function selectObject(id: string | null) {
    setSelectedObjectId(id);
    if (id) setSelectedZoneId(null);
  }

  function selectZone(id: string | null) {
    setSelectedZoneId(id);
    if (id) {
      setSelectedObjectId(null);
      onSelectLocation(null);
    }
  }

  /** One write against the layout API, then a reload; the error banner gets the message when it fails. */
  async function runWrite(fallback: string, write: () => Promise<unknown>, after?: () => void): Promise<boolean> {
    if (!canEdit || busy) return false;
    setBusy(true);
    onError(null);
    try {
      await write();
      await onReload();
      after?.();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function placeAt(x: number, y: number) {
    if (!canEdit || busy) return;
    setCursor({ x, y });
    if (!placing) return;
    if (tool === "rack") {
      const rackSpec = translateSpec(rackDraft, x, y);
      const issue = validateDrafts(expandRack(rackSpec), data.locations, data.warehouse);
      if (issue) {
        onError(issue.message);
        return;
      }
      let created: { locations: { id: string }[] } | null = null;
      await runWrite(
        "Could not place that rack",
        async () => {
          created = await api<{ locations: { id: string }[] }>("/api/layout/racks", {
            method: "POST",
            body: JSON.stringify({ warehouseId, ...rackSpec }),
          });
        },
        () => {
          const next = nextRackAddress(
            [
              ...objects,
              { kind: "rack", id: "tmp", aisle: rackSpec.aisle, rack: rackSpec.rack, spec: rackSpec, locations: [], occupied: false },
            ],
            rackSpec.aisle,
          );
          setRackDraft((current) => defaultRackSpec({ ...current, ...next }));
          setTool("select");
          setCursor(null);
          const first = created?.locations[0]?.id;
          if (first) onSelectLocation({ id: first } as MapLocation);
        },
      );
      return;
    }
    const spec = defaultAreaSpec(tool as AreaSpec["type"], data.locations, x, y);
    const issue = validateDrafts([expandArea(spec)], data.locations, data.warehouse);
    if (issue) {
      onError(issue.message);
      return;
    }
    await runWrite(
      "Could not place that area",
      () => api("/api/layout/areas", { method: "POST", body: JSON.stringify({ warehouseId, ...spec }) }),
      () => {
        setTool("select");
        setCursor(null);
      },
    );
  }

  /** Save a rack's full spec after checking the new footprint the same way the server will. */
  async function commitRack(spec: RackSpec, object: RackObject) {
    const issue = validateDrafts(expandRack(spec), data.locations, data.warehouse, objectLocationIds(object));
    if (issue) {
      onError(issue.message);
      return;
    }
    await runWrite("Could not update that rack", () =>
      api("/api/layout/racks", {
        method: "PATCH",
        body: JSON.stringify({ warehouseId, fromAisle: object.aisle, fromRack: object.rack, ...spec }),
      }),
    );
  }

  function applyRack(patch: Partial<RackSpec>, object: RackObject) {
    return commitRack({ ...object.spec, ...patch }, object);
  }

  /** Save a change to a dock, bench, or staging area: geometry is checked here first, names and codes go straight through. */
  async function applyArea(patch: Partial<Pick<AreaSpec, "posX" | "posY" | "sizeX" | "sizeY" | "sizeZ" | "code" | "name">>, object: AreaObject) {
    if (!object.location.id) return;
    const spec: AreaSpec = { ...object.spec, ...patch };
    const issue = validateDrafts([expandArea(spec)], data.locations, data.warehouse, objectLocationIds(object));
    if (issue) {
      onError(issue.message);
      return;
    }
    await runWrite("Could not update that area", () =>
      api("/api/layout/areas", {
        method: "PATCH",
        body: JSON.stringify({ warehouseId, locationId: object.location.id, ...patch }),
      }),
    );
  }

  async function commitDrag() {
    const current = dragRef.current;
    setDrag(null);
    if (!current || !canEdit) return;
    const object = objects.find((row) => row.id === current.id);
    if (!object || !current.moved) return;
    if (object.kind === "rack") {
      const spec = rotateSpec(translateSpec(object.spec, current.x, current.y), current.rotation);
      if (spec.posX === object.spec.posX && spec.posY === object.spec.posY && spec.rotation === object.spec.rotation) return;
      await commitRack(spec, object);
      return;
    }
    if (current.x === current.originX && current.y === current.originY && !current.swapped) return;
    const patch: Partial<AreaSpec> = { posX: current.x, posY: current.y };
    if (current.swapped) {
      patch.sizeX = object.spec.sizeY;
      patch.sizeY = object.spec.sizeX;
    }
    await applyArea(patch, object);
  }

  /** Start (or continue) a keyboard move of the selected object; a floor click or Enter drops it. */
  function nudgeSelected(dx: number, dy: number) {
    if (!activeObject || !canEdit) return;
    const object = activeObject;
    setDrag((current) => {
      if (current) return { ...current, x: current.x + dx, y: current.y + dy, moved: true };
      const origin = objectOrigin(object);
      return {
        id: object.id,
        kind: object.kind,
        ox: 0,
        oy: 0,
        x: origin.x + dx,
        y: origin.y + dy,
        originX: origin.x,
        originY: origin.y,
        rotation: object.kind === "rack" ? object.spec.rotation : 0,
        swapped: false,
        moved: true,
      };
    });
  }

  /** R: turn whatever is in hand — the ghost being dragged or placed, otherwise the selected object. */
  function rotateInHand() {
    if (drag) {
      setDrag((current) =>
        current
          ? current.kind === "rack"
            ? { ...current, rotation: nextRotation(current.rotation), moved: true }
            : { ...current, swapped: !current.swapped, moved: true }
          : current,
      );
      return;
    }
    if (tool === "rack") {
      setRackDraft((current) => rotateSpec(current, nextRotation(current.rotation)));
      return;
    }
    if (tool !== "select" || !activeObject) return;
    if (activeObject.kind === "rack") void applyRack({ rotation: nextRotation(activeObject.spec.rotation) }, activeObject);
    else void applyArea({ sizeX: activeObject.spec.sizeY, sizeY: activeObject.spec.sizeX }, activeObject);
  }

  async function removeSelected() {
    if (!canEdit) return;
    if (selectedZone) {
      await runWrite(
        "Could not delete that zone",
        () => api(`/api/zones/${selectedZone.id}`, { method: "DELETE" }),
        () => setSelectedZoneId(null),
      );
      return;
    }
    if (!activeObject) return;
    const object = activeObject;
    await runWrite(
      "Could not delete that object",
      async () => {
        if (object.kind === "rack") {
          await api("/api/layout/racks", {
            method: "DELETE",
            body: JSON.stringify({ warehouseId, aisle: object.aisle, rack: object.rack }),
          });
        } else if (object.location.id) {
          await api(`/api/locations/${object.location.id}`, { method: "DELETE" });
        }
      },
      () => {
        onSelectLocation(null);
        setSelectedObjectId(null);
      },
    );
  }

  function finishZoneDraw() {
    const draw = zoneDrawRef.current;
    setZoneDraw(null);
    if (!draw) return;
    const rect = rectFromCorners(draw.x0, draw.y0, draw.x1, draw.y1);
    if (rect.sizeX < 1 || rect.sizeY < 1) return;
    const code = nextZoneCode(zones);
    setZoneDraft({ ...rect, zoneId: null, code, name: `Zone ${code}` });
  }

  async function saveZoneDraft() {
    const draft = zoneDraft;
    if (!draft || !canEdit || busy) return;
    const issue = validateZoneFootprint({ ...draft, code: draft.zoneId ? undefined : draft.code }, zones, data.warehouse, draft.zoneId);
    if (issue) {
      onError(issue.message);
      return;
    }
    const rect = { posX: draft.posX, posY: draft.posY, sizeX: draft.sizeX, sizeY: draft.sizeY };
    let zoneId = draft.zoneId;
    await runWrite(
      "Could not save that zone",
      async () => {
        if (zoneId) {
          await api(`/api/zones/${zoneId}`, { method: "PATCH", body: JSON.stringify(rect) });
        } else {
          const created = await api<{ id: string }>("/api/zones", {
            method: "POST",
            body: JSON.stringify({ warehouseId, code: draft.code.trim().toUpperCase(), name: draft.name.trim() || `Zone ${draft.code}`, ...rect }),
          });
          zoneId = created.id;
        }
      },
      () => {
        setZoneDraft(null);
        setTool("select");
        setCursor(null);
        selectZone(zoneId);
      },
    );
  }

  async function applyZone(patch: Partial<Pick<Zone, "code" | "name" | "posX" | "posY" | "sizeX" | "sizeY">>, zone: Zone) {
    const next = { ...zone, ...patch };
    const issue = validateZoneFootprint({ ...next, code: next.code }, zones, data.warehouse, zone.id);
    if (issue) {
      onError(issue.message);
      return;
    }
    await runWrite("Could not update that zone", () =>
      api(`/api/zones/${zone.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    );
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onError(null);
        if (drag) {
          setDrag(null);
          return;
        }
        if (zoneDraw) {
          setZoneDraw(null);
          return;
        }
        if (zoneDraft) {
          setZoneDraft(null);
          return;
        }
        if (tool !== "select") {
          setTool("select");
          setCursor(null);
          return;
        }
        clearSelection();
        return;
      }
      if (event.key === "r" || event.key === "R") {
        if (event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        rotateInHand();
        return;
      }
      if (event.key === "1") setCameraMode("top");
      if (event.key === "2") setCameraMode("orbit");
      if (event.key === "Enter") {
        if (zoneDraft) {
          event.preventDefault();
          void saveZoneDraft();
          return;
        }
        if (drag) {
          event.preventDefault();
          void commitDrag();
          return;
        }
        if (placing && cursor) {
          event.preventDefault();
          void placeAt(cursor.x, cursor.y);
        }
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && tool === "select" && !drag) {
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
      if (!delta) return;
      if (drag) {
        event.preventDefault();
        setDrag((current) =>
          current ? { ...current, x: current.x + delta[0], y: current.y + delta[1], moved: true } : current,
        );
        return;
      }
      if (placing) {
        event.preventDefault();
        setCursor((current) => {
          if (!current) return { x: 2 + delta[0], y: 2 + delta[1] };
          return { x: current.x + delta[0], y: current.y + delta[1] };
        });
        return;
      }
      if (tool === "select" && activeObject) {
        event.preventDefault();
        nudgeSelected(delta[0], delta[1]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedRack = activeObject?.kind === "rack" ? activeObject : null;
  const selectedArea = activeObject?.kind === "area" ? activeObject : null;
  const selectedAreaLocation = selectedArea ? (data.locations.find((row) => row.id === selectedArea.location.id) ?? null) : null;
  const selectedBin = selectedRack?.locations.find((row) => row.id === selectedId) ?? null;
  const highlightBay = selectedBin?.bay ?? null;

  /** "Zone A" / "Zones A, B" / "No zone" for the inspector. */
  function zoneLine(object: FloorObject): string {
    const ids = new Set<string>();
    const rows = object.kind === "rack" ? object.locations : [object.location];
    for (const row of rows) {
      const location = data.locations.find((item) => item.id === row.id);
      if (location?.zoneId) ids.add(location.zoneId);
    }
    if (ids.size === 0) return "No zone";
    const codes = [...ids].map((id) => zoneById.get(id)?.code ?? "?").sort();
    return `${codes.length === 1 ? "Zone" : "Zones"} ${codes.join(", ")}`;
  }

  const statusText = placing
    ? ghost?.valid === false
      ? "Invalid footprint"
      : "Click the floor to place · R rotates · Esc cancels"
    : drawing
      ? zoneDraw
        ? "Release to finish the rectangle"
        : zoneDraft
          ? "Name the zone in the inspector, then press Enter"
          : "Drag a rectangle on the floor. Racks and areas placed inside it join the zone."
      : drag
        ? "Release to drop · R rotates · Esc cancels"
        : "Click a rack, area, or zone to select it. Drag to move, R rotates, arrows nudge.";

  return (
    <div className="grid gap-4 xl:grid-cols-[16.5rem_minmax(0,1fr)_19rem]">
      <aside className="space-y-4 rounded-xl border bg-card p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tools</p>
          <h2 className="mt-1 text-sm font-semibold">Place on the floor</h2>
        </div>
        <div className="grid gap-2">
          <ToolButton active={tool === "select"} icon={MousePointer2} label="Select / move" onClick={() => chooseTool("select")} />
          <ToolButton active={tool === "zone"} icon={Grid3x3} label="Zone (draw first)" onClick={() => chooseTool("zone")} disabled={!canEdit} />
          <ToolButton active={tool === "rack"} icon={Warehouse} label="Pallet rack" onClick={() => chooseTool("rack")} disabled={!canEdit} />
          <ToolButton active={tool === "receiving"} icon={Truck} label="Receiving dock" onClick={() => chooseTool("receiving")} disabled={!canEdit} />
          <ToolButton active={tool === "production"} icon={Factory} label="Production cell" onClick={() => chooseTool("production")} disabled={!canEdit} />
          <ToolButton active={tool === "shipping"} icon={ScanLine} label="Outbound staging" onClick={() => chooseTool("shipping")} disabled={!canEdit} />
        </div>
        {tool === "zone" ? (
          <div className="space-y-2 text-[11px] leading-5 text-muted-foreground">
            <p>Drag a rectangle on the floor to mark a zone, then place racks and areas inside it. Bays whose centre falls in the rectangle join the zone; waves can then stay in-zone.</p>
            {zones.length ? (
              <ul className="space-y-1">
                {zones.map((zone) => (
                  <li key={zone.id} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-mono text-foreground">{zone.code}</span> · {zone.name}
                    </span>
                    <span className="font-mono">{hasFootprint(zone) ? `${zone.sizeX}×${zone.sizeY}` : "not drawn"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No zones yet on this floor.</p>
            )}
          </div>
        ) : null}
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
                  onClick={() => setRackDraft((c) => rotateSpec(c, nextRotation(c.rotation)))}
                >
                  <RotateCw className="size-3.5" /> {rackDraft.rotation}°
                </Button>
              </div>
            </div>
          </>
        ) : null}
        <p className="text-[11px] leading-5 text-muted-foreground">
          Click an object to select it and drag to move it. <kbd className="rounded border px-1">R</kbd> rotates, arrows nudge,{" "}
          <kbd className="rounded border px-1">Enter</kbd> drops or places, <kbd className="rounded border px-1">Del</kbd> removes,{" "}
          <kbd className="rounded border px-1">Esc</kbd> cancels. Zones are drawn as rectangles first; objects placed inside join them.
          Right-drag pans, wheel zooms, <kbd className="rounded border px-1">1</kbd>/<kbd className="rounded border px-1">2</kbd> switch Plan and Orbit.
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
          <span className="text-xs text-muted-foreground">{statusText}</span>
        </div>
        <WarehouseScene
          warehouse={data.warehouse}
          locations={data.locations}
          objects={objects}
          zones={drawnZones}
          selectedLocationId={selectedId}
          selectedObjectId={selectedObjectId}
          selectedZoneId={selectedZoneId}
          highlightBay={highlightBay}
          mode="build"
          cameraMode={cameraMode}
          placing={placing}
          drawing={drawing}
          sketching={Boolean(zoneDraw)}
          translating={Boolean(drag)}
          explode={explode}
          levelFilter={levelFilter}
          hiddenObjectId={drag?.moved ? drag.id : null}
          ghost={ghost}
          cursor={cursor}
          onSelectLocation={onSelectLocation}
          onSelectObject={selectObject}
          onSelectZone={selectZone}
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
            if (zoneDraw) {
              setZoneDraw((current) => (current ? { ...current, x1: x, y1: y } : current));
              return;
            }
            setCursor({ x, y });
          }}
          onFloorDown={(x, y) => {
            if (!drawing || !canEdit) return;
            onError(null);
            setZoneDraft(null);
            setSelectedZoneId(null);
            setZoneDraw({ x0: x, y0: y, x1: x, y1: y });
          }}
          onFloorClick={(x, y) => {
            if (drag) {
              void commitDrag();
              return;
            }
            if (placing) {
              void placeAt(x, y);
              return;
            }
            if (drawing) return;
            clearSelection();
          }}
          onDrawEnd={finishZoneDraw}
          onTranslateBegin={(objectId, x, y) => {
            if (placing || drawing || !canEdit) return;
            const object = objects.find((row) => row.id === objectId);
            if (!object) return;
            const origin = objectOrigin(object);
            setDrag({
              id: objectId,
              kind: object.kind,
              ox: x - origin.x,
              oy: y - origin.y,
              x: origin.x,
              y: origin.y,
              originX: origin.x,
              originY: origin.y,
              rotation: object.kind === "rack" ? object.spec.rotation : 0,
              swapped: false,
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
            {zoneDraft
              ? zoneDraft.zoneId
                ? `Draw zone ${zoneDraft.code}`
                : "New zone"
              : selectedZone
                ? `Zone ${selectedZone.code}`
                : selectedRack
                  ? `Rack section ${selectedRack.aisle}-${selectedRack.rack}`
                  : selectedAreaLocation
                    ? selectedAreaLocation.name
                    : "Nothing selected"}
          </h2>
          {!zoneDraft && selectedZone ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedZone.name} · {countZoneBays(selectedZone.id, data.locations)} bays · {selectedZone.sizeX} × {selectedZone.sizeY}
            </p>
          ) : null}
          {!zoneDraft && !selectedZone && selectedBin ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Bay section {padBay(selectedBin.bay ?? "01")} · level {selectedBin.level} · {selectedBin.code}
            </p>
          ) : null}
          {!zoneDraft && !selectedZone && selectedAreaLocation ? (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {selectedAreaLocation.code} · {selectedAreaLocation.type}
            </p>
          ) : null}
        </div>
        {zoneDraft ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Zone" className="col-span-2">
              <select
                className={SELECT_CLASS}
                value={zoneDraft.zoneId ?? ""}
                onChange={(event) => {
                  const id = event.target.value || null;
                  const zone = id ? zoneById.get(id) : null;
                  setZoneDraft((current) =>
                    current
                      ? {
                          ...current,
                          zoneId: id,
                          code: zone ? zone.code : current.zoneId ? nextZoneCode(zones) : current.code,
                          name: zone ? zone.name : current.zoneId ? `Zone ${nextZoneCode(zones)}` : current.name,
                        }
                      : current,
                  );
                }}
              >
                <option value="">New zone</option>
                {zones
                  .filter((zone) => !hasFootprint(zone))
                  .map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.code} · {zone.name} (not drawn yet)
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Code">
              <Input
                className="h-8 font-mono"
                value={zoneDraft.code}
                disabled={Boolean(zoneDraft.zoneId)}
                onChange={(event) => setZoneDraft((current) => (current ? { ...current, code: event.target.value.toUpperCase() } : current))}
              />
            </Field>
            <Field label="Name">
              <Input
                className="h-8"
                value={zoneDraft.name}
                disabled={Boolean(zoneDraft.zoneId)}
                onChange={(event) => setZoneDraft((current) => (current ? { ...current, name: event.target.value } : current))}
              />
            </Field>
            <NumberField label="Origin X" value={zoneDraft.posX} min={0} max={400} onChange={(posX) => setZoneDraft((c) => (c ? { ...c, posX } : c))} />
            <NumberField label="Origin Y" value={zoneDraft.posY} min={0} max={400} onChange={(posY) => setZoneDraft((c) => (c ? { ...c, posY } : c))} />
            <NumberField label="Width" value={zoneDraft.sizeX} max={400} onChange={(sizeX) => setZoneDraft((c) => (c ? { ...c, sizeX } : c))} />
            <NumberField label="Depth" value={zoneDraft.sizeY} max={400} onChange={(sizeY) => setZoneDraft((c) => (c ? { ...c, sizeY } : c))} />
            {ghost?.kind === "zone" && !ghost.valid ? <p className="col-span-2 text-xs text-destructive">{ghost.message}</p> : null}
            <div className="col-span-2 flex gap-2">
              <Button type="button" className="flex-1" disabled={busy || ghost?.valid === false} onClick={() => void saveZoneDraft()}>
                {zoneDraft.zoneId ? "Draw zone" : "Create zone"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setZoneDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : selectedZone ? (
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Code" value={selectedZone.code} mono disabled={!canEdit} onCommit={(code) => void applyZone({ code: code.toUpperCase() }, selectedZone)} />
            <TextField label="Name" value={selectedZone.name} disabled={!canEdit} onCommit={(name) => void applyZone({ name }, selectedZone)} />
            <NumberField label="Origin X" value={selectedZone.posX} min={0} max={400} disabled={!canEdit} onChange={(posX) => void applyZone({ posX }, selectedZone)} />
            <NumberField label="Origin Y" value={selectedZone.posY} min={0} max={400} disabled={!canEdit} onChange={(posY) => void applyZone({ posY }, selectedZone)} />
            <NumberField label="Width" value={selectedZone.sizeX} max={400} disabled={!canEdit} onChange={(sizeX) => void applyZone({ sizeX }, selectedZone)} />
            <NumberField label="Depth" value={selectedZone.sizeY} max={400} disabled={!canEdit} onChange={(sizeY) => void applyZone({ sizeY }, selectedZone)} />
            <p className="col-span-2 text-[11px] leading-5 text-muted-foreground">
              Bays whose centre sits inside the rectangle belong to this zone. Move the rectangle and membership follows; a bay moved out is
              cleared.
            </p>
          </div>
        ) : selectedRack ? (
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
              max={400}
              onChange={(posX) => void applyRack({ posX }, selectedRack)}
            />
            <NumberField
              label="Origin Y"
              value={selectedRack.spec.posY}
              min={0}
              max={400}
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
                onClick={() => void applyRack({ rotation: nextRotation(selectedRack.spec.rotation) }, selectedRack)}
              >
                <RotateCw className="size-3.5" /> Rotate 90° <kbd className="ml-1 rounded border px-1 text-[10px]">R</kbd>
              </Button>
            </div>
            <p className="col-span-2 text-[11px] text-muted-foreground">
              {selectedRack.spec.rotation}° · {zoneLine(selectedRack)}
            </p>
            <BayLevelGrid rack={selectedRack} selectedId={selectedId} onSelectLocation={onSelectLocation} locations={data.locations} />
          </div>
        ) : selectedArea && selectedAreaLocation ? (
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Name" value={selectedAreaLocation.name} disabled={!canEdit} onCommit={(name) => void applyArea({ name }, selectedArea)} />
            <TextField
              label="Code"
              value={selectedAreaLocation.code}
              mono
              disabled={!canEdit}
              onCommit={(code) => void applyArea({ code: code.toUpperCase() }, selectedArea)}
            />
            <NumberField label="Origin X" value={selectedArea.spec.posX} min={0} max={400} onChange={(posX) => void applyArea({ posX }, selectedArea)} />
            <NumberField label="Origin Y" value={selectedArea.spec.posY} min={0} max={400} onChange={(posY) => void applyArea({ posY }, selectedArea)} />
            <NumberField label="Width" value={selectedArea.spec.sizeX} max={400} onChange={(sizeX) => void applyArea({ sizeX }, selectedArea)} />
            <NumberField label="Depth" value={selectedArea.spec.sizeY} max={400} onChange={(sizeY) => void applyArea({ sizeY }, selectedArea)} />
            <NumberField label="Height" value={selectedArea.spec.sizeZ} max={12} onChange={(sizeZ) => void applyArea({ sizeZ }, selectedArea)} />
            <div className="self-end">
              <Button
                type="button"
                variant="outline"
                className="h-8 w-full"
                disabled={busy || !canEdit}
                onClick={() => void applyArea({ sizeX: selectedArea.spec.sizeY, sizeY: selectedArea.spec.sizeX }, selectedArea)}
              >
                <RotateCw className="size-3.5" /> Rotate <kbd className="ml-1 rounded border px-1 text-[10px]">R</kbd>
              </Button>
            </div>
            <p className="col-span-2 text-[11px] text-muted-foreground">
              {zoneLine(selectedArea)} · {selectedAreaLocation.unitsOnHand > 0 ? `${selectedAreaLocation.unitsOnHand} units on hand` : "empty"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a rack to edit bays and levels, an area to rename or resize it, or a zone to move its rectangle. Each rack cell becomes a
            scannable location with its own barcode.
          </p>
        )}
        <Separator />
        <Button
          variant="destructive"
          className="w-full"
          disabled={(!activeObject && !selectedZone) || Boolean(zoneDraft) || busy || !canEdit}
          onClick={() => void removeSelected()}
        >
          <Trash2 className="size-3.5" /> {selectedZone ? "Delete zone" : "Delete object"}
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
