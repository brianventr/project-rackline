import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LockOpen, Plus, ScanLine, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api, type Hold, type Item, type Location } from "../api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  ToneBadge,
} from "../components/ui";
import {
  DetailSkeleton,
  DocumentActivity,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type BulkAction, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, Muted, RelativeTime } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { refreshApi, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { HOLD_STEPS, canReleaseHold, isOpenHoldStatus } from "@/domain/status";
import { HOLD_REASONS, holdLabel, holdScope } from "@/domain/holds";
import { useWarehouse, inWarehouse } from "../warehouse";

export function HoldsPage() {
  const { id } = useParams();
  if (id) return <HoldDetail id={id} />;
  return <HoldList />;
}

const SCOPE_LABEL = { bay: "Whole bay", sku: "SKU", lot: "Lot" } as const;

function scopeOf(hold: Hold) {
  return holdScope({ locationId: hold.locationId, itemId: hold.itemId, lotCode: hold.lotCode });
}

/** What stops working while the hold is open, in the words the floor uses. */
function releaseBody(hold: Hold): string {
  return `Pick, replenish, kit, and move can use ${holdLabel(hold)} again. A released hold cannot be reopened; place a new one if you need it back.`;
}

const HOLD_TABS: TabDef<Hold>[] = [
  { id: "open", label: "Open", match: (hold) => isOpenHoldStatus(hold.status) },
  { id: "released", label: "Released", match: (hold) => hold.status === "released" },
  { id: "all", label: "All", match: () => true },
];

const HOLD_FACETS: FacetDef<Hold>[] = [
  { id: "reason", label: "Reason", value: (hold) => hold.reason },
  {
    id: "scope",
    label: "Scope",
    value: (hold) => scopeOf(hold),
    format: (value) => SCOPE_LABEL[value as keyof typeof SCOPE_LABEL] ?? value,
  },
];

const HOLD_COLUMNS: DataColumn<Hold>[] = [
  {
    id: "number",
    header: "Hold",
    sortValue: (hold) => hold.number,
    cell: (hold) => <DocLink to={`/stock/holds/${hold.id}`}>{hold.number}</DocLink>,
  },
  {
    id: "scope",
    header: "Scope",
    sortValue: (hold) => holdLabel(hold),
    csv: (hold) => holdLabel(hold),
    cell: (hold) => (
      <span className="flex flex-col">
        <span className="font-mono">{holdLabel(hold)}</span>
        <span className="text-xs text-muted-foreground">
          {SCOPE_LABEL[scopeOf(hold)]}
          {hold.itemName ? ` · ${hold.itemName}` : ""}
        </span>
      </span>
    ),
  },
  {
    id: "reason",
    header: "Reason",
    sortValue: (hold) => hold.reason,
    cell: (hold) => (
      <ToneBadge tone={hold.reason === "Recall" || hold.reason === "Damaged" ? "danger" : "warning"} className="normal-case">
        {hold.reason}
      </ToneBadge>
    ),
  },
  {
    id: "notes",
    header: "Notes",
    defaultHidden: true,
    sortValue: (hold) => hold.notes ?? null,
    cell: (hold) => (hold.notes ? <span className="text-muted-foreground">{hold.notes}</span> : <Muted>—</Muted>),
  },
  {
    id: "placed",
    header: "Placed",
    sortValue: (hold) => hold.createdAt,
    csv: (hold) => new Date(hold.createdAt).toISOString(),
    cell: (hold) => <RelativeTime at={hold.createdAt} />,
  },
  {
    id: "released",
    header: "Released",
    defaultHidden: true,
    sortValue: (hold) => hold.releasedAt ?? null,
    csv: (hold) => (hold.releasedAt ? new Date(hold.releasedAt).toISOString() : ""),
    cell: (hold) => <RelativeTime at={hold.releasedAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (hold) => HOLD_STEPS.indexOf(hold.status as (typeof HOLD_STEPS)[number]),
    csv: (hold) => hold.status,
    cell: (hold) => <StatusBadge status={hold.status} />,
  },
];

function HoldList() {
  const { warehouseId } = useWarehouse();
  const holds = useApiQuery<Hold[]>("/api/holds");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => inWarehouse(holds.data ?? [], warehouseId), [holds.data, warehouseId]);

  const bulkActions: BulkAction<Hold>[] = [
    {
      label: "Release",
      icon: LockOpen,
      when: (selected) => selected.every((hold) => canReleaseHold(hold.status)),
      confirm: (selected) => ({
        title: selected.length === 1 ? `Release ${selected[0]!.number}?` : `Release ${selected.length} holds?`,
        body:
          selected.length === 1
            ? releaseBody(selected[0]!)
            : "Pick, replenish, kit, and move can use this stock again. Released holds cannot be reopened.",
        confirmLabel: selected.length === 1 ? "Release hold" : "Release holds",
        cancelLabel: "Keep on hold",
      }),
      run: async (selected) => {
        const results = await Promise.allSettled(
          selected.map((hold) => api(`/api/holds/${hold.id}/release`, { method: "POST" })),
        );
        void refreshApi();
        const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        if (failed.length) {
          toast.error(
            `${failed.length} could not be released: ${failed[0]!.reason instanceof Error ? failed[0]!.reason.message : "error"}`,
          );
        }
        const released = selected.length - failed.length;
        if (released) toast.success(`Released ${released} ${released === 1 ? "hold" : "holds"}. That stock is available again.`);
      },
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Stock"
        title="Holds"
        description="Lock a bay, a SKU in a bay, or a lot so pick, replenish, kit, and move skip it. Qty stays on the ledger until you release."
      />
      <DataTable
        id="holds"
        data={rows}
        loading={holds.isLoading}
        error={holds.error?.message}
        columns={HOLD_COLUMNS}
        getRowId={(hold) => hold.id}
        rowHref={(hold) => `/stock/holds/${hold.id}`}
        tabs={HOLD_TABS}
        defaultTab="open"
        facets={HOLD_FACETS}
        defaultSort={{ id: "placed", desc: true }}
        search={{
          placeholder: "Search hold, SKU, bay, lot",
          text: (hold) =>
            [hold.number, hold.sku, hold.itemName, hold.locationCode, hold.lotCode, hold.reason, hold.notes]
              .filter(Boolean)
              .join(" "),
        }}
        bulkActions={bulkActions}
        exportName="holds"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Place hold
          </Button>
        }
        empty={
          <EmptyState
            icon={ShieldAlert}
            title="No holds yet."
            body="Hold a bay, SKU, or lot for QC, damage, or a recall. Nothing ships from it until you release."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                Place hold
              </Button>
            }
          />
        }
      />
      <NewHoldSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewHoldSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const locations = useApiQuery<Location[]>(open ? "/api/locations" : null);
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [reason, setReason] = useState<(typeof HOLD_REASONS)[number]>("QC");
  const [notes, setNotes] = useState("");
  const { error, setError, busy, run } = useWrite();

  useEffect(() => {
    if (open) setError(null);
  }, [open, setError]);

  useEffect(() => {
    const list = locations.data ?? [];
    if (locationId && list.some((location) => location.id === locationId)) return;
    const storage = list.find((location) => location.type === "storage") ?? list[0];
    if (storage) setLocationId(storage.id);
  }, [locations.data, locationId]);

  const selectedItem = (items.data ?? []).find((item) => item.id === itemId);

  async function place() {
    const created = await run(
      "Place hold",
      () =>
        api<Hold>("/api/holds", {
          method: "POST",
          body: JSON.stringify({
            warehouseId,
            locationId,
            itemId: itemId || undefined,
            lotCode: lotCode.trim() || undefined,
            reason,
            notes: notes.trim() || undefined,
          }),
        }),
      (hold) => `Hold ${hold.number} placed. Pick, replenish, kit, and move skip ${holdLabel(hold)}.`,
    );
    if (!created) return;
    onOpenChange(false);
    navigate(`/stock/holds/${created.id}`);
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Place hold"
      description="Hold a whole bay, one SKU in it, or one lot. Stock stays on the ledger but nothing picks or moves it."
      submitLabel="Place hold"
      onSubmit={place}
      busy={busy}
      error={error ?? locations.error?.message ?? items.error?.message ?? null}
    >
      <Field label="Location">
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={locations.isLoading}>
          {(locations.data ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.code} — {location.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="SKU (optional)">
        <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Whole bay</option>
          {(items.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.sku} — {item.name}
            </option>
          ))}
        </Select>
      </Field>
      {selectedItem?.trackLot ? (
        <Field label="Lot (optional)">
          <Input value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="LOT-…" />
        </Field>
      ) : null}
      <Field label="Reason">
        <Select value={reason} onChange={(e) => setReason(e.target.value as (typeof HOLD_REASONS)[number])}>
          {HOLD_REASONS.map((row) => (
            <option key={row} value={row}>
              {row}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>
    </FormSheet>
  );
}

function HoldDetail({ id }: { id: string }) {
  const [active, setActive] = useState<Hold | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { error, run } = useWrite();

  useEffect(() => {
    api<Hold>(`/api/holds/${id}`)
      .then(setActive)
      .catch((err: Error) => setLoadError(err.message));
  }, [id]);

  async function release() {
    const next = await run(
      "Release hold",
      () => api<Hold>(`/api/holds/${id}/release`, { method: "POST" }),
      (hold) => `Released ${hold.number}. ${holdLabel(hold)} is available again.`,
    );
    if (next) setActive(next);
  }

  if (!active) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const scope = scopeOf(active);
  const primary: DocumentAction | null = canReleaseHold(active.status)
    ? {
        label: "Release hold",
        icon: LockOpen,
        onSelect: release,
        confirm: {
          title: `Release ${active.number}?`,
          body: releaseBody(active),
          confirmLabel: "Release hold",
          cancelLabel: "Keep on hold",
        },
      }
    : null;

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Stock"
        list={{ label: "Holds", to: "/stock/holds" }}
        title={active.number}
        description={`${holdLabel(active)} · ${active.reason}`}
        status={active.status}
        steps={HOLD_STEPS}
        primary={primary}
        menu={[{ label: "Open on floor", icon: ScanLine, to: `/floor/hold?id=${active.id}` }]}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Hold</p>
                <DocumentFact label="Scope">{SCOPE_LABEL[scope]}</DocumentFact>
                <DocumentFact label="Location">
                  <Link className="font-mono underline underline-offset-2" to={`/stock/locations/${active.locationId}`}>
                    {active.locationCode || "Bay"}
                  </Link>
                </DocumentFact>
                {active.itemId ? (
                  <DocumentFact label="SKU">
                    <Link className="font-mono underline underline-offset-2" to={`/stock/items/${active.itemId}`}>
                      {active.sku || "SKU"}
                    </Link>
                  </DocumentFact>
                ) : null}
                {active.lotCode ? (
                  <DocumentFact label="Lot">
                    <span className="font-mono">{active.lotCode}</span>
                  </DocumentFact>
                ) : null}
                <DocumentFact label="Reason">{active.reason}</DocumentFact>
                <DocumentFact label="Placed">
                  <RelativeTime at={active.createdAt} />
                </DocumentFact>
                {active.releasedAt ? (
                  <DocumentFact label="Released">
                    <RelativeTime at={active.releasedAt} />
                  </DocumentFact>
                ) : null}
              </div>
            </Card>
          </DocumentRail>
        }
      >
        {canReleaseHold(active.status) ? (
          <div className="flex items-start gap-2 rounded-lg border border-tone-warning/30 bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>Pick, replenish, kit, and move skip {holdLabel(active)} until this hold is released.</span>
          </div>
        ) : null}
        {active.notes ? (
          <Card>
            <p className="mb-1 text-sm font-medium">Notes</p>
            <p className="text-sm text-muted-foreground">{active.notes}</p>
          </Card>
        ) : null}
        <DocumentActivity refId={active.id} refreshKey={active.status} />
      </DocumentFrame>
    </div>
  );
}
