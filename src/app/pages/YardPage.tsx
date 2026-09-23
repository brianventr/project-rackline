import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDownToLine, Container, DoorOpen, LogIn, LogOut, Plus, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { api, errorText, type Asn, type Location, type Purchase, type YardVisit } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, PageHeader, Select, StatusBadge } from "../components/ui";
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
import { TextField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
import { apiMutate, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { yardVisitFormSchema } from "@/domain/form-schemas";
import { YARD_STEPS, canAssignDock, canCheckInYard, canCheckOutYard, isOpenAsn, isOpenYard } from "@/domain/status";
import { canReceiveLinkedAsn } from "@/domain/yard";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LinesBar, RailCard, countOf, runEach } from "./ReceiptsPage";

export function YardPage() {
  const { id } = useParams();
  if (id) return <YardDetail id={id} />;
  return <YardList />;
}

type YardRow = YardVisit & { dockCode: string | null };

const YARD_TABS: TabDef<YardRow>[] = [
  { id: "open", label: "Open", match: (visit) => isOpenYard(visit.status) },
  { id: "expected", label: "Expected", match: (visit) => visit.status === "expected" },
  { id: "checked_in", label: "Checked in", match: (visit) => visit.status === "checked_in" },
  { id: "at_dock", label: "At dock", match: (visit) => visit.status === "at_dock" },
  { id: "checked_out", label: "Checked out", match: (visit) => visit.status === "checked_out" },
  { id: "all", label: "All", match: () => true },
];

const YARD_FACETS: FacetDef<YardRow>[] = [
  { id: "carrier", label: "Carrier", value: (visit) => visit.carrierName },
  { id: "dock", label: "Dock", value: (visit) => visit.dockCode },
];

const YARD_COLUMNS: DataColumn<YardRow>[] = [
  {
    id: "number",
    header: "Visit",
    sortValue: (visit) => visit.number,
    cell: (visit) => <DocLink to={`/inbound/yard/${visit.id}`}>{visit.number}</DocLink>,
  },
  {
    id: "carrier",
    header: "Carrier",
    sortValue: (visit) => visit.carrierName,
    cell: (visit) => (
      <span className="flex flex-col">
        <span className="font-medium">{visit.carrierName}</span>
        {visit.notes ? <span className="line-clamp-1 text-xs text-muted-foreground">{visit.notes}</span> : null}
      </span>
    ),
  },
  {
    id: "trailer",
    header: "Trailer",
    sortValue: (visit) => visit.trailerNumber ?? null,
    cell: (visit) => (visit.trailerNumber ? <span className="font-mono">{visit.trailerNumber}</span> : <Muted>—</Muted>),
  },
  {
    id: "dock",
    header: "Dock",
    sortValue: (visit) => visit.dockCode,
    cell: (visit) => (visit.dockCode ? <span className="font-mono">{visit.dockCode}</span> : <Muted>—</Muted>),
  },
  {
    id: "eta",
    header: "ETA",
    sortValue: (visit) => visit.eta ?? null,
    csv: (visit) => (visit.eta ? new Date(visit.eta).toISOString() : ""),
    cell: (visit) => <RelativeTime at={visit.eta} />,
  },
  {
    id: "checkedIn",
    header: "Checked in",
    sortValue: (visit) => visit.checkedInAt ?? null,
    csv: (visit) => (visit.checkedInAt ? new Date(visit.checkedInAt).toISOString() : ""),
    cell: (visit) => <RelativeTime at={visit.checkedInAt} />,
  },
  {
    id: "created",
    header: "Created",
    defaultHidden: true,
    sortValue: (visit) => visit.createdAt,
    csv: (visit) => new Date(visit.createdAt).toISOString(),
    cell: (visit) => <RelativeTime at={visit.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (visit) => YARD_STEPS.indexOf(visit.status as (typeof YARD_STEPS)[number]),
    csv: (visit) => visit.status,
    cell: (visit) => <StatusBadge status={visit.status} />,
  },
];

const YARD_BULK: BulkAction<YardRow>[] = [
  {
    label: "Check in",
    icon: LogIn,
    when: (selected) => selected.every((visit) => canCheckInYard(visit.status)),
    run: (selected) =>
      runEach(selected, (visit) => api(`/api/yard/${visit.id}/check-in`, { method: "POST" }), {
        done: (count) => `Checked in ${countOf(count, "visit")}.`,
        failed: "could not check in",
      }),
  },
];

function YardList() {
  const { warehouseId } = useWarehouse();
  const visits = useApiQuery<YardVisit[]>("/api/yard");
  const locations = useApiQuery<Location[]>("/api/locations");
  const [creating, setCreating] = useState(false);

  const rows = useMemo<YardRow[]>(() => {
    const codes = new Map((locations.data ?? []).map((location) => [location.id, location.code]));
    return inWarehouse(visits.data ?? [], warehouseId).map((visit) => ({
      ...visit,
      dockCode: visit.dockLocationId ? (codes.get(visit.dockLocationId) ?? null) : null,
    }));
  }, [visits.data, locations.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Inbound"
        title="Yard"
        description={
          <>
            <Term id="yard-visit">Carrier visits</Term>: check in at the gate, assign a <Term id="dock">dock</Term>, check
            out when clear.
          </>
        }
      />
      <DataTable
        id="yard"
        data={rows}
        loading={visits.isLoading}
        error={visits.error?.message}
        columns={YARD_COLUMNS}
        getRowId={(visit) => visit.id}
        rowHref={(visit) => `/inbound/yard/${visit.id}`}
        tabs={YARD_TABS}
        defaultTab="open"
        facets={YARD_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search visit, carrier, trailer",
          text: (visit) => [visit.number, visit.carrierName, visit.trailerNumber, visit.dockCode, visit.notes].filter(Boolean).join(" "),
        }}
        bulkActions={YARD_BULK}
        exportName="yard"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New visit
          </Button>
        }
        empty={
          <EmptyState
            icon={Container}
            title="No yard visits yet."
            body="Log a carrier before the truck arrives, then check it in at the gate and send it to a dock."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New visit
              </Button>
            }
          />
        }
      />
      <NewVisitSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewVisitSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const form = useZodForm(yardVisitFormSchema, { carrierName: "", trailerNumber: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep what was typed between opens, but start each open without stale inline errors.
  const { reset, getValues } = form;
  useEffect(() => {
    if (open) reset(getValues(), { keepDefaultValues: true });
  }, [open, reset, getValues]);

  async function create(values: ZodFormOutput<typeof yardVisitFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      const created = await apiMutate<YardVisit>("/api/yard", {
        body: JSON.stringify({
          warehouseId,
          carrierName: values.carrierName,
          trailerNumber: values.trailerNumber.trim() || undefined,
          notes: values.notes.trim() || undefined,
        }),
      });
      toast.success(`Visit ${created.number} created.`);
      onOpenChange(false);
      navigate(`/inbound/yard/${created.id}`);
    } catch (err) {
      setError(errorText(err, "Could not create the visit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New yard visit"
      description="A truck you expect at the gate. Check it in when it arrives."
      submitLabel="Create visit"
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
    >
      <TextField form={form} name="carrierName" label="Carrier" placeholder="Swift Freight" autoFocus />
      <TextField form={form} name="trailerNumber" label="Trailer" placeholder="TRL-…" />
      <TextField form={form} name="notes" label="Notes" />
    </FormSheet>
  );
}

function YardDetail({ id }: { id: string }) {
  const [visit, setVisit] = useState<YardVisit | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [dockLocationId, setDockLocationId] = useState("");
  const { error, setError, run } = useWrite();
  const linkedAsn = useApiQuery<Asn>(visit?.asnId ? `/api/asns/${visit.asnId}` : null);
  const linkedPurchase = useApiQuery<Purchase>(visit?.purchaseId ? `/api/purchases/${visit.purchaseId}` : null);

  async function load() {
    const [next, nextLocations] = await Promise.all([
      api<YardVisit>(`/api/yard/${id}`),
      api<Location[]>("/api/locations"),
    ]);
    setVisit(next);
    const docks = nextLocations.filter((row) => row.type === "receiving" || row.warehouseId === next.warehouseId);
    setLocations(docks.length ? docks : nextLocations);
    const dock =
      nextLocations.find((row) => row.id === next.dockLocationId) ??
      nextLocations.find((row) => row.type === "receiving" && row.warehouseId === next.warehouseId) ??
      nextLocations[0];
    if (dock) setDockLocationId(dock.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function checkIn() {
    const next = await run("Check in", () => api<YardVisit>(`/api/yard/${id}/check-in`, { method: "POST" }), "Checked in at the gate.");
    if (next) setVisit(next);
  }

  async function assignDock() {
    const code = locations.find((row) => row.id === dockLocationId)?.code;
    const next = await run(
      "Assign dock",
      () =>
        api<YardVisit>(`/api/yard/${id}/dock`, {
          method: "POST",
          body: JSON.stringify({ dockLocationId }),
        }),
      `Sent to dock${code ? ` ${code}` : ""}.`,
    );
    if (next) setVisit(next);
  }

  async function checkOut() {
    const next = await run("Check out", () => api<YardVisit>(`/api/yard/${id}/check-out`, { method: "POST" }), "Checked out. The dock is clear.");
    if (next) setVisit(next);
  }

  async function receiveAsn() {
    await run(
      "Receive ASN",
      async () => {
        await api(`/api/yard/${id}/receive-asn`, { method: "POST" });
        await load();
      },
      "Received the linked ASN onto the dock.",
    );
  }

  if (!visit) return error ? <ErrorBanner error={error} /> : <DetailSkeleton />;

  const dock = locations.find((row) => row.id === (visit.dockLocationId || dockLocationId));
  const assignedDock = visit.dockLocationId ? locations.find((row) => row.id === visit.dockLocationId) : undefined;
  const receivableAsn = canReceiveLinkedAsn(visit);
  // The visit alone cannot tell whether its ASN is still open; lead with Receive ASN only while it is.
  const asnWaiting = receivableAsn && (linkedAsn.data ? isOpenAsn(linkedAsn.data.status) : !linkedAsn.isLoading);

  const dockAction: DocumentAction = {
    label: "Assign dock",
    icon: DoorOpen,
    onSelect: assignDock,
    disabled: !dockLocationId,
  };
  const checkOutAction: DocumentAction = { label: "Check out", icon: LogOut, onSelect: checkOut };
  const receiveAction: DocumentAction = { label: "Receive ASN", icon: ArrowDownToLine, onSelect: receiveAsn };

  let primary: DocumentAction | null = null;
  const menu: DocumentAction[] = [];
  if (canCheckInYard(visit.status)) {
    primary = { label: "Check in", icon: LogIn, onSelect: checkIn };
  } else if (visit.status === "checked_in") {
    primary = dockAction;
    if (canCheckOutYard(visit.status)) menu.push(checkOutAction);
  } else if (visit.status === "at_dock") {
    primary = asnWaiting ? receiveAction : checkOutAction;
    if (receivableAsn && !asnWaiting) menu.push(receiveAction);
    if (asnWaiting) menu.push(checkOutAction);
    if (canAssignDock(visit.status)) menu.push(dockAction);
  }
  menu.unshift({ label: "Open on floor", icon: ScanLine, to: `/floor/yard?id=${visit.id}` });

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Inbound"
        list={{ label: "Yard", to: "/inbound/yard" }}
        title={visit.number}
        description={`${visit.carrierName}${visit.trailerNumber ? ` · ${visit.trailerNumber}` : ""}${visit.notes ? ` · ${visit.notes}` : ""}`}
        status={visit.status}
        steps={YARD_STEPS}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <RailCard title="Visit">
              <DocumentFact label="Carrier">{visit.carrierName}</DocumentFact>
              <DocumentFact label="Trailer">
                {visit.trailerNumber ? <span className="font-mono">{visit.trailerNumber}</span> : <Muted>—</Muted>}
              </DocumentFact>
              <DocumentFact label="Dock">
                {assignedDock ? <span className="font-mono">{assignedDock.code}</span> : <Muted>Not assigned</Muted>}
              </DocumentFact>
              {visit.asnId ? (
                <DocumentFact label="ASN">
                  <span className="inline-flex items-center gap-2">
                    <Link className="font-mono underline" to={`/inbound/asns/${visit.asnId}`}>
                      {linkedAsn.data?.number ?? "Open"}
                    </Link>
                    {linkedAsn.data ? <StatusBadge status={linkedAsn.data.status} /> : null}
                  </span>
                </DocumentFact>
              ) : null}
              {visit.purchaseId ? (
                <DocumentFact label="Purchase">
                  <Link className="font-mono underline" to={`/inbound/purchases/${visit.purchaseId}`}>
                    {linkedPurchase.data?.number ?? "Open"}
                  </Link>
                </DocumentFact>
              ) : null}
              {visit.eta ? (
                <DocumentFact label="ETA">
                  <RelativeTime at={visit.eta} />
                </DocumentFact>
              ) : null}
              {visit.checkedInAt ? (
                <DocumentFact label="Checked in">
                  <RelativeTime at={visit.checkedInAt} />
                </DocumentFact>
              ) : null}
              {visit.checkedOutAt ? (
                <DocumentFact label="Checked out">
                  <RelativeTime at={visit.checkedOutAt} />
                </DocumentFact>
              ) : null}
              <DocumentFact label="Created">
                <RelativeTime at={visit.createdAt} />
              </DocumentFact>
            </RailCard>
          </DocumentRail>
        }
      >
        {canAssignDock(visit.status) ? (
          <LinesBar
            hint={
              visit.asnId
                ? "Assigning a dock points the linked ASN at that bay, so it receives there."
                : "Pick the door this trailer backs into."
            }
          >
            <Field label="Dock">
              <Select value={dockLocationId} onChange={(e) => setDockLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </Select>
            </Field>
          </LinesBar>
        ) : dock && visit.dockLocationId ? (
          <Card>
            <p className="text-sm">
              Dock <span className="font-mono">{dock.code}</span> — {dock.name}
            </p>
          </Card>
        ) : canCheckInYard(visit.status) ? (
          <EmptyState
            icon={Container}
            title="Expected at the gate."
            body="Check the trailer in when it arrives, then send it to a dock."
          />
        ) : null}
        <DocumentActivity refId={visit.id} refreshKey={visit.status} />
      </DocumentFrame>
    </div>
  );
}
