import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Maximize2, Minimize2 } from "lucide-react";
import { api, errorText, type LiveDay, type LivePresence, type WarehouseMapData } from "../api";
import { EmptyState, ErrorBanner, PageHeader, Select } from "../components/ui";
import { Term } from "../components/term";
import { WarehouseMap, type MapPin } from "../components/WarehouseMap";
import { useWarehouse } from "../warehouse";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;

/** Empty states sit inside a bordered panel here, so they drop their own frame. */
const RAIL_EMPTY = "rounded-none border-0 bg-transparent px-4 py-6";

const FLOW_LABEL: Record<LiveDay["flows"][number]["id"], string> = {
  inbound: "Inbound",
  outbound: "Outbound",
  make: "Make",
  stock: "Stock",
  yard: "Yard",
};

const PRESENCE_LABEL: Record<LivePresence, string> = {
  working: "Working",
  idle: "Idle",
  clear: "Clear",
};

function formatWhen(ms: number, timeZone: string, withSeconds = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
  }).format(new Date(ms));
}

function formatDay(ms: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatPace(pace: number | null) {
  if (pace == null) return "—";
  const rounded = Math.round(pace * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}/h` : `${rounded.toFixed(1)}/h`;
}

function formatClearBy(day: LiveDay) {
  if (day.pulse.unitsRemaining === 0) return "Clear";
  if (day.pulse.clearBy == null) return "No rate";
  return formatWhen(day.pulse.clearBy, day.timeZone);
}

export function LivePage() {
  const { warehouseId } = useWarehouse();
  const boardRef = useRef<HTMLDivElement>(null);
  const [day, setDay] = useState<LiveDay | null>(null);
  const [map, setMap] = useState<WarehouseMapData | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!warehouseId) return;
    let cancelled = false;
    setMapFailed(false);
    api<WarehouseMapData>(`/api/map?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((next) => {
        if (!cancelled) setMap(next);
      })
      .catch(() => {
        if (cancelled) return;
        setMap(null);
        setMapFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  useEffect(() => {
    if (!warehouseId) return;
    let cancelled = false;
    let timer = 0;

    async function load() {
      if (document.hidden) return;
      try {
        const next = await api<LiveDay>(`/api/live?warehouseId=${encodeURIComponent(warehouseId)}`);
        if (cancelled) return;
        setDay(next);
        setStale(false);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setStale(true);
        setError(errorText(err, "Could not refresh the floor."));
      }
    }

    function arm() {
      window.clearInterval(timer);
      if (document.hidden) return;
      timer = window.setInterval(() => void load(), POLL_MS);
    }

    function onVisible() {
      if (!document.hidden) void load();
      arm();
    }

    void load();
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [warehouseId]);

  useEffect(() => {
    function onChange() {
      setFull(document.fullscreenElement === boardRef.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFull() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await boardRef.current?.requestFullscreen();
  }

  async function assign(jobId: string, userId: string) {
    setError(null);
    try {
      await api(`/api/jobs/${jobId}/assign`, {
        method: "POST",
        body: JSON.stringify({ userId: userId || null }),
      });
      const next = await api<LiveDay>(`/api/live?warehouseId=${encodeURIComponent(warehouseId)}`);
      setDay(next);
      setStale(false);
    } catch (err) {
      setError(errorText(err, "Could not reassign the job."));
    }
  }

  const selected = day?.people.find((person) => person.userId === selectedId) ?? null;
  const pins: MapPin[] =
    day?.people.flatMap((person) =>
      person.lastBay
        ? [{ id: person.userId, locationId: person.lastBay.locationId, label: person.initials, name: person.name, tone: person.state }]
        : [],
    ) ?? [];

  return (
    <div ref={boardRef} className="min-h-full bg-background">
      <PageHeader
        eyebrow="Today"
        title="Live"
        description={
          day
            ? `${day.warehouse.name} · ${formatDay(day.asOf, day.timeZone)} · ${day.timeZone}. Dots are the last scan bay.`
            : "Everyone and every open flow in this building, since local midnight."
        }
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void toggleFull()}>
            {full ? <Minimize2 /> : <Maximize2 />}
            {full ? "Exit wall" : "Wall"}
          </Button>
        }
      />
      {error && !day ? <ErrorBanner error={error} /> : null}
      {stale && day ? (
        <p className="mb-3 text-xs text-amber-700 dark:text-chart-4">Last snapshot kept. The refresh failed.</p>
      ) : null}
      {!warehouseId ? <p className="text-sm text-muted-foreground">Select a warehouse.</p> : null}
      {warehouseId && !day && !error ? <p className="text-sm text-muted-foreground">Opening the floor…</p> : null}
      {day ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Pulse label="Done" value={String(day.pulse.unitsDone)} hint="since midnight" />
            <Pulse label="Open" value={String(day.pulse.unitsRemaining)} hint="units still in a stage" />
            <Pulse label="Pace" value={formatPace(day.pulse.pacePerHour)} hint="last 60 min" />
            <Pulse label="Clear by" value={formatClearBy(day)} hint={day.pulse.pacePerHour == null && day.pulse.unitsRemaining > 0 ? "needs 15 min" : "at this pace"} />
            <Pulse label="Working" value={String(day.pulse.peopleWorking)} hint="scan in 8 min" />
            <Pulse label="Idle" value={String(day.pulse.peopleIdle)} hint="claimed, clocked, or on a truck" tone={day.pulse.peopleIdle > 0 ? "warn" : "default"} />
          </div>

          <div className="grid gap-3 lg:grid-cols-12">
            <section className="rounded-xl border bg-card lg:col-span-3">
              <header className="border-b px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                People
              </header>
              {day.people.length ? (
                <ul className="max-h-[32rem] divide-y overflow-auto">
                  {day.people.map((person) => (
                    <li key={person.userId}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/60",
                          selectedId === person.userId && "bg-muted",
                        )}
                        onClick={() => setSelectedId(person.userId)}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full font-mono text-[10px] text-white",
                            person.state === "idle" ? "bg-amber-600" : person.state === "clear" ? "bg-stone-500" : "bg-emerald-700",
                          )}
                        >
                          {person.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{person.name}</span>
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {PRESENCE_LABEL[person.state]}
                            </span>
                          </span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {person.verb ? `${person.verb} ` : ""}
                            {person.documentNumber ?? "No document"}
                            {person.lastBay ? ` · ${person.lastBay.code}` : ""}
                            {person.equipmentCode ? ` · ${person.equipmentCode}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Activity}
                  title="No one on the floor yet today."
                  body={
                    <>
                      People show up here after their first scan, <Term id="job">job</Term> claim, or truck checkout.
                    </>
                  }
                  action={
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/floor">Open the floor</Link>
                    </Button>
                  }
                  className={RAIL_EMPTY}
                />
              )}
              {selected ? (
                <div className="space-y-2 border-t px-3 py-2 text-xs">
                  <p className="font-medium">{selected.name}</p>
                  <p className="text-muted-foreground">
                    Last scan {selected.lastBay ? selected.lastBay.code : "has no bay yet"}
                    {selected.lastAt ? ` · ${formatWhen(selected.lastAt, day.timeZone, true)}` : ""}
                    {` · ${selected.unitsToday} units`}
                  </p>
                  {selected.documentTo ? (
                    <Link className="font-mono underline" to={selected.documentTo}>
                      {selected.documentNumber}
                    </Link>
                  ) : null}
                  {selected.jobId ? (
                    <Select
                      aria-label={`Reassign ${selected.documentNumber ?? "job"}`}
                      value={selected.userId}
                      onChange={(event) => void assign(selected.jobId!, event.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {day.team.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="space-y-3 lg:col-span-6">
              <div className="rounded-xl border bg-card p-2">
                {map && map.locations.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No bays on the map yet."
                    body="Build the floor with racks and bays, and each person's last scan shows as a dot."
                    action={
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/map?edit=1">Build floor</Link>
                      </Button>
                    }
                    className="border-0 bg-transparent"
                  />
                ) : map ? (
                  <WarehouseMap
                    warehouse={map.warehouse}
                    locations={map.locations}
                    view="floor"
                    levelFilter="all"
                    selectedId={selected?.lastBay?.locationId}
                    pins={pins}
                    className="h-[min(52vh,560px)]"
                    onSelect={(location) => {
                      const person = day.people.find((row) => row.lastBay?.locationId === location.id);
                      setSelectedId(person?.userId ?? null);
                    }}
                    onSelectPin={setSelectedId}
                  />
                ) : (
                  <p className="grid h-48 place-items-center text-xs text-muted-foreground">
                    {mapFailed ? "The floor map did not load. People and flows still update." : "Floor map is loading."}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
                {day.flows.map((flow) => {
                  const total = flow.done + flow.remaining;
                  const width = total > 0 ? Math.min(100, Math.round((flow.done / total) * 100)) : 0;
                  return (
                    <div key={flow.id} className="rounded-xl border bg-card px-2.5 py-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{FLOW_LABEL[flow.id]}</p>
                      <p className="mt-1 font-mono text-xs tabular-nums">
                        {flow.done} done · {flow.remaining} open
                      </p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-emerald-700" style={{ width: `${width}%` }} />
                      </div>
                      {flow.visits?.length ? (
                        <ul className="mt-1.5 space-y-0.5">
                          {flow.visits.slice(0, 3).map((visit) => (
                            <li key={visit.id} className="truncate font-mono text-[10px] text-muted-foreground">
                              <Link to={`/inbound/yard/${visit.id}`} className="hover:underline">
                                {visit.number}
                              </Link>
                              {` ${visit.status.replaceAll("_", " ")}`}
                              {visit.dockCode ? ` · ${visit.dockCode}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border bg-card lg:col-span-3">
              <header className="border-b px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Attention
              </header>
              {day.attention.length ? (
                <ul className="divide-y">
                  {day.attention.map((row) => (
                    <li key={row.id} className="px-3 py-2">
                      <Link to={row.to} className="block text-sm font-medium hover:underline">
                        {row.title}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">{row.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Activity}
                  title="Nothing is idle, late, or stuck."
                  body="Idle people, unassigned work due today, late trailers, and tracker exceptions show up here."
                  className={RAIL_EMPTY}
                />
              )}
            </section>
          </div>

          <section className="rounded-xl border bg-card">
            <header className="border-b px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Today
            </header>
            {day.activity.length ? (
              <ul className="grid gap-x-4 px-3 py-2 sm:grid-cols-2">
                {day.activity.map((row) => (
                  <li key={row.id} className="flex items-baseline gap-2 py-0.5 font-mono text-[11px]">
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatWhen(row.at, day.timeZone, true)}</span>
                    <span className="truncate">{row.summary}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Activity}
                title="No scans yet today."
                body="Every scan and post on the floor lands here, newest first."
                className={RAIL_EMPTY}
              />
            )}
          </section>
          {error && stale ? <ErrorBanner error={error} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Pulse({ label, value, hint, tone = "default" }: { label: string; value: string; hint: string; tone?: "default" | "warn" }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums leading-tight", tone === "warn" && "text-amber-700 dark:text-chart-4")}>
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}
