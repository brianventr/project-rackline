import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock, Layers } from "lucide-react";
import { api, type Wave, type WavePlan, type WavePlanGroup } from "../api";
import { Button, Card, ErrorBanner, Field, Input, ToneBadge } from "../components/ui";
import { Term } from "../components/term";
import { FormSheet } from "../components/form-sheet";
import { useApiQuery } from "../query";
import { useSession } from "../session";
import { useWrite } from "../use-write";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusTone } from "@/domain/status";

const URGENCY: Record<WavePlanGroup["urgency"], { tone: StatusTone; label: string }> = {
  missed: { tone: "danger", label: "Missed pickup" },
  now: { tone: "warning", label: "Release now" },
  today: { tone: "info", label: "Today" },
  later: { tone: "neutral", label: "Later" },
};

function carrierName(carrier: string | null): string {
  return !carrier || carrier === "*" ? "Any carrier" : carrier;
}

function timeLeft(minutes: number): string {
  if (minutes <= 0) return "gone";
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m left`;
  return `${Math.round(hours / 24)}d out`;
}

function pickupDay(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function planPath(warehouseId: string): string {
  return `/api/waves/plan?warehouseId=${encodeURIComponent(warehouseId)}`;
}

/** Manufacturer mode: open orders grouped into the waves to release, earliest carrier cutoff first. */
export function WavePlanner({ warehouseId }: { warehouseId: string }) {
  const me = useSession();
  const navigate = useNavigate();
  const plan = useApiQuery<WavePlan>(planPath(warehouseId), { refetchInterval: 60_000 });
  const write = useWrite();
  const [editing, setEditing] = useState(false);
  const data = plan.data;

  const createWave = (group: WavePlanGroup, mode: "wave" | "batch") =>
    write.run(
      "Create wave",
      async () => {
        const wave = await api<Wave>("/api/waves", {
          method: "POST",
          body: JSON.stringify({
            warehouseId,
            mode,
            zoneId: group.zoneId ?? undefined,
            clientId: group.clientId ?? undefined,
            orderIds: group.orderIds,
            notes: `${carrierName(group.carrier)} pickup ${group.cutoffLabel}`,
          }),
        });
        navigate(`/outbound/waves/${wave.id}`);
        return wave;
      },
      (wave) => `${wave.number} is ready to release.`,
    );

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">Plan by carrier cutoff</p>
          <p className="text-sm text-muted-foreground">
            Open orders not on a <Term id="wave">wave</Term>, grouped by pickup, zone, and client. Short orders wait
            for stock.
          </p>
        </div>
        {me.role === "owner" ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Clock className="size-4" />
            Cutoffs
          </Button>
        ) : null}
      </div>
      <ErrorBanner error={write.error ?? plan.error?.message ?? null} />
      {plan.isLoading ? (
        <Skeleton className="h-24 rounded-md" />
      ) : !data || data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {data?.waiting.length
            ? `Nothing to wave. ${data.waiting.length} open ${data.waiting.length === 1 ? "order waits" : "orders wait"} on stock.`
            : "Every open order is on a wave."}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.groups.map((group) => {
            const urgency = URGENCY[group.urgency];
            return (
              <li key={group.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
                <div className="w-36 shrink-0">
                  <p className="font-medium tabular-nums">{pickupDay(group.cutoffAt, data.timeZone)}</p>
                  <p className="text-xs text-muted-foreground">
                    {carrierName(group.carrier)} · {timeLeft(group.minutesLeft)}
                  </p>
                </div>
                <ToneBadge tone={urgency.tone}>{urgency.label}</ToneBadge>
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    {group.orderIds.length} {group.orderIds.length === 1 ? "order" : "orders"} · {group.units} units
                    <span className="text-muted-foreground">
                      {" "}
                      · {group.zoneName ?? (group.zoneId ? "Zone" : "Multi-zone")}
                      {group.clientName ? ` · ${group.clientName}` : ""}
                    </span>
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{group.numbers.join(", ")}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {group.orderIds.length > 1 ? (
                    <Button size="sm" variant="outline" disabled={write.busy} onClick={() => void createWave(group, "batch")}>
                      Batch
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={write.busy} onClick={() => void createWave(group, "wave")}>
                    <Layers className="size-4" />
                    Create wave
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data?.waiting.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {data.waiting.length} waiting on stock
          </summary>
          <ul className="mt-2 space-y-1">
            {data.waiting.map((row) => (
              <li key={row.orderId}>
                <Link className="font-mono underline" to={`/outbound/orders/${row.orderId}`}>
                  {row.number}
                </Link>{" "}
                <span className="text-muted-foreground">{row.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {data ? <CutoffsSheet open={editing} onOpenChange={setEditing} warehouseId={warehouseId} plan={data} /> : null}
    </Card>
  );
}

function CutoffsSheet({
  open,
  onOpenChange,
  warehouseId,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  plan: WavePlan;
}) {
  const write = useWrite();
  const initial = () =>
    Object.fromEntries(plan.cutoffs.map((row) => [row.carrier, row.set ? hhmm(row.minutes) : ""]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [carrier, setCarrier] = useState("");
  useEffect(() => {
    if (open) setValues(initial());
    // Re-seed only when the sheet opens so a background refetch does not overwrite typing.
  }, [open]);

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Carrier cutoffs"
      description="The last truck each carrier takes from this building. Blank uses the any-carrier time."
      submitLabel="Save cutoffs"
      busy={write.busy}
      error={write.error}
      onSubmit={async () => {
        const saved = await write.run(
          "Save cutoffs",
          () =>
            api<WavePlan>("/api/waves/cutoffs", {
              method: "PUT",
              body: JSON.stringify({ warehouseId, cutoffs: values }),
            }),
          "Cutoffs saved",
        );
        if (saved) onOpenChange(false);
      }}
    >
      <div className="grid gap-3">
        {Object.keys(values).map((key) => (
          <Field key={key} label={key === "*" ? "Any carrier" : key}>
            <Input
              type="time"
              value={values[key] ?? ""}
              placeholder="15:00"
              onChange={(e) => setValues((current) => ({ ...current, [key]: e.target.value }))}
            />
          </Field>
        ))}
        <div className="flex items-end gap-2">
          <Field label="Add a carrier">
            <Input placeholder="e.g. FedEx" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={!carrier.trim() || carrier.trim() in values}
            onClick={() => {
              setValues((current) => ({ ...current, [carrier.trim()]: "" }));
              setCarrier("");
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </FormSheet>
  );
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Today in Manufacturer mode: the next pickup and how much open work still has to be waved for it. */
export function CutoffStrip({ warehouseId }: { warehouseId: string }) {
  const plan = useApiQuery<WavePlan>(planPath(warehouseId), { refetchInterval: 60_000 });
  const data = plan.data;
  if (plan.isLoading) return <Skeleton className="h-14 rounded-lg" />;
  if (!data) return null;
  const next = data.groups[0];
  const dueToday = data.groups.filter((group) => group.urgency !== "later");
  const orders = dueToday.reduce((sum, group) => sum + group.orderIds.length, 0);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-xs">
      <Clock className="size-4 text-muted-foreground" />
      {next ? (
        <>
          <span>
            Next pickup <span className="font-medium">{pickupDay(next.cutoffAt, data.timeZone)}</span>{" "}
            <span className="text-muted-foreground">
              ({carrierName(next.carrier)}, {timeLeft(next.minutesLeft)})
            </span>
          </span>
          <ToneBadge tone={URGENCY[next.urgency].tone}>{URGENCY[next.urgency].label}</ToneBadge>
          <span className="text-muted-foreground">
            {orders} {orders === 1 ? "order" : "orders"} to wave for today's pickups
            {data.waiting.length ? ` · ${data.waiting.length} waiting on stock` : ""}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">
          Every open order is on a wave{data.waiting.length ? ` · ${data.waiting.length} waiting on stock` : ""}.
        </span>
      )}
      <Link to="/outbound/waves" className="ml-auto font-medium text-muted-foreground hover:text-foreground">
        Plan waves →
      </Link>
    </div>
  );
}
