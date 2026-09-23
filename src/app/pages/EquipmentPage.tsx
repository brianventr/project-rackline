import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Forklift, LogIn, LogOut, Plus, Printer, ScanLine, ShieldAlert, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api, type Equipment, type EquipmentAudit, type TeamMember } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
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
  Table,
  ToneBadge,
  onSubmit,
} from "../components/ui";
import {
  DetailSkeleton,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, Muted, PersonAvatar, RelativeTime } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { apiMutate, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { EQUIPMENT_ASSIGNMENT_STEPS } from "@/domain/status";
import {
  EQUIPMENT_CLASSES,
  checklistForClass,
  equipmentClassLabel,
  type InspectionAnswer,
} from "@/domain/equipment";
import { useSession } from "../session";
import { useWarehouse, inWarehouse } from "../warehouse";

export function EquipmentPage() {
  const { id } = useParams();
  if (id) return <EquipmentDetail id={id} />;
  return <EquipmentList />;
}

function shiftAndTask(assignment: { shift: string | null; taskNumber?: string | null; refType: string | null } | null | undefined) {
  if (!assignment) return "";
  return [assignment.shift, assignment.taskNumber || assignment.refType].filter(Boolean).join(" · ");
}

const EQUIPMENT_TABS: TabDef<Equipment>[] = [
  { id: "available", label: "Available", match: (row) => row.status === "available" },
  { id: "checked_out", label: "Checked out", match: (row) => row.status === "checked_out" },
  { id: "out_of_service", label: "Out of service", match: (row) => row.status === "out_of_service" },
  { id: "all", label: "All", match: () => true },
];

const EQUIPMENT_FACETS: FacetDef<Equipment>[] = [
  { id: "class", label: "Class", value: (row) => row.class, format: equipmentClassLabel },
];

const EQUIPMENT_COLUMNS: DataColumn<Equipment>[] = [
  {
    id: "code",
    header: "Code",
    sortValue: (row) => row.code,
    cell: (row) => <DocLink to={`/equipment/${row.id}`}>{row.code}</DocLink>,
  },
  {
    id: "name",
    header: "Name",
    sortValue: (row) => row.name,
    cell: (row) => <span className="font-medium">{row.name}</span>,
  },
  {
    id: "class",
    header: "Class",
    sortValue: (row) => equipmentClassLabel(row.class),
    cell: (row) => equipmentClassLabel(row.class),
  },
  {
    id: "operator",
    header: "Operator",
    sortValue: (row) => row.currentAssignment?.operatorName ?? null,
    cell: (row) =>
      row.currentAssignment ? (
        <span className="inline-flex items-center gap-2">
          <PersonAvatar name={row.currentAssignment.operatorName} />
          <span>{row.currentAssignment.operatorName ?? "Operator"}</span>
        </span>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "task",
    header: "Shift / task",
    sortValue: (row) => shiftAndTask(row.currentAssignment) || null,
    cell: (row) => {
      const text = shiftAndTask(row.currentAssignment);
      return text ? <span className="font-mono text-xs">{text}</span> : <Muted>—</Muted>;
    },
  },
  {
    id: "since",
    header: "Since",
    sortValue: (row) => row.currentAssignment?.startedAt ?? null,
    csv: (row) => (row.currentAssignment ? new Date(row.currentAssignment.startedAt).toISOString() : ""),
    cell: (row) => <RelativeTime at={row.currentAssignment?.startedAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (row) => row.status,
    cell: (row) => <StatusBadge status={row.status} />,
  },
];

function EquipmentList() {
  const navigate = useNavigate();
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const [params] = useSearchParams();
  const equipment = useApiQuery<Equipment[]>("/api/equipment");
  const [creating, setCreating] = useState(false);
  const labels = params.get("labels") === "1";

  const fleet = useMemo(() => inWarehouse(equipment.data ?? [], warehouseId), [equipment.data, warehouseId]);

  if (labels) {
    return (
      <div>
        <PageHeader
          eyebrow="Equipment labels"
          title="Print truck barcodes"
          description="Tape EQ: labels on the machine. Floor Check out scans them."
          actions={
            <div className="flex gap-2 print:hidden">
              <Button variant="ghost" onClick={() => navigate("/equipment")}>
                Back
              </Button>
              <Button onClick={() => window.print()}>Print</Button>
            </div>
          }
        />
        <ErrorBanner error={equipment.error?.message ?? null} />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3">
          {fleet.map((row) => (
            <div key={row.id} className="break-inside-avoid rounded-xl border p-3">
              <p className="font-mono text-sm font-semibold">{row.code}</p>
              <p className="text-xs text-muted-foreground">{row.name}</p>
              <BarcodeLabel value={row.barcode} className="mt-2 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Today"
        title="Equipment"
        description="Who has the forklift on this shift or task. Scan EQ: on the floor to check out."
      />
      <DataTable
        id="equipment"
        data={fleet}
        loading={equipment.isLoading}
        error={equipment.error?.message}
        columns={EQUIPMENT_COLUMNS}
        getRowId={(row) => row.id}
        rowHref={(row) => `/equipment/${row.id}`}
        tabs={EQUIPMENT_TABS}
        defaultTab="all"
        facets={EQUIPMENT_FACETS}
        defaultSort={{ id: "code", desc: false }}
        search={{
          placeholder: "Search code, name, operator",
          text: (row) =>
            [row.code, row.name, row.barcode, row.currentAssignment?.operatorName, row.currentAssignment?.taskNumber]
              .filter(Boolean)
              .join(" "),
        }}
        exportName="equipment"
        toolbar={
          <>
            <Button size="sm" variant="outline" onClick={() => navigate("/equipment?labels=1")}>
              <Printer className="size-4" />
              Print labels
            </Button>
            {me.role === "owner" ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Register equipment
              </Button>
            ) : null}
          </>
        }
        empty={
          <EmptyState
            icon={Forklift}
            title="No equipment yet."
            body="Register each forklift or pallet jack so the floor can check it out with a pre-use inspection."
            action={
              me.role === "owner" ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  Register equipment
                </Button>
              ) : undefined
            }
          />
        }
      />
      {me.role === "owner" ? <RegisterEquipmentSheet open={creating} onOpenChange={setCreating} /> : null}
    </div>
  );
}

function RegisterEquipmentSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [equipmentClass, setEquipmentClass] = useState<(typeof EQUIPMENT_CLASSES)[number]>("sit_down");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const created = await apiMutate<Equipment>("/api/equipment", {
        body: JSON.stringify({ warehouseId, code, name, class: equipmentClass }),
      });
      toast.success(`${created.code} registered. Print its label next.`);
      setCode("");
      setName("");
      onOpenChange(false);
      navigate(`/equipment/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register equipment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Register equipment"
      description="Each truck gets an EQ: barcode. The class sets its pre-use checklist."
      submitLabel="Register"
      onSubmit={create}
      busy={busy}
      error={error}
    >
      <Field label="Code">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="FL-01" required autoFocus />
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Crown sit-down" required />
      </Field>
      <Field label="Class">
        <Select value={equipmentClass} onChange={(e) => setEquipmentClass(e.target.value as (typeof EQUIPMENT_CLASSES)[number])}>
          {EQUIPMENT_CLASSES.map((value) => (
            <option key={value} value={value}>
              {equipmentClassLabel(value)}
            </option>
          ))}
        </Select>
      </Field>
    </FormSheet>
  );
}

function InspectionFields({
  items,
  answers,
  setAnswers,
}: {
  items: { code: string; label: string }[];
  answers: Record<string, InspectionAnswer>;
  setAnswers: (next: Record<string, InspectionAnswer>) => void;
}) {
  return (
    <div className="divide-y rounded-lg border">
      {items.map((item) => {
        const result = answers[item.code]?.result ?? "pass";
        return (
          <div
            key={item.code}
            className={cn("grid gap-2 px-3 py-2 sm:grid-cols-[1fr_8rem] sm:items-center", result === "fail" && "bg-tone-danger-bg")}
          >
            <p className={cn("text-sm", result === "fail" && "text-tone-danger")}>{item.label}</p>
            <Select
              aria-label={item.label}
              value={result}
              onChange={(e) =>
                setAnswers({
                  ...answers,
                  [item.code]: { code: item.code, result: e.target.value as InspectionAnswer["result"] },
                })
              }
            >
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="na">N/A</option>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

function answersFromChecklist(items: { code: string; label: string }[]): Record<string, InspectionAnswer> {
  return Object.fromEntries(items.map((item) => [item.code, { code: item.code, result: "pass" as const }]));
}

function EquipmentDetail({ id }: { id: string }) {
  const me = useSession();
  const [active, setActive] = useState<Equipment | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [operatorUserId, setOperatorUserId] = useState("");
  const [shift, setShift] = useState("days");
  const [transferUserId, setTransferUserId] = useState("");
  const [answers, setAnswers] = useState<Record<string, InspectionAnswer>>({});
  const [atLocal, setAtLocal] = useState("");
  const [audit, setAudit] = useState<EquipmentAudit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState("custody");
  const { error, setError, busy, run } = useWrite();

  const checklist = useMemo(() => active?.checklist ?? checklistForClass(active?.class ?? "other"), [active]);

  async function load() {
    const next = await api<Equipment>(`/api/equipment/${id}`);
    setActive(next);
    setAnswers(answersFromChecklist(next.checklist ?? checklistForClass(next.class)));
    if (me.role === "owner") {
      const team = await api<TeamMember[]>("/api/team");
      setMembers(team);
      setOperatorUserId(team[0]?.userId ?? "");
      setTransferUserId(team[0]?.userId ?? "");
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setLoadError(err.message));
  }, [id]);

  if (!active) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const equipment = active;
  const owner = me.role === "owner";
  const assignment = equipment.currentAssignment ?? null;
  const mine = assignment?.operatorUserId === me.user.id;
  const canCheckIn = Boolean(assignment && (mine || owner));
  const canCheckOut = equipment.status === "available" && owner;
  const outOfService = equipment.status === "out_of_service";
  const failing = checklist.filter((item) => answers[item.code]?.result === "fail");
  const floorLink = `/floor/checkout?id=${equipment.id}`;
  const lastFailed = (equipment.inspections ?? []).find((row) => row.result === "fail");
  const labelFor = (code: string) => checklist.find((item) => item.code === code)?.label ?? code;
  const memberName = (userId: string) => members.find((member) => member.userId === userId)?.name;

  async function refresh() {
    try {
      setActive(await api<Equipment>(`/api/equipment/${id}`));
    } catch {
      /* The error banner already explains the failed write. */
    }
  }

  async function checkout() {
    const next = await run(
      "Check out",
      () =>
        api<Equipment>(`/api/equipment/${id}/checkout`, {
          method: "POST",
          body: JSON.stringify({
            operatorUserId: owner ? operatorUserId : undefined,
            shift: shift.trim() || undefined,
            inspection: Object.values(answers),
          }),
        }),
      (next) => `${next.code} checked out to ${next.currentAssignment?.operatorName ?? memberName(operatorUserId) ?? "the operator"}.`,
    );
    if (next) setActive(next);
    else await refresh();
  }

  async function checkin() {
    if (!assignment) return;
    const next = await run(
      "Check in",
      () => api<Equipment>(`/api/equipment/assignments/${assignment.id}/checkin`, { method: "POST" }),
      (next) => `${next.code} checked in. It is available again.`,
    );
    if (next) setActive(next);
  }

  async function transfer() {
    const next = await run(
      "Transfer",
      () =>
        api<Equipment>(`/api/equipment/${id}/transfer`, {
          method: "POST",
          body: JSON.stringify({ operatorUserId: transferUserId, shift: shift.trim() || undefined }),
        }),
      (next) => `${next.code} handed to ${next.currentAssignment?.operatorName ?? memberName(transferUserId) ?? "the new operator"}.`,
    );
    if (next) setActive(next);
    else await refresh();
  }

  async function returnToService() {
    const next = await run(
      "Return to service",
      () => api<Equipment>(`/api/equipment/${id}/return-to-service`, { method: "POST" }),
      (next) => `${next.code} is back in service.`,
    );
    if (next) setActive(next);
  }

  async function lookupAt() {
    if (!atLocal) return;
    setError(null);
    try {
      const at = new Date(atLocal).getTime();
      setAudit(await api<EquipmentAudit>(`/api/equipment/audit?equipmentId=${id}&at=${at}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not look up assignment");
    }
  }

  let primary: DocumentAction | null = null;
  if (canCheckIn) primary = { label: "Check in", icon: LogIn, onSelect: checkin };
  else if (outOfService && owner)
    primary = {
      label: "Return to service",
      icon: Wrench,
      onSelect: returnToService,
      confirm: {
        title: `Return ${equipment.code} to service?`,
        body: "It goes back to available and can be checked out again. Only do this once the failed inspection items are fixed.",
        confirmLabel: "Return to service",
        cancelLabel: "Keep out of service",
      },
    };
  else if (canCheckOut)
    primary = {
      label: "Check out",
      icon: LogOut,
      onSelect: checkout,
      disabled: !operatorUserId,
      confirm: failing.length
        ? {
            title: `Take ${equipment.code} out of service?`,
            body: `${failing.length === 1 ? "This item failed" : `${failing.length} items failed`}: ${failing
              .map((item) => item.label)
              .join(", ")}. A failed inspection takes the truck out of service instead of checking it out. An owner has to return it to service before anyone can use it.`,
            confirmLabel: "Take out of service",
            cancelLabel: "Go back",
            tone: "danger",
          }
        : undefined,
    };
  else if (equipment.status === "available") primary = { label: "Check out on floor", icon: ScanLine, to: floorLink };

  const menu: DocumentAction[] = [
    ...(primary?.to === floorLink ? [] : [{ label: "Open on floor", icon: ScanLine, to: floorLink }]),
    { label: "Print labels", icon: Printer, to: "/equipment?labels=1" },
  ];

  const assignments = equipment.assignments ?? [];
  const inspections = equipment.inspections ?? [];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Today"
        list={{ label: "Equipment", to: "/equipment" }}
        title={equipment.code}
        description={`${equipment.name} · ${equipmentClassLabel(equipment.class)}`}
        status={assignment?.status ?? equipment.status}
        steps={EQUIPMENT_ASSIGNMENT_STEPS}
        meta={assignment ? <StatusBadge status={equipment.status} /> : null}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <div className="rounded-lg border p-3">
                  <BarcodeLabel value={equipment.barcode} className="mx-auto h-16" />
                </div>
                <DocumentFact label="Class">{equipmentClassLabel(equipment.class)}</DocumentFact>
                <DocumentFact label="Barcode">
                  <span className="font-mono">{equipment.barcode}</span>
                </DocumentFact>
                <DocumentFact label="Status">
                  <StatusBadge status={equipment.status} />
                </DocumentFact>
                {equipment.notes ? <p className="text-sm text-muted-foreground">{equipment.notes}</p> : null}
                <DocumentFact label="Registered">
                  <RelativeTime at={equipment.createdAt} />
                </DocumentFact>
              </div>
            </Card>
          </DocumentRail>
        }
      >
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="custody">Custody</TabsTrigger>
            <TabsTrigger value="history">History ({assignments.length})</TabsTrigger>
            {inspections.length ? <TabsTrigger value="inspections">Inspections ({inspections.length})</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="custody" className="space-y-3">
            {outOfService ? (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-tone-danger-bg p-3 text-sm text-tone-danger">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">Out of service. Nobody can check it out.</p>
                  {lastFailed?.items?.some((item) => item.result === "fail") ? (
                    <p>
                      Failed pre-use <RelativeTime at={lastFailed.createdAt} className="text-tone-danger" />:{" "}
                      {lastFailed.items
                        .filter((item) => item.result === "fail")
                        .map((item) => labelFor(item.code))
                        .join(", ")}
                      .
                    </p>
                  ) : null}
                  <p>
                    {owner
                      ? "Fix the failed items, then use Return to service."
                      : "An owner returns it to service once the failed items are fixed."}
                  </p>
                </div>
              </div>
            ) : null}

            {assignment ? (
              <Card>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <PersonAvatar name={assignment.operatorName} className="size-10 text-sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-muted-foreground">Checked out to</p>
                      <p className="text-lg font-medium leading-tight">{assignment.operatorName ?? "Operator"}</p>
                    </div>
                    <span className="font-mono text-sm text-muted-foreground">{assignment.number}</span>
                  </div>
                  <DocumentFact label="Shift / task">
                    <span className="font-mono">{shiftAndTask(assignment) || "No shift or task"}</span>
                  </DocumentFact>
                  <DocumentFact label="Since">
                    <RelativeTime at={assignment.startedAt} />
                  </DocumentFact>
                </div>
              </Card>
            ) : null}

            {assignment && owner ? (
              <Card>
                <div className="space-y-3">
                  <p className="text-sm font-medium">Transfer</p>
                  <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={onSubmit(transfer)}>
                    <Field label="New operator">
                      <Select value={transferUserId} onChange={(e) => setTransferUserId(e.target.value)}>
                        {members.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Shift">
                      <Input value={shift} onChange={(e) => setShift(e.target.value)} />
                    </Field>
                    <Button type="submit" variant="outline" disabled={busy}>
                      <ArrowLeftRight className="size-4" />
                      Transfer
                    </Button>
                  </form>
                </div>
              </Card>
            ) : null}

            {canCheckOut ? (
              <Card>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">Check out</p>
                    <p className="text-xs text-muted-foreground">
                      Walk the pre-use checklist, then Check out. A fail takes the truck out of service.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Operator">
                      <Select value={operatorUserId} onChange={(e) => setOperatorUserId(e.target.value)}>
                        {members.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Shift">
                      <Input value={shift} onChange={(e) => setShift(e.target.value)} placeholder="days" />
                    </Field>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Pre-use inspection</p>
                    <InspectionFields items={checklist} answers={answers} setAnswers={setAnswers} />
                  </div>
                </div>
              </Card>
            ) : null}

            {equipment.status === "available" && !owner ? (
              <EmptyState
                icon={Forklift}
                title="Available."
                body="Scan the EQ: label on the floor to run the pre-use inspection and check it out."
                action={
                  <Button size="sm" asChild>
                    <Link to={floorLink}>Check out on floor</Link>
                  </Button>
                }
              />
            ) : null}
          </TabsContent>

          <TabsContent value="history" className="space-y-3">
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Who had this truck</p>
                <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit(lookupAt)}>
                  <Field label="At">
                    <Input type="datetime-local" value={atLocal} onChange={(e) => setAtLocal(e.target.value)} />
                  </Field>
                  <Button type="submit" variant="outline">
                    Look up
                  </Button>
                </form>
                {audit?.assignment ? (
                  <p className="flex items-center gap-2 text-sm">
                    <PersonAvatar name={audit.assignment.operatorName} />
                    <span>
                      {audit.assignment.operatorName} on <span className="font-mono">{audit.assignment.number}</span>
                      {audit.assignment.shift ? ` · ${audit.assignment.shift}` : ""}
                      {audit.assignment.taskNumber || audit.assignment.refType
                        ? ` · ${audit.assignment.taskNumber || audit.assignment.refType}`
                        : ""}
                    </span>
                  </p>
                ) : audit ? (
                  <p className="text-sm text-muted-foreground">No assignment covered that time.</p>
                ) : null}
              </div>
            </Card>
            {assignments.length === 0 ? (
              <EmptyState icon={Forklift} title="Never checked out." body="Every check out and check in lands here." />
            ) : (
              <Table columns={["When", "Number", "Operator", "Shift", "Task", "Ended", "Status"]}>
                {assignments.map((row) => (
                  <tr key={row.id}>
                    <td className="text-muted-foreground" title={new Date(row.startedAt).toLocaleString()}>
                      {new Date(row.startedAt).toLocaleString()}
                    </td>
                    <td className="font-mono">{row.number}</td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <PersonAvatar name={row.operatorName} />
                        {row.operatorName ?? "—"}
                      </span>
                    </td>
                    <td>{row.shift || "—"}</td>
                    <td className="font-mono">{row.taskNumber || row.refType || "—"}</td>
                    <td>
                      <RelativeTime at={row.endedAt} />
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </TabsContent>

          {inspections.length ? (
            <TabsContent value="inspections">
              <Table columns={["When", "Result", "Failed items"]}>
                {inspections.map((row) => {
                  const failed = (row.items ?? []).filter((item) => item.result === "fail");
                  return (
                    <tr key={row.id}>
                      <td className="text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
                      <td>
                        <ToneBadge tone={row.result === "fail" ? "danger" : "success"}>
                          {row.result === "fail" ? "Fail" : "Pass"}
                        </ToneBadge>
                      </td>
                      <td>{failed.length ? failed.map((item) => labelFor(item.code)).join(", ") : <Muted>—</Muted>}</td>
                    </tr>
                  );
                })}
              </Table>
            </TabsContent>
          ) : null}
        </Tabs>
      </DocumentFrame>
    </div>
  );
}
