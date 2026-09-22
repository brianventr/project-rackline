import { garageAllowsPath } from "./operating-mode";
import { isFloorVerb, isJobRefType, jobOfficePath } from "./jobs";
import { endOfZonedDay, startOfZonedDay } from "./time-zone";

export const LIVE_IDLE_MS = 8 * 60 * 1000;
export const LIVE_PACE_WINDOW_MS = 60 * 60 * 1000;
export const LIVE_PACE_MIN_MS = 15 * 60 * 1000;
export const LIVE_ATTENTION_CAP = 8;
export const LIVE_TICKER_CAP = 12;

export const LIVE_FLOW_IDS = ["inbound", "outbound", "make", "stock", "yard"] as const;
export type LiveFlowId = (typeof LIVE_FLOW_IDS)[number];
export type LiveUnitFlow = Exclude<LiveFlowId, "yard">;
export type LivePresence = "working" | "idle" | "clear";
export type LiveAttentionKind = "idle" | "due" | "dock" | "tracker";

const GARAGE_HIDDEN_REFS = new Set([
  "asn",
  "replenishment",
  "replenishSuggestion",
  "cycleCount",
  "hold",
  "wave",
  "yard",
]);

const TO_BAY_TYPES = new Set(["receive", "move", "wo_produce", "kit_produce", "unreceive"]);

export type LiveMember = { userId: string; name: string };

export type LiveLocation = { id: string; code: string; posX: number; posY: number };

/** A scan, pack, or labor ping inside the warehouse day. `qty` is signed work; labor pings are 0. */
export type LiveTouch = {
  id: string;
  at: number;
  userId: string;
  qty: number;
  flow: LiveUnitFlow | null;
  bayId: string | null;
  sku: string | null;
  verb: string;
  refType: string;
};

export type LiveJob = {
  id: string;
  verb: string;
  refType: string;
  refId: string;
  status: string;
  number: string | null;
  title: string | null;
  assigneeId: string | null;
  claimedAt: number | null;
  dueAt: number | null;
  fromLocationId: string | null;
};

export type LiveClock = {
  userId: string;
  verb: string;
  refType: string;
  refId: string;
  startedAt: number;
  number: string | null;
};

export type LiveCheckout = {
  operatorUserId: string;
  equipmentCode: string;
};

export type LiveOrder = {
  status: string;
  lines: { qty: number; qtyPicked: number; qtyPacked: number }[];
};

export type LiveMake = { qty: number; qtyCompleted: number };

export type LiveYard = {
  id: string;
  number: string;
  status: string;
  carrierName: string;
  trailerNumber: string | null;
  eta: number | null;
  dockCode: string | null;
  checkedOutAt: number | null;
};

export type LiveTracker = {
  orderId: string;
  number: string;
  packageId: string | null;
  packageNumber: string | null;
};

export type LiveRemain = {
  receipts: number;
  purchases: number;
  asns: number;
  rmas: number;
  rtvs: number;
  transfers: number;
  replenishments: number;
  counts: number;
};

export type LiveDayInput = {
  asOf: number;
  timeZone: string;
  garage: boolean;
  warehouse: { id: string; name: string };
  members: LiveMember[];
  locations: LiveLocation[];
  touches: LiveTouch[];
  jobs: LiveJob[];
  clocks: LiveClock[];
  checkouts: LiveCheckout[];
  orders: LiveOrder[];
  workOrders: LiveMake[];
  kits: LiveMake[];
  remaining: LiveRemain;
  yards: LiveYard[];
  trackers: LiveTracker[];
};

export type LiveBay = { locationId: string; code: string; posX: number; posY: number };

export type LivePerson = {
  userId: string;
  name: string;
  initials: string;
  state: LivePresence;
  verb: string | null;
  jobId: string | null;
  documentNumber: string | null;
  documentTo: string | null;
  lastBay: LiveBay | null;
  lastAt: number | null;
  unitsToday: number;
  equipmentCode: string | null;
};

export type LiveFlow = {
  id: LiveFlowId;
  done: number;
  remaining: number;
  visits?: {
    id: string;
    number: string;
    status: string;
    carrierName: string;
    trailerNumber: string | null;
    dockCode: string | null;
    eta: number | null;
  }[];
};

export type LiveAttention = {
  id: string;
  kind: LiveAttentionKind;
  title: string;
  detail: string;
  to: string;
  jobId: string | null;
};

export type LiveActivity = {
  id: string;
  at: number;
  userId: string;
  userName: string;
  verb: string;
  qty: number;
  sku: string | null;
  bayCode: string | null;
  summary: string;
};

export type LiveDay = {
  asOf: number;
  timeZone: string;
  dayStart: number;
  warehouse: { id: string; name: string };
  pulse: {
    unitsDone: number;
    unitsRemaining: number;
    pacePerHour: number | null;
    clearBy: number | null;
    peopleWorking: number;
    peopleIdle: number;
  };
  flows: LiveFlow[];
  people: LivePerson[];
  attention: LiveAttention[];
  activity: LiveActivity[];
  team: LiveMember[];
};

const FLOW_OF: Record<string, { flow: LiveUnitFlow; verb: string; sign: 1 | -1 }> = {
  receive: { flow: "inbound", verb: "receive", sign: 1 },
  unreceive: { flow: "inbound", verb: "unreceive", sign: -1 },
  rtv: { flow: "inbound", verb: "rtv", sign: 1 },
  pick: { flow: "outbound", verb: "pick", sign: 1 },
  unpick: { flow: "outbound", verb: "unpick", sign: -1 },
  ship: { flow: "outbound", verb: "ship", sign: 1 },
  wo_produce: { flow: "make", verb: "assemble", sign: 1 },
  kit_produce: { flow: "make", verb: "kit", sign: 1 },
};

/** Where the person was standing for this ledger line. Destination scans land on the to-bay. */
export function scanBay(movement: {
  type: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
}): string | null {
  if (TO_BAY_TYPES.has(movement.type)) return movement.toLocationId ?? movement.fromLocationId ?? null;
  return movement.fromLocationId ?? movement.toLocationId ?? null;
}

export function movementTouch(movement: {
  type: string;
  refType: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
}): { flow: LiveUnitFlow; verb: string; sign: 1 | -1; bayId: string | null } | null {
  if (movement.type === "move") {
    const replenish = movement.refType === "replenishment" || movement.refType === "replenishSuggestion";
    return {
      flow: "stock",
      verb: replenish ? "replenish" : "putaway",
      sign: 1,
      bayId: scanBay({ type: "move", fromLocationId: movement.fromLocationId, toLocationId: movement.toLocationId }),
    };
  }
  const mapped = FLOW_OF[movement.type];
  if (!mapped) return null;
  return { ...mapped, bayId: scanBay(movement) };
}

export function orderWorkRemaining(order: LiveOrder): number {
  if (order.status === "shipped" || order.status === "cancelled") return 0;
  let units = 0;
  for (const line of order.lines) {
    const pickLeft = Math.max(0, line.qty - line.qtyPicked);
    const packLeft = Math.max(0, line.qtyPicked - line.qtyPacked);
    const shipLeft = order.status === "packed" ? Math.max(0, line.qtyPacked) : 0;
    units += pickLeft + packLeft + shipLeft;
  }
  return units;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function hiddenRef(refType: string, garage: boolean): boolean {
  return garage && GARAGE_HIDDEN_REFS.has(refType);
}

function jobVisible(job: LiveJob, garage: boolean): boolean {
  if (!garage) return true;
  if (hiddenRef(job.refType, true)) return false;
  if (!isFloorVerb(job.verb) || !isJobRefType(job.refType)) return false;
  return garageAllowsPath(jobOfficePath({ verb: job.verb, refType: job.refType, refId: job.refId }));
}

function documentTo(job: LiveJob): string | null {
  if (!isFloorVerb(job.verb) || !isJobRefType(job.refType)) return null;
  return jobOfficePath({ verb: job.verb, refType: job.refType, refId: job.refId });
}

function documentNumber(job: LiveJob): string {
  return job.number || job.title || job.verb;
}

function clampUnits(value: number): number {
  return value > 0 ? value : 0;
}

export function buildLiveDay(input: LiveDayInput): LiveDay {
  const dayStart = startOfZonedDay(input.asOf, input.timeZone);
  const dayEnd = endOfZonedDay(input.asOf, input.timeZone);
  const names = new Map(input.members.map((member) => [member.userId, member.name]));
  const locations = new Map(input.locations.map((location) => [location.id, location]));
  const nameOf = (userId: string) => names.get(userId) || "Someone";

  const touches = input.touches.filter(
    (touch) => touch.at >= dayStart && touch.at <= input.asOf && !hiddenRef(touch.refType, input.garage),
  );
  const jobs = input.jobs.filter((job) => jobVisible(job, input.garage));
  const clocks = input.clocks.filter((clock) => !hiddenRef(clock.refType, input.garage));
  const checkouts = input.garage ? [] : input.checkouts;

  const done: Record<LiveUnitFlow, number> = { inbound: 0, outbound: 0, make: 0, stock: 0 };
  for (const touch of touches) {
    if (!touch.flow) continue;
    done[touch.flow] += touch.qty;
  }
  for (const flow of Object.keys(done) as LiveUnitFlow[]) done[flow] = clampUnits(done[flow]);

  const orderRemaining = input.orders.reduce((sum, order) => sum + orderWorkRemaining(order), 0);
  const makeRemaining =
    input.workOrders.reduce((sum, row) => sum + Math.max(0, row.qty - row.qtyCompleted), 0) +
    input.kits.reduce((sum, row) => sum + Math.max(0, row.qty - row.qtyCompleted), 0);
  const inboundRemaining =
    input.remaining.receipts +
    input.remaining.purchases +
    input.remaining.rmas +
    input.remaining.rtvs +
    (input.garage ? 0 : input.remaining.asns);
  const stockRemaining =
    input.remaining.transfers +
    (input.garage ? 0 : input.remaining.replenishments + input.remaining.counts);

  const openYards = input.yards.filter((yard) => yard.status === "expected" || yard.status === "checked_in" || yard.status === "at_dock");
  const yardsDone = input.yards.filter(
    (yard) => yard.status === "checked_out" && yard.checkedOutAt != null && yard.checkedOutAt >= dayStart && yard.checkedOutAt <= input.asOf,
  ).length;

  const flows: LiveFlow[] = [
    { id: "inbound", done: done.inbound, remaining: inboundRemaining },
    { id: "outbound", done: done.outbound, remaining: orderRemaining },
    { id: "make", done: done.make, remaining: makeRemaining },
    { id: "stock", done: done.stock, remaining: stockRemaining },
  ];
  if (!input.garage) {
    flows.push({
      id: "yard",
      done: yardsDone,
      remaining: openYards.length,
      visits: openYards.map((yard) => ({
        id: yard.id,
        number: yard.number,
        status: yard.status,
        carrierName: yard.carrierName,
        trailerNumber: yard.trailerNumber,
        dockCode: yard.dockCode,
        eta: yard.eta,
      })),
    });
  }

  const unitsDone = flows.filter((flow) => flow.id !== "yard").reduce((sum, flow) => sum + flow.done, 0);
  const unitsRemaining = flows.filter((flow) => flow.id !== "yard").reduce((sum, flow) => sum + flow.remaining, 0);

  const windowStart = Math.max(dayStart, input.asOf - LIVE_PACE_WINDOW_MS);
  const paceTouches = touches.filter((touch) => touch.flow && touch.at >= windowStart);
  const firstPace = paceTouches.reduce((min, touch) => Math.min(min, touch.at), Number.POSITIVE_INFINITY);
  let pacePerHour: number | null = null;
  if (paceTouches.length && input.asOf - firstPace >= LIVE_PACE_MIN_MS) {
    const elapsed = input.asOf - Math.max(windowStart, firstPace);
    const units = paceTouches.reduce((sum, touch) => sum + touch.qty, 0);
    const rate = units / (elapsed / LIVE_PACE_WINDOW_MS);
    pacePerHour = rate > 0 ? rate : null;
  }
  const clearBy =
    unitsRemaining === 0 ? input.asOf : pacePerHour ? input.asOf + (unitsRemaining / pacePerHour) * LIVE_PACE_WINDOW_MS : null;

  const claimedByUser = new Map<string, LiveJob>();
  const assignedByUser = new Map<string, LiveJob>();
  for (const job of jobs) {
    if (!job.assigneeId) continue;
    if (job.status === "claimed") {
      const current = claimedByUser.get(job.assigneeId);
      if (!current || (job.claimedAt ?? 0) >= (current.claimedAt ?? 0)) claimedByUser.set(job.assigneeId, job);
    } else if (job.status === "open") {
      const current = assignedByUser.get(job.assigneeId);
      const due = job.dueAt ?? Number.POSITIVE_INFINITY;
      const currentDue = current?.dueAt ?? Number.POSITIVE_INFINITY;
      if (!current || due < currentDue) assignedByUser.set(job.assigneeId, job);
    }
  }
  const clockByUser = new Map<string, LiveClock>();
  for (const clock of clocks) {
    if (!clockByUser.has(clock.userId)) clockByUser.set(clock.userId, clock);
  }
  const checkoutByUser = new Map<string, string>();
  for (const checkout of checkouts) {
    if (!checkoutByUser.has(checkout.operatorUserId)) checkoutByUser.set(checkout.operatorUserId, checkout.equipmentCode);
  }

  const touchesByUser = new Map<string, LiveTouch[]>();
  for (const touch of touches) {
    const list = touchesByUser.get(touch.userId) ?? [];
    list.push(touch);
    touchesByUser.set(touch.userId, list);
  }

  const userIds = new Set<string>([
    ...claimedByUser.keys(),
    ...assignedByUser.keys(),
    ...clockByUser.keys(),
    ...checkoutByUser.keys(),
    ...touchesByUser.keys(),
  ]);

  const people: LivePerson[] = [...userIds].map((userId) => {
    const mine = touchesByUser.get(userId) ?? [];
    const lastAt = mine.reduce<number | null>((max, touch) => (max == null || touch.at > max ? touch.at : max), null);
    const bayTouch = mine
      .filter((touch) => touch.bayId)
      .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0];
    const claimed = claimedByUser.get(userId) ?? null;
    const job = claimed ?? assignedByUser.get(userId) ?? null;
    const bayId = bayTouch?.bayId ?? job?.fromLocationId ?? null;
    const location = bayId ? locations.get(bayId) : undefined;
    const clock = clockByUser.get(userId);
    const engaged = Boolean(claimed || clock || checkoutByUser.has(userId));
    const state: LivePresence =
      lastAt != null && input.asOf - lastAt <= LIVE_IDLE_MS ? "working" : engaged ? "idle" : "clear";
    const unitsToday = clampUnits(mine.reduce((sum, touch) => sum + (touch.flow ? touch.qty : 0), 0));
    return {
      userId,
      name: nameOf(userId),
      initials: initials(nameOf(userId)),
      state,
      verb: job?.verb ?? clock?.verb ?? null,
      jobId: job?.id ?? null,
      documentNumber: job ? documentNumber(job) : clock?.number ?? null,
      documentTo: job ? documentTo(job) : null,
      lastBay: location ? { locationId: location.id, code: location.code, posX: location.posX, posY: location.posY } : null,
      lastAt,
      unitsToday,
      equipmentCode: checkoutByUser.get(userId) ?? null,
    };
  });
  const presenceOrder: Record<LivePresence, number> = { idle: 0, working: 1, clear: 2 };
  people.sort((a, b) => presenceOrder[a.state] - presenceOrder[b.state] || a.name.localeCompare(b.name));

  const attention: LiveAttention[] = [];
  for (const person of people) {
    const claimed = claimedByUser.get(person.userId);
    if (person.state !== "idle" || !claimed) continue;
    const mins =
      person.lastAt == null
        ? "No scan yet"
        : `${Math.max(0, Math.floor((input.asOf - person.lastAt) / 60_000))} min since last scan`;
    attention.push({
      id: `idle:${person.userId}`,
      kind: "idle",
      title: `${person.name} is idle on ${documentNumber(claimed)}`,
      detail: mins,
      to: documentTo(claimed) ?? "/today",
      jobId: claimed.id,
    });
  }
  const dueJobs = jobs
    .filter((job) => job.status === "open" && !job.assigneeId && job.dueAt != null && job.dueAt <= dayEnd)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  for (const job of dueJobs) {
    attention.push({
      id: `due:${job.id}`,
      kind: "due",
      title: `${documentNumber(job)} is unassigned`,
      detail: job.dueAt != null && job.dueAt < dayStart ? "Overdue" : "Due today",
      to: documentTo(job) ?? "/today",
      jobId: job.id,
    });
  }
  if (!input.garage) {
    const late = openYards
      .filter((yard) => yard.status === "expected" && yard.eta != null && yard.eta < input.asOf)
      .sort((a, b) => (a.eta ?? 0) - (b.eta ?? 0));
    for (const yard of late) {
      const trailer = yard.trailerNumber ? ` · ${yard.trailerNumber}` : "";
      attention.push({
        id: `dock:${yard.id}`,
        kind: "dock",
        title: `${yard.number} is still expected`,
        detail: `${yard.carrierName}${trailer}`,
        to: `/inbound/yard/${yard.id}`,
        jobId: null,
      });
    }
  }
  const trackers = input.trackers.slice().sort((a, b) => a.number.localeCompare(b.number) || (a.packageNumber ?? "").localeCompare(b.packageNumber ?? ""));
  for (const tracker of trackers) {
    attention.push({
      id: `tracker:${tracker.orderId}:${tracker.packageId ?? "order"}`,
      kind: "tracker",
      title: `${tracker.number} tracker exception`,
      detail: tracker.packageNumber ? tracker.packageNumber : "Order label",
      to: `/outbound/orders/${tracker.orderId}`,
      jobId: null,
    });
  }
  const kindOrder: Record<LiveAttentionKind, number> = { idle: 0, due: 1, dock: 2, tracker: 3 };
  attention.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
  const capped = attention.slice(0, LIVE_ATTENTION_CAP);

  const bayCode = (bayId: string | null) => (bayId ? locations.get(bayId)?.code ?? null : null);
  const activity: LiveActivity[] = touches
    .filter((touch) => touch.flow && touch.qty !== 0)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
    .slice(0, LIVE_TICKER_CAP)
    .map((touch) => {
      const code = bayCode(touch.bayId);
      const sku = touch.sku ? ` ${touch.sku}` : "";
      const atBay = code ? ` at ${code}` : "";
      const userName = nameOf(touch.userId);
      return {
        id: touch.id,
        at: touch.at,
        userId: touch.userId,
        userName,
        verb: touch.verb,
        qty: Math.abs(touch.qty),
        sku: touch.sku,
        bayCode: code,
        summary: `${userName} ${touch.verb} ${Math.abs(touch.qty)}${sku}${atBay}`,
      };
    });

  const team = input.members.slice().sort((a, b) => a.name.localeCompare(b.name));

  return {
    asOf: input.asOf,
    timeZone: input.timeZone,
    dayStart,
    warehouse: input.warehouse,
    pulse: {
      unitsDone,
      unitsRemaining,
      pacePerHour,
      clearBy,
      peopleWorking: people.filter((person) => person.state === "working").length,
      peopleIdle: people.filter((person) => person.state === "idle").length,
    },
    flows,
    people,
    attention: capped,
    activity,
    team,
  };
}
