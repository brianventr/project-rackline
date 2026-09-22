import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type Location } from "../api";
import { useWarehouse } from "../warehouse";
import { Button, ErrorBanner, Field, Input, Select, onSubmit } from "./ui";
import { bayLabel, matchBays, showCreateBay } from "./bay-match";
import { cn } from "@/lib/utils";

const LOCATION_TYPES = ["receiving", "storage", "production", "shipping"] as const;

type Draft = {
  code: string;
  name: string;
  type: string;
  slotRole: string;
  aisle: string;
  rack: string;
  bay: string;
  level: string;
};

function draftFromQuery(query: string): Draft {
  const seed = query.trim();
  return {
    code: seed.toUpperCase(),
    name: seed,
    type: "storage",
    slotRole: "none",
    aisle: "A",
    rack: "01",
    bay: "01",
    level: "1",
  };
}

export function BayCombobox({
  id,
  locations,
  warehouseId,
  value,
  onChange,
  onCreated,
}: {
  id?: string;
  locations: Location[];
  warehouseId: string;
  value: string;
  onChange: (locationId: string) => void;
  onCreated: (location: Location) => void;
}) {
  const { warehouses } = useWarehouse();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromQuery(""));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = locations.find((location) => location.id === value) ?? null;
  const selectedLabel = selected ? bayLabel(selected) : "";
  const bays = useMemo(
    () => locations.filter((location) => location.warehouseId === warehouseId),
    [locations, warehouseId],
  );
  const filterQuery = editing && query !== selectedLabel ? query : "";
  const matches = useMemo(() => matchBays(bays, filterQuery), [bays, filterQuery]);
  const offerCreate = showCreateBay(filterQuery, matches);
  const rows = offerCreate ? [{ kind: "create" as const }] : matches.map((location) => ({ kind: "bay" as const, location }));
  const active = Math.min(activeIndex, Math.max(rows.length - 1, 0));

  function closeList() {
    setOpen(false);
    setEditing(false);
  }

  function choose(location: Location) {
    onChange(location.id);
    setQuery("");
    setActiveIndex(0);
    closeList();
  }

  function openCreate() {
    setDraft(draftFromQuery(filterQuery));
    setFormError(null);
    setCreating(true);
    closeList();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeList();
      return;
    }
    if (event.key === "Enter" && open && rows[active]) {
      event.preventDefault();
      const row = rows[active];
      if (row.kind === "create") openCreate();
      else choose(row.location);
    }
  }

  async function createBay() {
    setFormError(null);
    if (!warehouseId) {
      setFormError("Create a warehouse first");
      return;
    }
    setSaving(true);
    try {
      const created = await api<Location>("/api/locations", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          code: draft.code,
          name: draft.name,
          type: draft.type,
          barcode: draft.code,
          slotRole: draft.type === "storage" ? draft.slotRole : "none",
          aisle: draft.type === "storage" ? draft.aisle : undefined,
          rack: draft.type === "storage" ? draft.rack : undefined,
          bay: draft.type === "storage" ? draft.bay : undefined,
          level: Number(draft.level),
        }),
      });
      const warehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? "";
      const location: Location = { ...created, warehouseName: created.warehouseName || warehouseName };
      onCreated(location);
      onChange(location.id);
      setQuery("");
      setCreating(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create bay");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeList();
      }}
    >
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? `${id ?? "bay"}-listbox` : undefined}
        autoComplete="off"
        placeholder="Bay code or name"
        value={editing ? query : selectedLabel}
        onFocus={(event) => {
          setEditing(true);
          setQuery(selectedLabel);
          setOpen(true);
          setActiveIndex(0);
          const input = event.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onChange={(event) => {
          setEditing(true);
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          id={`${id ?? "bay"}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {rows.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">No bays yet. Type a code to create one.</li>
          ) : null}
          {rows.map((row, index) =>
            row.kind === "create" ? (
              <li key="create" role="option" aria-selected={index === active}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full rounded-sm px-2 py-1.5 text-left text-xs font-medium",
                    index === active ? "bg-accent" : "hover:bg-accent",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={openCreate}
                >
                  Create new bay
                  {filterQuery ? <span className="ml-2 font-mono font-normal text-muted-foreground">{filterQuery}</span> : null}
                </button>
              </li>
            ) : (
              <li key={row.location.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left",
                    index === active ? "bg-accent" : "hover:bg-accent",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(row.location)}
                >
                  <span className="font-mono text-xs">{row.location.code}</span>
                  <span className="truncate text-xs text-muted-foreground">{row.location.name}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      ) : null}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New bay</DialogTitle>
            <DialogDescription>Add a bay in this warehouse and receive into it.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit(createBay)}>
            {formError ? (
              <div className="sm:col-span-2">
                <ErrorBanner error={formError} />
              </div>
            ) : null}
            <Field label="Code">
              <Input value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} required />
            </Field>
            <Field label="Name">
              <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required />
            </Field>
            <Field label="Type">
              <Select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}>
                {LOCATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.type === "storage" ? (
              <Field label="Slot role">
                <Select value={draft.slotRole} onChange={(event) => setDraft((current) => ({ ...current, slotRole: event.target.value }))}>
                  <option value="none">none</option>
                  <option value="pick">pick</option>
                  <option value="bulk">bulk</option>
                </Select>
              </Field>
            ) : null}
            <Field label="Level">
              <Input
                type="number"
                min={1}
                value={draft.level}
                onChange={(event) => setDraft((current) => ({ ...current, level: event.target.value }))}
              />
            </Field>
            {draft.type === "storage" ? (
              <>
                <Field label="Aisle">
                  <Input value={draft.aisle} onChange={(event) => setDraft((current) => ({ ...current, aisle: event.target.value }))} />
                </Field>
                <Field label="Rack">
                  <Input value={draft.rack} onChange={(event) => setDraft((current) => ({ ...current, rack: event.target.value }))} />
                </Field>
                <Field label="Bay">
                  <Input value={draft.bay} onChange={(event) => setDraft((current) => ({ ...current, bay: event.target.value }))} />
                </Field>
              </>
            ) : null}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create bay"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
