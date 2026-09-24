import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Compass, ListChecks, Map as MapIcon, ScanLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { garageAllowsPath } from "@/domain/operating-mode";
import { tourStepBody, tourStepIndex, tourStepsFor, type TourStep, type TourStepId } from "@/domain/tour";
import { useSession } from "@/app/session";
import { reopenOnboarding, useOnboarding } from "@/app/onboarding";
import { GETTING_STARTED_HASH, SampleDataButton } from "@/app/components/onboarding";
import { closeTour, useTourRequest, useTourSeen, useTourViewer } from "@/app/tour";
import {
  FloorDiagram,
  FlowDiagram,
  HierarchyDiagram,
  ModesDiagram,
  WelcomeDiagram,
  WorkspacesDiagram,
  type NavigateTo,
  type TourViewer,
} from "./diagrams";
import { Key } from "./shared";

/**
 * "How Rackline works": one dialog, mounted once in the app shell, that opens when anything calls
 * `openTour()`. Renders nothing until then, so the shell pays nothing for it.
 */
export function TourDialog() {
  const request = useTourRequest();
  if (!request.open) return null;
  return <OpenTour requested={request.step} nonce={request.nonce} />;
}

/** Focus here means the arrow keys belong to the control, not the tour. */
const ARROW_OWNERS =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='radiogroup'], [role='tablist'], [role='listbox'], [role='menu'], [role='slider'], [role='combobox'], [data-arrow-keys]";

const FOOT_BUTTON = "h-11 sm:h-9";

function OpenTour({ requested, nonce }: { requested: TourStepId | null; nonce: number }) {
  const me = useSession();
  const viewer = useTourViewer();
  const navigate = useNavigate();
  const location = useLocation();
  const [, markSeen] = useTourSeen();
  // Owners only by default; operators never fetch. Already cached by the Getting started card.
  const onboarding = useOnboarding();
  const steps = useMemo(() => tourStepsFor({ role: viewer.role }), [viewer.role]);

  const [index, setIndex] = useState(() => tourStepIndex(steps, requested));
  const [seenNonce, setSeenNonce] = useState(nonce);
  if (seenNonce !== nonce) {
    // A second openTour() while open restarts at the step it named.
    setSeenNonce(nonce);
    setIndex(tourStepIndex(steps, requested));
  }
  const current = Math.max(0, Math.min(index, steps.length - 1));
  const step = steps[current];
  const last = current === steps.length - 1;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const finish = useCallback(() => {
    markSeen();
    closeTour();
  }, [markSeen]);

  const go: NavigateTo = (path) => {
    finish();
    navigate(path);
  };

  // A glossary card's "Learn more" (or anything else) that changes the page closes the tour, so the
  // person never lands on a page under a still-open dialog.
  const openedAt = useRef(location.key);
  useEffect(() => {
    if (location.key !== openedAt.current) finish();
  }, [location.key, finish]);

  function goTo(next: number) {
    setIndex(Math.max(0, Math.min(next, steps.length - 1)));
  }

  useEffect(() => {
    // A new step starts at its top, and keeps keyboard focus inside the dialog when the control
    // that had it (Back on the first step, Skip on the last) went away.
    scrollRef.current?.scrollTo({ top: 0 });
    const active = document.activeElement;
    if (!active || active === document.body || !wrapperRef.current?.contains(active)) {
      primaryRef.current?.focus();
    }
  }, [current]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    // A glossary card is its own dialog, portaled outside this one.
    if (target.closest("[role='dialog']") !== event.currentTarget) return;
    if (target.closest(ARROW_OWNERS)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") goTo(current - 1);
    else if (!last) goTo(current + 1);
  }

  if (!step) return null;
  const body = tourStepBody(step, viewer);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish();
      }}
    >
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          primaryRef.current?.focus();
        }}
      >
        <div ref={wrapperRef} className="flex max-h-[80vh] flex-col md:flex-row">
          <StepRail steps={steps} current={current} onSelect={goTo} />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <StepDots steps={steps} current={current} onSelect={goTo} />

            <DialogHeader className="gap-1 px-4 pt-3 pr-12 text-left sm:px-6 md:pt-6">
              <DialogDescription aria-live="polite" className="text-[11px] font-medium uppercase tracking-wider">
                {step.eyebrow} · Step {current + 1} of {steps.length}
              </DialogDescription>
              <DialogTitle className="text-xl leading-tight tracking-tight">{step.title}</DialogTitle>
            </DialogHeader>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="max-w-prose space-y-3 text-sm leading-relaxed">
                {body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <div className="mt-5">
                <StepPicture
                  step={step}
                  viewer={viewer}
                  floorVerbs={me.floorVerbs}
                  baysDone={onboarding.steps.some((row) => row.id === "bays" && row.done)}
                  orgId={me.organization.id}
                  go={go}
                  finish={finish}
                />
              </div>
            </div>

            <DialogFooter className="flex-row items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 sm:justify-between sm:px-6">
              <div className="min-w-0">
                {last ? null : (
                  <Button type="button" variant="ghost" className={cn(FOOT_BUTTON, "text-muted-foreground")} onClick={finish}>
                    Skip tour
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={cn(FOOT_BUTTON, current === 0 && "invisible")}
                  onClick={() => goTo(current - 1)}
                >
                  <ArrowLeft />
                  Back
                </Button>
                <Button
                  ref={primaryRef}
                  type="button"
                  className={cn(FOOT_BUTTON, "min-w-24")}
                  onClick={last ? finish : () => goTo(current + 1)}
                >
                  {last ? (
                    "Done"
                  ) : (
                    <>
                      Next
                      <ArrowRight />
                    </>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ step lists */

function StepRail({ steps, current, onSelect }: { steps: TourStep[]; current: number; onSelect: (index: number) => void }) {
  return (
    <nav aria-label="Tour steps" className="hidden w-48 shrink-0 flex-col border-r bg-muted/30 p-3 md:flex">
      <p className="flex items-center gap-1.5 px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Compass aria-hidden className="size-3.5" />
        How Rackline works
      </p>
      <ol className="space-y-0.5">
        {steps.map((step, index) => {
          const active = index === current;
          return (
            <li key={step.id}>
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(index)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none motion-safe:transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "bg-primary/5 ring-1 ring-primary/20" : "hover:bg-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : index < current
                        ? "border-primary/40 text-primary"
                        : "text-muted-foreground",
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{step.eyebrow}</span>
                  <span className={cn("block text-sm leading-tight", active ? "font-semibold" : "font-medium text-foreground/80")}>
                    {step.title}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-auto flex items-center gap-1 px-2 pt-4 text-[11px] text-muted-foreground">
        <Key>←</Key>
        <Key>→</Key>
        <span className="pl-0.5">move between steps</span>
      </p>
    </nav>
  );
}

function StepDots({ steps, current, onSelect }: { steps: TourStep[]; current: number; onSelect: (index: number) => void }) {
  return (
    <ol aria-label="Tour steps" className="flex items-center justify-center pt-1.5 md:hidden">
      {steps.map((step, index) => {
        const active = index === current;
        return (
          <li key={step.id}>
            <button
              type="button"
              aria-current={active ? "step" : undefined}
              aria-label={`Step ${index + 1} of ${steps.length}: ${step.title}`}
              onClick={() => onSelect(index)}
              className="flex h-11 min-w-11 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span
                aria-hidden
                className={cn("h-1.5 rounded-full motion-safe:transition-all", active ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/40")}
              />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ pictures and the last step */

function StepPicture({
  step,
  viewer,
  floorVerbs,
  baysDone,
  orgId,
  go,
  finish,
}: {
  step: TourStep;
  viewer: TourViewer;
  floorVerbs: string[] | undefined;
  baysDone: boolean;
  orgId: string;
  go: NavigateTo;
  finish: () => void;
}) {
  switch (step.id) {
    case "welcome":
      return <WelcomeDiagram />;
    case "hierarchy":
      return <HierarchyDiagram viewer={viewer} onNavigate={go} />;
    case "flow":
      return <FlowDiagram viewer={viewer} onNavigate={go} />;
    case "workspaces":
      return <WorkspacesDiagram garage={viewer.garage} />;
    case "floor":
      return <FloorDiagram verbs={floorVerbs} garage={viewer.garage} />;
    case "modes":
      return <ModesDiagram garage={viewer.garage} onNavigate={go} />;
    case "finish":
      return <FinishActions viewer={viewer} baysDone={baysDone} orgId={orgId} go={go} finish={finish} />;
    default:
      return null;
  }
}

function FinishActions({
  viewer,
  baysDone,
  orgId,
  go,
  finish,
}: {
  viewer: TourViewer;
  baysDone: boolean;
  orgId: string;
  go: NavigateTo;
  finish: () => void;
}) {
  const allowed = (path: string) => !viewer.garage || garageAllowsPath(path);

  if (!viewer.owner) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {allowed("/floor") ? (
          <Button type="button" className={FOOT_BUTTON} onClick={() => go("/floor")}>
            <ScanLine />
            Open the floor
            <ArrowRight />
          </Button>
        ) : null}
        {allowed("/floor/lookup") ? (
          <Button type="button" variant="outline" className={FOOT_BUTTON} onClick={() => go("/floor/lookup")}>
            <Search />
            Look something up
          </Button>
        ) : null}
      </div>
    );
  }

  const primary =
    baysDone && allowed("/map")
      ? { label: "Open the map", path: "/map", icon: MapIcon }
      : allowed("/welcome")
        ? { label: "Set up your building", path: "/welcome", icon: Building2 }
        : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary ? (
        <Button type="button" className={FOOT_BUTTON} onClick={() => go(primary.path)}>
          <primary.icon />
          {primary.label}
          <ArrowRight />
        </Button>
      ) : null}
      <SampleDataButton size="default" className={FOOT_BUTTON} onLoaded={finish} />
      {allowed("/today") ? (
        <Button
          type="button"
          variant="outline"
          className={FOOT_BUTTON}
          onClick={() => {
            reopenOnboarding(orgId);
            go(`/today${GETTING_STARTED_HASH}`);
          }}
        >
          <ListChecks />
          Open the checklist
        </Button>
      ) : null}
    </div>
  );
}
