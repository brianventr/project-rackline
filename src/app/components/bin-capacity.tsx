import { useCallback, useState } from "react";
import { Save } from "lucide-react";
import { api, ApiError, type Location } from "../api";
import { Button, Card, ErrorBanner, Field, Input } from "./ui";
import { ActionButton } from "./document";
import { refreshApi } from "../query";
import { useSession } from "../session";
import { useWrite } from "../use-write";
import { cn } from "@/lib/utils";
import {
  capacityFromForm,
  CapacityInputError,
  capacityOf,
  capacityToForm,
  fillTone,
  hasCapacity,
  usageText,
  type BinUsage,
  type CapacityForm,
  type FillTone,
} from "@/domain/capacity";

const METER_FILL: Record<FillTone, string> = {
  ok: "bg-primary",
  near: "bg-tone-warning",
  full: "bg-tone-danger",
};

const FIELDS: { key: keyof CapacityForm; label: string }[] = [
  { key: "maxQty", label: "Max units" },
  { key: "maxWeightLb", label: "Max weight (lb)" },
  { key: "maxVolumeCuFt", label: "Max volume (cu ft)" },
];

/** `60%` with a thin bar; amber from 85%, red once full. */
export function FillMeter({ percent, className }: { percent: number; className?: string }) {
  return (
    <span className={cn("flex min-w-20 items-center justify-end gap-2", className)} title={`${percent}% full`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", METER_FILL[fillTone(percent)])}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{percent}%</span>
    </span>
  );
}

/** An owner's way past LOCATION_FULL: the same request again with `overrideCapacity`. */
export type Overfill = { error: string; bay: string; retry: () => void };

/** `offer` after a failed write; it keeps a retry only for an owner who hit a full bay. */
export function useOverfill() {
  const me = useSession();
  const [overfill, setOverfill] = useState<Overfill | null>(null);
  const offer = useCallback(
    (err: unknown, error: string, retry: () => void) => {
      const bay =
        err instanceof ApiError && err.code === "LOCATION_FULL"
          ? (err.body as { locationCode?: string } | null)?.locationCode
          : undefined;
      setOverfill(me.role === "owner" && bay ? { error, bay, retry } : null);
    },
    [me.role],
  );
  return { overfill, offer };
}

/** Shown only while the banner still shows the error that offered it. */
export function OverfillButton({ overfill, error, busy }: { overfill: Overfill | null; error: string | null; busy?: boolean }) {
  if (!overfill || overfill.error !== error) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" className="h-11 px-4" disabled={busy} onClick={overfill.retry}>
        Fill {overfill.bay} past its limit
      </Button>
      <span className="text-xs text-muted-foreground">Owner override. It is written to the audit log.</span>
    </div>
  );
}

export type CapacityDetail = Location & { usage?: BinUsage; unmeasuredSkus?: string[] };

/** A bay's limits and how full it is. Owners edit; everyone else reads. */
export function BinCapacityCard({ location, canEdit }: { location: CapacityDetail; canEdit: boolean }) {
  const capacity = capacityOf(location);
  const saved = capacityToForm(capacity);
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const { error, run } = useWrite();
  const dirty = FIELDS.some(({ key }) => draft[key] !== saved[key]);
  const limited = hasCapacity(capacity);
  const used = location.usage ? usageText(capacity, location.usage) : null;
  const unmeasured = location.unmeasuredSkus ?? [];

  async function save() {
    let next;
    try {
      next = capacityFromForm(draft);
    } catch (err) {
      if (err instanceof CapacityInputError) {
        setProblem(`${err.message}.`);
        return;
      }
      throw err;
    }
    setProblem(null);
    const row = await run(
      "Save capacity",
      () => api<Location>(`/api/locations/${location.id}`, { method: "PATCH", body: JSON.stringify(next) }),
      "Capacity saved.",
    );
    if (row) {
      setDraft(capacityToForm(capacityOf(row)));
      void refreshApi("/api/locations");
    }
  }

  return (
    <Card>
      <div className="space-y-3">
        <p className="text-sm font-medium">Capacity</p>
        {limited ? (
          <div className="space-y-1">
            {location.fillPercent != null ? <FillMeter percent={location.fillPercent} className="justify-start" /> : null}
            {used ? <p className="font-mono text-xs tabular-nums text-muted-foreground">{used}</p> : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No limit. Receives and moves can put any amount here.</p>
        )}
        {unmeasured.length ? (
          <p className="text-xs text-muted-foreground">
            {unmeasured.join(", ")} {unmeasured.length === 1 ? "has" : "have"} no weight or size, so {unmeasured.length === 1 ? "it counts" : "they count"} only toward units.
          </p>
        ) : null}
        {canEdit ? (
          <>
            <ErrorBanner error={problem ?? error} />
            <div className="grid gap-2">
              {FIELDS.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <Input
                    inputMode="decimal"
                    className="font-mono tabular-nums"
                    placeholder="No limit"
                    value={draft[key]}
                    onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              A receive or move past a limit is refused. Blank means no limit. Weight and size come from each item or its pack sizes.
            </p>
            <div className="flex items-center justify-end gap-2 border-t pt-3">
              {dirty ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(saved);
                    setProblem(null);
                  }}
                >
                  Discard
                </Button>
              ) : null}
              <ActionButton action={{ label: "Save capacity", icon: Save, onSelect: save, disabled: !dirty }} />
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
