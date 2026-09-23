import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Forklift } from "lucide-react";
import { api, errorText, type Equipment, type ScanHit } from "../../api";
import { Button, Card, DoneBanner, EmptyState, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox, type ScanReport } from "./floor-ui";
import { useSession } from "../../session";
import {
  checklistForClass,
  equipmentClassLabel,
  taskFromScanKind,
  type InspectionAnswer,
} from "@/domain/equipment";
import { useWarehouse, inWarehouse } from "../../warehouse";

function answersFromChecklist(items: { code: string; label: string }[]): Record<string, InspectionAnswer> {
  return Object.fromEntries(items.map((item) => [item.code, { code: item.code, result: "pass" as const }]));
}

function taskFromHit(hit: ScanHit): { refType: string; refId: string; number: string } | null {
  const refType = taskFromScanKind(hit.kind);
  if (!refType) return null;
  const record = hit as unknown as Record<string, { id?: string; number?: string }>;
  const doc = record[hit.kind];
  if (!doc?.id || !doc.number) return null;
  return { refType, refId: doc.id, number: doc.number };
}

export function FloorCheckoutPage() {
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const [params] = useSearchParams();
  const [fleet, setFleet] = useState<Equipment[]>([]);
  const [active, setActive] = useState<Equipment | null>(null);
  const [shift, setShift] = useState("days");
  const [task, setTask] = useState<{ refType: string; refId: string; number: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, InspectionAnswer>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const checklist = useMemo(
    () => active?.checklist ?? checklistForClass(active?.class ?? "other"),
    [active],
  );

  async function load(selectId?: string) {
    const rows = await api<Equipment[]>("/api/equipment");
    setFleet(rows);
    setLoaded(true);
    const wanted = selectId || params.get("id");
    if (wanted) {
      const detail = await api<Equipment>(`/api/equipment/${wanted}`);
      setActive(detail);
      setAnswers(answersFromChecklist(detail.checklist ?? checklistForClass(detail.class)));
    }
  }

  useEffect(() => {
    load().catch((err) => setError(errorText(err, "Could not load equipment.")));
  }, []);

  function openTruck(id: string) {
    load(id).catch((err) => setError(errorText(err, "Could not open that truck.")));
  }

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      setDone(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then(async (hit) => {
          if (hit.kind === "equipment") {
            const detail = await api<Equipment>(`/api/equipment/${hit.equipment.id}`);
            setActive(detail);
            setAnswers(answersFromChecklist(detail.checklist ?? checklistForClass(detail.class)));
            report?.(true);
            return;
          }
          const nextTask = taskFromHit(hit);
          if (nextTask) {
            setTask(nextTask);
            report?.(true);
            return;
          }
          setError("Scan an EQ: truck, or a putaway / order / replenish ticket to bind the task.");
          report?.(false);
        })
        .catch((err) => {
          setError(errorText(err, "That barcode did not scan. Try again."));
          report?.(false);
        });
    },
    [],
  );

  async function checkout() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<Equipment>(`/api/equipment/${active.id}/checkout`, {
        method: "POST",
        body: JSON.stringify({
          shift: shift.trim() || undefined,
          refType: task?.refType,
          refId: task?.refId,
          inspection: Object.values(answers),
        }),
      });
      setActive(next);
      setDone(`${next.code} checked out to you.`);
      await load(next.id);
    } catch (err) {
      setError(errorText(err, "Could not check out the truck."));
      await load(active.id);
    }
  }

  async function checkin() {
    if (!active?.currentAssignment) return;
    setError(null);
    try {
      const next = await api<Equipment>(`/api/equipment/assignments/${active.currentAssignment.id}/checkin`, {
        method: "POST",
      });
      setActive(next);
      setDone(`${next.code} checked in.`);
      await load(next.id);
    } catch (err) {
      setError(errorText(err, "Could not check in the truck."));
    }
  }

  async function attachTask() {
    if (!active?.currentAssignment || !task) return;
    setError(null);
    try {
      const next = await api<Equipment>(`/api/equipment/assignments/${active.currentAssignment.id}/task`, {
        method: "POST",
        body: JSON.stringify({ refType: task.refType, refId: task.refId }),
      });
      setActive(next);
      setDone(`Task ${task.number} attached.`);
    } catch (err) {
      setError(errorText(err, "Could not bind the task."));
    }
  }

  const mine = active?.currentAssignment?.operatorUserId === me.user.id;
  const openMine = inWarehouse(fleet, warehouseId).find((row) => row.currentAssignment?.operatorUserId === me.user.id);

  return (
    <FloorFrame
      title="Check out"
      description="Scan EQ:FL-01, complete the pre-use checklist, optionally bind a shift or ticket, then check in when done."
      error={error}
    >
      <FloorScanBox label="Scan truck or task" placeholder="EQ:FL-01 or XFR-DEMO1" onScan={onScan} />
      <DoneBanner>{done}</DoneBanner>
      {openMine && !active ? (
        <Card>
          <p className="text-sm text-muted-foreground">You are on</p>
          <p className="text-xl font-semibold">{openMine.code}</p>
          <Button className="mt-3 h-11 w-full sm:w-auto" onClick={() => openTruck(openMine.id)}>
            Open
          </Button>
        </Card>
      ) : null}
      {active ? (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase text-muted-foreground">{equipmentClassLabel(active.class)}</p>
              <h2 className="text-2xl font-semibold">{active.code}</h2>
              <p className="text-muted-foreground">{active.name}</p>
            </div>
            <StatusBadge status={active.status} />
          </div>
          {active.currentAssignment ? (
            <p className="text-sm">
              {active.currentAssignment.operatorName} · {active.currentAssignment.number}
              {active.currentAssignment.shift ? ` · ${active.currentAssignment.shift}` : ""}
              {active.currentAssignment.taskNumber || active.currentAssignment.refType
                ? ` · ${active.currentAssignment.taskNumber || active.currentAssignment.refType}`
                : ""}
            </p>
          ) : null}
          {task ? (
            <p className="text-sm">
              Task {task.number}{" "}
              <button
                className="inline-flex min-h-11 items-center rounded-sm px-1 underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                type="button"
                onClick={() => setTask(null)}
              >
                clear
              </button>
            </p>
          ) : null}
          {mine || (active.currentAssignment && me.role === "owner") ? (
            <div className="flex flex-wrap gap-2">
              <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void checkin()}>
                Check in
              </Button>
              {task ? (
                <Button variant="secondary" className="h-11 flex-1 sm:h-14 sm:flex-none" onClick={() => void attachTask()}>
                  Bind task
                </Button>
              ) : null}
              <Button variant="secondary" className="h-11 flex-1 sm:h-14 sm:flex-none" asChild>
                <Link to={`/equipment/${active.id}`}>Record</Link>
              </Button>
            </div>
          ) : null}
          {active.status === "available" ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void checkout();
              }}
            >
              <Field label="Shift">
                <Input className="h-11" value={shift} onChange={(e) => setShift(e.target.value)} placeholder="days" />
              </Field>
              <div className="grid gap-2">
                {checklist.map((item) => (
                  <div key={item.code} className="grid gap-2 sm:grid-cols-[1fr_8rem] sm:items-center">
                    <p className="text-sm" id={`check-${item.code}`}>
                      {item.label}
                    </p>
                    <Select
                      className="h-11"
                      aria-labelledby={`check-${item.code}`}
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
              <Button type="submit" className="h-14 w-full text-lg sm:w-auto">
                Check out
              </Button>
            </form>
          ) : null}
          {active.status === "out_of_service" ? (
            <p className="text-sm text-destructive">Out of service until an owner returns it.</p>
          ) : null}
          {active.currentAssignment && !mine && me.role !== "owner" ? (
            <p className="text-sm text-muted-foreground">Already assigned. Ask the office to transfer.</p>
          ) : null}
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">Waiting for an EQ: scan.</p>
          {!loaded ? null : inWarehouse(fleet, warehouseId).length === 0 ? (
            <EmptyState
              className="mt-3"
              icon={Forklift}
              title="No equipment in this warehouse."
              body="Forklifts and pallet jacks registered in the office show here to check out."
              action={
                me.role === "owner" ? (
                  <Button variant="secondary" className="h-11" asChild>
                    <Link to="/equipment">Office equipment</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="mt-2 text-sm">
              {inWarehouse(fleet, warehouseId).map((row) => (
                <li key={row.id} className="flex min-h-11 items-center gap-2">
                  <button
                    className="inline-flex min-h-11 items-center rounded-sm font-mono underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    type="button"
                    onClick={() => openTruck(row.id)}
                  >
                    {row.code}
                  </button>
                  <StatusBadge status={row.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}
