import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Equipment, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
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

  const checklist = useMemo(
    () => active?.checklist ?? checklistForClass(active?.class ?? "other"),
    [active],
  );

  async function load(selectId?: string) {
    const rows = await api<Equipment[]>("/api/equipment");
    setFleet(rows);
    const wanted = selectId || params.get("id");
    if (wanted) {
      const detail = await api<Equipment>(`/api/equipment/${wanted}`);
      setActive(detail);
      setAnswers(answersFromChecklist(detail.checklist ?? checklistForClass(detail.class)));
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      setDone(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then(async (hit) => {
          if (hit.kind === "equipment") {
            const detail = await api<Equipment>(`/api/equipment/${hit.equipment.id}`);
            setActive(detail);
            setAnswers(answersFromChecklist(detail.checklist ?? checklistForClass(detail.class)));
            return;
          }
          const nextTask = taskFromHit(hit);
          if (nextTask) {
            setTask(nextTask);
            return;
          }
          setError("Scan an EQ: truck, or a putaway / order / replenish ticket to bind the task.");
        })
        .catch((err: Error) => setError(err.message));
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
      setError(err instanceof Error ? err.message : "Check-out failed");
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
      setError(err instanceof Error ? err.message : "Check-in failed");
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
      setError(err instanceof Error ? err.message : "Could not attach task");
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
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {openMine && !active ? (
        <Card>
          <p className="text-sm text-muted-foreground">You are on</p>
          <p className="text-xl font-semibold">{openMine.code}</p>
          <Button className="mt-3" onClick={() => void load(openMine.id)}>
            Open
          </Button>
        </Card>
      ) : null}
      {active ? (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
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
              {active.currentAssignment.refType ? ` · ${active.currentAssignment.refType}` : ""}
            </p>
          ) : null}
          {task ? (
            <p className="text-sm">
              Task {task.number}{" "}
              <button className="underline" type="button" onClick={() => setTask(null)}>
                clear
              </button>
            </p>
          ) : null}
          {mine || (active.currentAssignment && me.role === "owner") ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void checkin()}>Check in</Button>
              {task ? (
                <Button variant="secondary" onClick={() => void attachTask()}>
                  Bind task
                </Button>
              ) : null}
              <Button variant="secondary" asChild>
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
                <Input value={shift} onChange={(e) => setShift(e.target.value)} placeholder="days" />
              </Field>
              <div className="grid gap-2">
                {checklist.map((item) => (
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
              <Button type="submit">Check out</Button>
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
          <ul className="mt-3 space-y-1 text-sm">
            {inWarehouse(fleet, warehouseId).map((row) => (
              <li key={row.id}>
                <button className="font-mono underline" type="button" onClick={() => void load(row.id)}>
                  {row.code}
                </button>{" "}
                <StatusBadge status={row.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </FloorFrame>
  );
}
