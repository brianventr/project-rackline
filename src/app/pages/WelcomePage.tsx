import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Compass, Hammer, Loader2, Map as MapIcon, Package, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button as UiButton } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText, type Location, type MapLocation, type WarehouseMapData } from "@/app/api";
import { Button, Card, EmptyState, ErrorBanner, PageHeader } from "@/app/components/ui";
import { FloorLocator } from "@/app/components/rack-locator/flat-views";
import type { TargetTone } from "@/app/components/rack-locator/reticle";
import { HierarchyTree } from "@/app/components/setup-wizard/HierarchyTree";
import { LivePanel, type RackPreviewShape } from "@/app/components/setup-wizard/LivePanel";
import { SetupStepper, type StepStatus } from "@/app/components/setup-wizard/Stepper";
import { AreaStep, BuildingStep, LevelLesson, RacksStep, ReviewIssues } from "@/app/components/setup-wizard/steps";
import { runSetupRequests, type CreateProgress } from "@/app/components/setup-wizard/create";
import { useMinWidth } from "@/app/components/setup-wizard/use-min-width";
import { apiKey, queryClient, refreshApi, useApiQuery } from "@/app/query";
import { openTour } from "@/app/tour";
import { useOperatingMode } from "@/app/use-operating-mode";
import { OwnerOnly, useWarehouse } from "@/app/warehouse";
import { buildHierarchyTree, describeHierarchy, parseBinCode, summarizeHierarchy } from "@/domain/hierarchy";
import { normalizeRack, padBay } from "@/domain/rack-builder";
import {
  SETUP_LIMITS,
  SETUP_STEPS,
  SETUP_STEP_IDS,
  defaultSetupInput,
  existingHierarchy,
  issuesForStep,
  mergeSetupInput,
  nextSetupStep,
  pendingSlotRoles,
  plannedHierarchy,
  planSetup,
  previewRackCodes,
  previousSetupStep,
  setupStep,
  stepIncluded,
  summarizeCompleted,
  withCarriedRequests,
  type ExistingBin,
  type PlannedBin,
  type SetupInput,
  type SetupRequest,
  type SetupStepId,
} from "@/domain/setup-wizard";
import { cn } from "@/lib/utils";

const NO_TONES: ReadonlyMap<string, TargetTone> = new Map();
const NO_BINS: ExistingBin[] = [];

function isStepId(value: string | null): value is SetupStepId {
  return !!value && (SETUP_STEP_IDS as readonly string[]).includes(value);
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function clampNumber(value: number | string, min: number, max: number): number | null {
  const raw = Number(String(value).trim());
  if (!Number.isInteger(raw)) return null;
  return Math.min(max, Math.max(min, raw));
}

/** A planned bin in the shape the floor plan draws. */
function plannedMapLocation(draft: PlannedBin, warehouseId: string, warehouseName: string): MapLocation {
  return {
    ...draft,
    id: draft.code,
    warehouseId,
    warehouseName,
    unitsOnHand: 0,
    skuCount: 0,
    contents: [],
    slotRole: draft.slotRole,
  };
}

/** The "Set up your building" wizard. Owners only; the route guard sends operators home. */
export function WelcomePage() {
  return (
    <OwnerOnly>
      <WelcomeWizard />
    </OwnerOnly>
  );
}

type Phase = "edit" | "creating" | "done";

function WelcomeWizard() {
  const { warehouseId } = useWarehouse();
  const { garage } = useOperatingMode();
  const [params] = useSearchParams();
  const wide = useMinWidth(768);
  const mapPath = warehouseId ? `/api/map?warehouseId=${encodeURIComponent(warehouseId)}` : null;
  const map = useApiQuery<WarehouseMapData>(mapPath);
  const data = map.data;
  // Barcodes are unique per organization, so codes in the other buildings are taken here too.
  const orgLocations = useApiQuery<Location[]>("/api/locations");
  const orgReady = orgLocations.data !== undefined || orgLocations.isError;
  const takenCodes = useMemo(
    () => (orgLocations.data ?? []).filter((row) => row.warehouseId !== warehouseId).map((row) => row.code),
    [orgLocations.data, warehouseId],
  );

  const [step, setStep] = useState<SetupStepId>(() => (isStepId(params.get("step")) ? (params.get("step") as SetupStepId) : "building"));
  const [input, setInput] = useState<SetupInput | null>(null);
  const [inputFor, setInputFor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("edit");
  const [progress, setProgress] = useState<CreateProgress | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdSoFar, setCreatedSoFar] = useState<string[]>([]);
  /** Slot roles a failed run still owes (its racks exist, their roles do not). Run with the next Create. */
  const [carried, setCarried] = useState<SetupRequest[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const zone = useMemo(browserTimeZone, []);

  // One SetupInput per warehouse: built when its map (and the org's codes) first load, kept through refetches.
  useEffect(() => {
    if (!data || !orgReady || !warehouseId || inputFor === warehouseId) return;
    setInput(defaultSetupInput({ warehouse: data.warehouse, existing: data.locations, garage, browserTimeZone: zone, takenCodes }));
    setInputFor(warehouseId);
    setPhase("edit");
    setCreateError(null);
    setCreatedSoFar([]);
    setCarried([]);
  }, [data, orgReady, warehouseId, inputFor, garage, zone, takenCodes]);

  const existing: ExistingBin[] = data?.locations ?? NO_BINS;
  const plan = useMemo(
    () => (input && data ? planSetup(input, { existing: data.locations, warehouse: data.warehouse, takenCodes, garage }) : null),
    [input, data, takenCodes, garage],
  );
  const requests = useMemo(() => (plan ? withCarriedRequests(plan.requests, carried) : []), [plan, carried]);

  // After Create, keyboard focus lands on the done heading rather than falling to the page body.
  useEffect(() => {
    if (phase !== "done") return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  const treeName = input?.building.name.trim() || data?.warehouse.name || "Your building";
  const tree = useMemo(
    () => buildHierarchyTree(treeName, [...existingHierarchy(existing), ...plannedHierarchy(plan?.bins ?? [])]),
    [treeName, existing, plan],
  );

  const highlight = useMemo(() => {
    const codes = new Set<string>();
    for (const bin of plan?.bins ?? []) {
      codes.add(bin.code);
      if (bin.aisle && bin.rack) {
        const rack = `${bin.aisle}-${normalizeRack(bin.rack)}`;
        codes.add(rack);
        codes.add(`${rack}-${padBay(bin.bay ?? "01")}`);
      }
    }
    return codes;
  }, [plan]);

  const rackCodes = useMemo(() => (input ? previewRackCodes(input.racks, existing) : []), [input, existing]);
  const rackShape = useMemo<RackPreviewShape | null>(() => {
    if (!input || !input.racks.include || !rackCodes.length) return null;
    const first = parseBinCode(rackCodes[0]!);
    const bays = clampNumber(input.racks.bays, SETUP_LIMITS.bays.min, SETUP_LIMITS.bays.max);
    const levels = clampNumber(input.racks.levels, SETUP_LIMITS.levels.min, SETUP_LIMITS.levels.max);
    if (!first || bays === null || levels === null) return null;
    return { aisle: first.aisle, rack: first.rack, bays, levels, pickFaces: input.racks.pickFaces };
  }, [input, rackCodes]);

  const floorLocations = useMemo<MapLocation[]>(() => {
    if (!data) return [];
    return [...data.locations, ...(plan?.bins ?? []).map((bin) => plannedMapLocation(bin, data.warehouse.id, data.warehouse.name))];
  }, [data, plan]);

  const status = useMemo(() => {
    const rows = {} as Record<SetupStepId, StepStatus>;
    for (const id of SETUP_STEP_IDS) {
      rows[id] = { issues: plan ? issuesForStep(plan, id).length : 0, included: input ? stepIncluded(input, id) : true };
    }
    return rows;
  }, [plan, input]);

  function goTo(next: SetupStepId | null) {
    if (!next) return;
    setStep(next);
    window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: false }));
  }

  async function create() {
    if (!plan || !data || !input || !warehouseId || !mapPath || !requests.length) return;
    setPhase("creating");
    setCreateError(null);
    setProgress(null);
    const created: string[] = [];
    const completed: SetupRequest[] = [];
    const description = plan.description;
    try {
      await runSetupRequests({ warehouseId, requests, existing: data.locations, created, completed, onProgress: setProgress });
      await refreshApi();
      toast.success(description ? `Created ${description}.` : "Building saved.");
      setCreatedSoFar([]);
      setCarried([]);
      setPhase("done");
    } catch (err) {
      const message = errorText(err, "Could not create that.");
      setCreateError(message);
      toast.error(message);
      setCreatedSoFar(created);
      setPhase("edit");
      try {
        await refreshApi();
      } catch {
        /* The map query reports its own failure. */
      }
      const fresh = queryClient.getQueryData<WarehouseMapData>(apiKey(mapPath));
      if (fresh) {
        // Steps this run finished switch off, a rack step that got some racks asks for the rest, and
        // the slot roles it still owes ride along with the next Create.
        const summary = summarizeCompleted(completed);
        setCarried(pendingSlotRoles(requests, completed, fresh.locations));
        setInput((prev) =>
          prev
            ? mergeSetupInput(
                prev,
                defaultSetupInput({ warehouse: fresh.warehouse, existing: fresh.locations, garage, browserTimeZone: zone, takenCodes }),
                summary,
              )
            : prev,
        );
      }
    } finally {
      setProgress(null);
    }
  }

  const header = (
    <PageHeader
      eyebrow="Getting started"
      title="Set up your building"
      description="Name the building, then add the places stock passes through. The map draws itself as you go."
      actions={
        <>
          <UiButton asChild variant="outline" size="sm">
            <Link to="/map?edit=1">
              <Hammer />
              Build floor instead
            </Link>
          </UiButton>
          <UiButton type="button" variant="ghost" size="sm" onClick={() => openTour("hierarchy")}>
            <Compass />
            Take the tour
          </UiButton>
        </>
      }
    />
  );

  if (!warehouseId) {
    return (
      <div className="space-y-(--density-gap)">
        {header}
        <EmptyState
          title="No warehouse yet"
          body="Add a building under Settings → Warehouse, then come back to lay it out."
          action={
            <UiButton asChild variant="outline">
              <Link to="/setup/warehouse">Open warehouse settings</Link>
            </UiButton>
          }
        />
      </div>
    );
  }

  if (map.error && !data) {
    return (
      <div className="space-y-(--density-gap)">
        {header}
        <ErrorBanner error={errorText(map.error, "Could not load the map.")} />
        <Button variant="outline" onClick={() => void map.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!data || !input || !plan) {
    return (
      <div className="space-y-(--density-gap)">
        {header}
        <div className="grid gap-(--density-gap) lg:grid-cols-[13rem_minmax(0,1fr)]">
          <Skeleton className="h-12 w-full rounded-lg lg:h-80" />
          <div className="grid gap-(--density-gap) md:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
            <Skeleton className="h-96 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const all = existingHierarchy(data.locations);
    const summary = describeHierarchy(summarizeHierarchy(all));
    return (
      <div className="space-y-(--density-gap)">
        {header}
        <Card className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tone-success-bg text-tone-success">
              <Check className="size-5" strokeWidth={2.5} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
                {data.warehouse.name} is set up
              </h2>
              <p className="text-sm text-muted-foreground">
                {summary ? `${summary}.` : "No bins yet. Build floor on the map can add them any time."} Every bin is a
                barcode, so the next step is to print labels and stick them on.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <UiButton asChild>
              <Link to="/stock/locations?labels=1">
                <Printer />
                Print bay labels
              </Link>
            </UiButton>
            <UiButton asChild variant="outline">
              <Link to="/map">
                <MapIcon />
                Open the map
              </Link>
            </UiButton>
            <UiButton asChild variant="outline">
              <Link to="/stock/items">
                <Package />
                Add your first SKU
              </Link>
            </UiButton>
            <UiButton asChild variant="ghost">
              <Link to="/today#getting-started">Back to Today</Link>
            </UiButton>
          </div>
          <p className="text-sm text-muted-foreground">
            New to the words?{" "}
            <button
              type="button"
              onClick={() => openTour("hierarchy")}
              className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Take the tour
            </button>
          </p>
        </Card>
        <Card className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">The whole building</h3>
            <p className="text-xs text-muted-foreground">Warehouse, areas, racks, bays, bins. Open a rack to see its bays.</p>
          </div>
          <HierarchyTree tree={buildHierarchyTree(data.warehouse.name, all)} />
        </Card>
      </div>
    );
  }

  const current = setupStep(step);
  const index = SETUP_STEPS.findIndex((row) => row.id === step);
  const stepIssues = issuesForStep(plan, step);
  const previous = previousSetupStep(step);
  const next = nextSetupStep(step);
  const busy = phase === "creating";
  const nothingToCreate = requests.length === 0 && plan.issues.length === 0;
  const suggestedZone =
    (data.warehouse.timeZone?.trim() || "UTC") === "UTC" && !!zone && input.building.timeZone === zone;

  const panel = <LivePanel step={step} plan={plan} tree={tree} highlight={highlight} rack={rackShape} />;

  return (
    <div className="space-y-(--density-gap)">
      {header}
      <div className="grid gap-(--density-gap) lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
        <SetupStepper current={step} status={status} onSelect={goTo} disabled={busy} />
        <div className="grid gap-(--density-gap) md:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] md:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,23rem)]">
          <Card className="space-y-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Step {index + 1} of {SETUP_STEPS.length} · {current.teaches}
              </p>
              <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold leading-tight outline-none">
                {current.question}
              </h2>
              <p className="text-sm text-muted-foreground">{current.title}</p>
            </div>

            {step === "building" ? (
              <BuildingStep
                value={input.building}
                onChange={(building) => setInput({ ...input, building })}
                issues={stepIssues}
                garage={garage}
                suggestedZone={suggestedZone}
              />
            ) : step === "dock" ? (
              <AreaStep
                source="dock"
                value={input.dock}
                onChange={(dock) => setInput({ ...input, dock })}
                issues={stepIssues}
                existing={existing}
              />
            ) : step === "racks" ? (
              <RacksStep
                value={input.racks}
                onChange={(racks) => setInput({ ...input, racks })}
                issues={stepIssues}
                existing={existing}
                codes={rackCodes}
              />
            ) : step === "bench" ? (
              <AreaStep
                source="bench"
                value={input.bench}
                onChange={(bench) => setInput({ ...input, bench })}
                issues={stepIssues}
                existing={existing}
              />
            ) : step === "ship" ? (
              <AreaStep
                source="ship"
                value={input.ship}
                onChange={(ship) => setInput({ ...input, ship })}
                issues={stepIssues}
                existing={existing}
              />
            ) : (
              <div className="space-y-4">
                <LevelLesson
                  ids={[]}
                  intro="Read the tree top to bottom: that is the address of every bin. Nothing is created until you press Create."
                />
                <div className="rounded-lg border bg-primary/5 p-3">
                  {plan.description || carried.length ? (
                    <>
                      <p className="text-base font-semibold">
                        {plan.description ||
                          `${carried.length} pick face and bulk ${carried.length === 1 ? "mark" : "marks"} still owed from the last run`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {plan.requests.some((request) => request.kind === "warehouse")
                          ? "Plus the building's name and timezone."
                          : "The building's name and timezone are unchanged."}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-base font-semibold">Nothing to create yet</p>
                      <p className="text-sm text-muted-foreground">
                        Switch a step on to add a dock, shelves, a bench, or an outbound bay.
                        {plan.requests.some((request) => request.kind === "warehouse")
                          ? " Create will still save the building's name and timezone."
                          : ""}
                      </p>
                    </>
                  )}
                </div>
                <ReviewIssues issues={plan.issues} onFix={(issue) => goTo(issue.step)} />
                {createError ? (
                  <div className="space-y-2">
                    <ErrorBanner error={createError} />
                    {createdSoFar.length ? (
                      <p className="text-sm text-muted-foreground">
                        Already created: <span className="font-mono text-foreground">{createdSoFar.join(", ")}</span>. The plan
                        below now starts after them.
                        {carried.length
                          ? ` ${carried.length} pick face and bulk ${carried.length === 1 ? "mark" : "marks"} from that run ${carried.length === 1 ? "is" : "are"} still owed and will run with the next Create.`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {busy && progress ? (
                  <div className="space-y-2" role="status" aria-live="polite">
                    <p className="text-sm">
                      {progress.label} · <span className="tabular-nums">{progress.index} of {progress.total}</span>
                    </p>
                    <Progress value={(progress.index / progress.total) * 100} aria-label="Create progress" />
                  </div>
                ) : null}
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your building after this</h3>
                  <HierarchyTree tree={tree} highlightCodes={highlight} defaultOpenDepth={3} className="rounded-lg border p-2" />
                </section>
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On the floor</h3>
                  <div className="rounded-lg border bg-card p-2">
                    <FloorLocator
                      warehouse={data.warehouse}
                      locations={floorLocations}
                      tones={NO_TONES}
                      focusId={null}
                      onFocus={() => {}}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Dock, bench, and outbound are tinted; racks are the grey blocks. Build floor on the map moves anything later.
                  </p>
                </section>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => goTo(previous)} disabled={!previous || busy}>
                <ArrowLeft className="size-4" />
                Back
              </Button>
              {step === "review" ? (
                <Button onClick={() => void create()} disabled={busy || plan.issues.length > 0 || nothingToCreate}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {busy ? "Creating…" : createError ? "Try again" : "Create"}
                </Button>
              ) : (
                <Button onClick={() => goTo(next)} disabled={!next}>
                  Next
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </Card>

          {wide ? (
            <aside aria-label="Live picture" className={cn("rounded-lg border bg-card p-(--density-gap) md:sticky md:top-2")}>
              {panel}
            </aside>
          ) : (
            <details open className="group rounded-lg border bg-card">
              <summary className="flex min-h-11 cursor-pointer select-none items-center justify-between px-(--density-gap) text-sm font-medium">
                Live picture
                <span className="text-xs font-normal text-muted-foreground">
                  <span className="group-open:hidden">Show</span>
                  <span className="hidden group-open:inline">Hide</span>
                </span>
              </summary>
              <div className="border-t p-(--density-gap)">{panel}</div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
