import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWatch } from "react-hook-form";
import { Lock, LockOpen, Plus, ScanLine, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api, errorText, type Hold, type Item, type Location } from "../api";
import { Button, Card, EmptyState, ErrorBanner, PageHeader, StatusBadge, ToneBadge } from "../components/ui";
import { SelectField, TextField, useZodForm, type ZodFormInput, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
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
import { holdFormSchema } from "@/domain/form-schemas";
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
          // The count leads; the server's own sentence (and its fix) goes underneath, unwrapped.
          toast.error(`${failed.length} could not be released.`, {
            description: errorText(failed[0]!.reason, "Something went wrong. Try again."),
          });
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
        description={
          <>
            Lock a bay, a SKU in a bay, or a <Term id="lot">lot</Term> so pick, replenish, kit, and move skip it. Qty stays
            on the <Term id="ledger">ledger</Term> until you release.
          </>
        }
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
            icon={Lock}
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

type NewHoldInput = ZodFormInput<typeof holdFormSchema>;
type NewHoldValues = ZodFormOutput<typeof holdFormSchema>;

const NEW_HOLD_DEFAULTS: NewHoldInput = { locationId: "", itemId: "", lotCode: "", reason: "QC", notes: "" };
const HOLD_REASON_OPTIONS = HOLD_REASONS.map((reason) => ({ value: reason, label: reason }));

function NewHoldSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const locations = useApiQuery<Location[]>(open ? "/api/locations" : null);
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const form = useZodForm(holdFormSchema, NEW_HOLD_DEFAULTS);
  const itemId = useWatch({ control: form.control, name: "itemId" });
  const { error, setError, busy, run } = useWrite();

  // Keep what was typed between opens, but start each open without stale inline errors.
  const { reset, getValues, setValue } = form;
  useEffect(() => {
    if (!open) return;
    setError(null);
    reset(getValues(), { keepDefaultValues: true });
  }, [open, setError, reset, getValues]);

  // Preselect the first storage bay (else the first bay) once the list loads, as before.
  useEffect(() => {
    const list = locations.data ?? [];
    const locationId = getValues("locationId");
    if (locationId && list.some((location) => location.id === locationId)) return;
    const storage = list.find((location) => location.type === "storage") ?? list[0];
    if (storage) setValue("locationId", storage.id);
  }, [locations.data, getValues, setValue]);

  const selectedItem = (items.data ?? []).find((item) => item.id === itemId);

  // The lot field only shows for a lot-tracked SKU. When the SKU changes to one without lots,
  // drop the lot too, so a hidden value is never sent.
  const hideLot = Boolean(items.data) && !selectedItem?.trackLot;
  useEffect(() => {
    if (hideLot && getValues("lotCode")) setValue("lotCode", "");
  }, [hideLot, getValues, setValue]);

  async function place(values: NewHoldValues) {
    const created = await run(
      "Place hold",
      () =>
        api<Hold>("/api/holds", {
          method: "POST",
          body: JSON.stringify({
            warehouseId,
            locationId: values.locationId,
            itemId: values.itemId || undefined,
            lotCode: values.lotCode.trim() || undefined,
            reason: values.reason,
            notes: values.notes.trim() || undefined,
          }),
        }),
      (hold) => `Hold ${hold.number} placed. Pick, replenish, kit, and move skip ${holdLabel(hold)}.`,
    );
    if (!created) return;
    onOpenChange(false);
    navigate(`/stock/holds/${created.id}`);
  }

  const locationOptions = (locations.data ?? []).map((location) => ({
    value: location.id,
    label: `${location.code} — ${location.name}`,
  }));
  const itemOptions = (items.data ?? []).map((item) => ({ value: item.id, label: `${item.sku} — ${item.name}` }));

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Place hold"
      description="Hold a whole bay, one SKU in it, or one lot. Stock stays on the ledger but nothing picks or moves it."
      submitLabel="Place hold"
      onSubmit={form.handleSubmit(place)}
      busy={busy}
      error={error ?? locations.error?.message ?? items.error?.message ?? null}
    >
      <SelectField
        form={form}
        name="locationId"
        label="Location"
        options={locationOptions}
        placeholder={locationOptions.length ? undefined : locations.isLoading ? "Loading bays…" : "No bays yet"}
      />
      <SelectField form={form} name="itemId" label="SKU (optional)" options={itemOptions} placeholder="Whole bay" />
      {selectedItem?.trackLot ? <TextField form={form} name="lotCode" label="Lot (optional)" placeholder="LOT-…" /> : null}
      <SelectField form={form} name="reason" label="Reason" options={HOLD_REASON_OPTIONS} />
      <TextField form={form} name="notes" label="Notes" placeholder="Optional" />
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
      .catch((err: unknown) => setLoadError(errorText(err, "Could not load this hold. Try again.")));
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
