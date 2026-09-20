import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  type Equipment,
  type EquipmentAudit,
  type TeamMember,
} from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";
import { DocumentHeader } from "../components/document";
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

function EquipmentList() {
  const navigate = useNavigate();
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Equipment[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [equipmentClass, setEquipmentClass] = useState<(typeof EQUIPMENT_CLASSES)[number]>("sit_down");
  const [error, setError] = useState<string | null>(null);
  const labels = params.get("labels") === "1";

  async function load() {
    setRows(await api<Equipment[]>("/api/equipment"));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<Equipment>("/api/equipment", {
        method: "POST",
        body: JSON.stringify({ warehouseId, code, name, class: equipmentClass }),
      });
      setCode("");
      setName("");
      navigate(`/equipment/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register equipment");
    }
  }

  const fleet = inWarehouse(rows, warehouseId);

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
        <ErrorBanner error={error} />
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
    <div>
      <PageHeader
        eyebrow="Today"
        title="Equipment"
        description="Who has the forklift on this shift or task. Scan EQ: on the floor to check out."
        actions={
          <Button variant="ghost" onClick={() => navigate("/equipment?labels=1")}>
            Print labels
          </Button>
        }
      />
      <ErrorBanner error={error} />
      {me.role === "owner" ? (
        <Card className="mb-6">
          <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(create)}>
            <Field label="Code">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="FL-01" required />
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Crown sit-down" required />
            </Field>
            <Field label="Class">
              <Select
                value={equipmentClass}
                onChange={(e) => setEquipmentClass(e.target.value as (typeof EQUIPMENT_CLASSES)[number])}
              >
                {EQUIPMENT_CLASSES.map((value) => (
                  <option key={value} value={value}>
                    {equipmentClassLabel(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit">Register</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Table columns={["Code", "Name", "Class", "Operator", "Shift / task", "Status"]}>
        {fleet.map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/equipment/${row.id}`}>
                {row.code}
              </Link>
            </td>
            <td className="px-4 py-3">{row.name}</td>
            <td className="px-4 py-3">{equipmentClassLabel(row.class)}</td>
            <td className="px-4 py-3">{row.currentAssignment?.operatorName ?? "—"}</td>
            <td className="px-4 py-3 font-mono text-xs">
              {row.currentAssignment
                ? [row.currentAssignment.shift, row.currentAssignment.refType].filter(Boolean).join(" · ") || "—"
                : "—"}
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={row.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
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
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.code} className="grid gap-2 sm:grid-cols-[1fr_8rem] sm:items-center">
          <p className="text-sm">{item.label}</p>
          <Select
            value={answers[item.code]?.result ?? "pass"}
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
      ))}
    </div>
  );
}

function answersFromChecklist(items: { code: string; label: string }[]): Record<string, InspectionAnswer> {
  return Object.fromEntries(items.map((item) => [item.code, { code: item.code, result: "pass" as const }]));
}

function EquipmentDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const me = useSession();
  const [active, setActive] = useState<Equipment | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [operatorUserId, setOperatorUserId] = useState("");
  const [shift, setShift] = useState("days");
  const [transferUserId, setTransferUserId] = useState("");
  const [answers, setAnswers] = useState<Record<string, InspectionAnswer>>({});
  const [atLocal, setAtLocal] = useState("");
  const [audit, setAudit] = useState<EquipmentAudit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checklist = useMemo(
    () => active?.checklist ?? checklistForClass(active?.class ?? "other"),
    [active],
  );

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
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function checkout() {
    setError(null);
    try {
      setActive(
        await api<Equipment>(`/api/equipment/${id}/checkout`, {
          method: "POST",
          body: JSON.stringify({
            operatorUserId: me.role === "owner" ? operatorUserId : undefined,
            shift: shift.trim() || undefined,
            inspection: Object.values(answers),
          }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check out");
    }
  }

  async function checkin() {
    if (!active?.currentAssignment) return;
    setError(null);
    try {
      setActive(
        await api<Equipment>(`/api/equipment/assignments/${active.currentAssignment.id}/checkin`, { method: "POST" }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check in");
    }
  }

  async function transfer() {
    setError(null);
    try {
      setActive(
        await api<Equipment>(`/api/equipment/${id}/transfer`, {
          method: "POST",
          body: JSON.stringify({ operatorUserId: transferUserId, shift: shift.trim() || undefined }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not transfer");
    }
  }

  async function returnToService() {
    setError(null);
    try {
      setActive(await api<Equipment>(`/api/equipment/${id}/return-to-service`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not return to service");
    }
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

  if (!active) return <ErrorBanner error={error} />;

  const mine = active.currentAssignment?.operatorUserId === me.user.id;
  const canCheckIn = Boolean(active.currentAssignment && (mine || me.role === "owner"));

  return (
    <div className="space-y-6">
      <DocumentHeader
        eyebrow="Equipment"
        title={active.code}
        description={`${active.name} · ${equipmentClassLabel(active.class)}`}
        status={active.currentAssignment?.status ?? active.status}
        steps={EQUIPMENT_ASSIGNMENT_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/equipment")}>
              All equipment
            </Button>
            {canCheckIn ? <Button onClick={() => void checkin()}>Check in</Button> : null}
            {active.status === "out_of_service" && me.role === "owner" ? (
              <Button onClick={() => void returnToService()}>Return to service</Button>
            ) : null}
            <Button variant="secondary" asChild>
              <Link to={`/floor/checkout?id=${active.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      <div className="max-w-sm rounded-lg border p-3">
        <BarcodeLabel value={active.barcode} className="mx-auto h-16" />
      </div>
      {active.currentAssignment ? (
        <Card>
          <p className="text-sm text-muted-foreground">Checked out</p>
          <p className="text-lg font-medium">
            {active.currentAssignment.operatorName} · {active.currentAssignment.number}
          </p>
          <p className="font-mono text-sm text-muted-foreground">
            {[active.currentAssignment.shift, active.currentAssignment.refType, active.currentAssignment.refId]
              .filter(Boolean)
              .join(" · ") || "No shift or task"}
          </p>
        </Card>
      ) : null}
      {active.status === "available" && me.role === "owner" ? (
        <Card className="space-y-4">
          <p className="font-medium">Assign</p>
          <form className="space-y-4" onSubmit={onSubmit(checkout)}>
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
            <InspectionFields items={checklist} answers={answers} setAnswers={setAnswers} />
            <Button type="submit">Check out</Button>
          </form>
        </Card>
      ) : null}
      {active.currentAssignment && me.role === "owner" ? (
        <Card className="space-y-3">
          <p className="font-medium">Transfer</p>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={onSubmit(transfer)}>
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
            <div className="flex items-end">
              <Button type="submit">Transfer</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card className="space-y-3">
        <p className="font-medium">Who had this truck</p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit(lookupAt)}>
          <Field label="At">
            <Input type="datetime-local" value={atLocal} onChange={(e) => setAtLocal(e.target.value)} />
          </Field>
          <Button type="submit">Look up</Button>
        </form>
        {audit?.assignment ? (
          <p className="text-sm">
            {audit.assignment.operatorName} on {audit.assignment.number}
            {audit.assignment.shift ? ` · ${audit.assignment.shift}` : ""}
            {audit.assignment.refType ? ` · ${audit.assignment.refType}` : ""}
          </p>
        ) : audit ? (
          <p className="text-sm text-muted-foreground">No assignment covered that time.</p>
        ) : null}
      </Card>
      <Table columns={["When", "Number", "Operator", "Shift", "Task", "Status"]}>
        {(active.assignments ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(row.startedAt).toLocaleString()}</td>
            <td className="px-4 py-3 font-mono">{row.number}</td>
            <td className="px-4 py-3">{row.operatorName}</td>
            <td className="px-4 py-3">{row.shift || "—"}</td>
            <td className="px-4 py-3 font-mono text-xs">{row.refType || "—"}</td>
            <td className="px-4 py-3">
              <StatusBadge status={row.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
