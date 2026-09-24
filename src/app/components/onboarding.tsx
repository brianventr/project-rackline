import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Check, Compass, EyeOff, Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { buildSampleCatalog, onboardingCountLabel } from "@/domain/onboarding";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";
import { useSession } from "../session";
import { useWarehouse } from "../warehouse";
import {
  loadSampleData,
  useOnboarding,
  useOnboardingDismissed,
  useOnboardingReopened,
  type OnboardingStepId,
  type OnboardingStepView,
  type SampleDataResult,
} from "../onboarding";
import { useConfirm } from "./confirm";
import { openTour } from "../tour";

export const GETTING_STARTED_HASH = "#getting-started";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Focus fell to the page body (the control that had it was removed or disabled). */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/**
 * Hand keyboard focus to the page's main heading (focusable for this once), so a keyboard or screen-reader
 * user keeps their place when the control they pressed goes away.
 */
function focusPageHeading(from?: Element | null) {
  const heading =
    from?.closest("main")?.querySelector<HTMLElement>("h1") ?? document.querySelector<HTMLElement>("main h1");
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) {
    heading.setAttribute("tabindex", "-1");
    heading.addEventListener("blur", () => heading.removeAttribute("tabindex"), { once: true });
  }
  heading.focus();
}

/** A thin progress ring. Content in `children` sits in the middle. */
export function ProgressRing({
  value,
  total,
  size = 40,
  stroke = 4,
  label,
  className,
  trackClassName = "stroke-muted",
  fillClassName = "stroke-primary",
  children,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
  trackClassName?: string;
  fillClassName?: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <span
      role="img"
      aria-label={label ?? `${value} of ${total} done`}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className={trackClassName} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={cn(fillClassName, "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500")}
          style={fraction === 0 ? { opacity: 0 } : undefined}
        />
      </svg>
      {children ? (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          {children}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Owner-only "Load sample data" with a confirm. Renders nothing unless the org is empty (no SKUs, no bays),
 * the viewer is an owner, and a warehouse is selected.
 */
export function SampleDataButton({
  variant = "outline",
  size = "sm",
  className,
  children = "Load sample data",
  onLoaded,
}: {
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "xs";
  className?: string;
  children?: ReactNode;
  /**
   * Runs after a successful load. The button goes away once the org has data; without `onLoaded` it hands
   * keyboard focus to the page heading, so callers that pass it choose where focus goes.
   */
  onLoaded?: (result: SampleDataResult) => void;
}) {
  const me = useSession();
  const { warehouseId, warehouse } = useWarehouse();
  const onboarding = useOnboarding();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (me.role !== "owner" || !onboarding.sampleAvailable || !warehouseId) return null;

  async function load() {
    const catalog = buildSampleCatalog();
    const parent = catalog.items.find((row) => row.key === catalog.bom.parentKey);
    const parts = catalog.items.filter((row) => row.key !== catalog.bom.parentKey).map((row) => row.sku);
    const ok = await confirm({
      title: "Load sample data?",
      body: (
        <div className="space-y-2">
          <p>
            Adds {catalog.items.length} SKUs to practice on ({parent?.sku} and its parts {parts.join(", ")}, with a
            recipe) and {catalog.locations.length} bays in {warehouse?.name ?? "this warehouse"}: a receiving dock,
            a pick face, a bulk bay, a spare bay, and a shipping bay.
          </p>
          <p>
            No stock and no orders. Every name ends in “(sample)”, so you can find and delete them later.
          </p>
        </div>
      ),
      confirmLabel: "Load sample data",
      cancelLabel: "Not now",
    });
    if (!ok) return;
    const main = buttonRef.current?.closest("main") ?? null;
    setBusy(true);
    try {
      const result = await loadSampleData(warehouseId);
      toast.success(`Loaded ${result.items.length} sample SKUs and ${result.locations.length} bays. Next, receive some stock.`);
      if (onLoaded) onLoaded(result);
      else
        window.requestAnimationFrame(() => {
          if (focusIsLost()) focusPageHeading(main);
        });
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Could not load sample data.");
      // The button was disabled while it worked, which drops focus; give it back.
      window.requestAnimationFrame(() => {
        if (focusIsLost()) buttonRef.current?.focus();
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={busy}
      onClick={() => void load()}
    >
      {busy ? <Loader2 className="animate-spin" /> : <PackageOpen />}
      {children}
    </Button>
  );
}

/**
 * The getting-started card for the top of Today. Shows for owners while a required step is open
 * (or after it was reopened on purpose) and until it is hidden. Scrolls into view on `#getting-started`.
 */
export function OnboardingChecklist({ className }: { className?: string }) {
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  const owner = me.role === "owner";
  const onboarding = useOnboarding();
  const [dismissed, setDismissed] = useOnboardingDismissed();
  const reopened = useOnboardingReopened();
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  /**
   * Skip, "Show them", and a sample load each remove the control that was pressed. This finds where keyboard
   * focus goes next once the checklist has re-rendered (null while the old control is still there).
   */
  const pendingFocus = useRef<((section: HTMLElement) => HTMLElement | null) | null>(null);
  const visible = owner && !!onboarding.data && !dismissed && (onboarding.incomplete || reopened);

  useEffect(() => {
    if (!visible || location.hash !== GETTING_STARTED_HASH) return;
    const node = ref.current;
    if (!node) return;
    node.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  }, [visible, location.hash, location.key]);

  function flushFocus() {
    const find = pendingFocus.current;
    const section = ref.current;
    if (!find || !section) return;
    if (!focusIsLost() && !section.contains(document.activeElement)) {
      // They have moved on; leave focus where it is.
      pendingFocus.current = null;
      return;
    }
    const target = find(section);
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  }

  useEffect(flushFocus);

  function focusWhenReady(find: (section: HTMLElement) => HTMLElement | null) {
    pendingFocus.current = find;
    window.requestAnimationFrame(flushFocus);
  }

  if (!visible) return null;

  const { progress, steps, next } = onboarding;
  const required = steps.filter((step) => !step.optional);
  const optional = steps.filter((step) => step.optional && !step.skipped);
  const skipped = steps.filter((step) => step.skipped);
  const titleId = "getting-started-title";

  function hide() {
    // The whole card goes away; keep keyboard users on the page rather than at the top of the document.
    focusPageHeading(ref.current);
    setDismissed(true);
    toast(
      progress.complete
        ? "Checklist hidden. Search Getting started in the command palette to bring it back."
        : "Checklist hidden. Open it again from Getting started in the sidebar.",
    );
  }

  /** Skip an optional step, then land on the next optional step's button (or "Show it" when none is left). */
  function skipStep(id: OnboardingStepId) {
    const before = [...(ref.current?.querySelectorAll<HTMLElement>("[data-optional-cta]") ?? [])];
    const at = Math.max(0, before.findIndex((node) => node.dataset.optionalCta === id));
    focusWhenReady((section) => {
      if (section.querySelector(`[data-optional-cta="${id}"]`)) return null;
      const left = [...section.querySelectorAll<HTMLElement>("[data-optional-cta]")];
      return left[Math.min(at, left.length - 1)] ?? section.querySelector<HTMLElement>("[data-show-skipped]") ?? section;
    });
    onboarding.skip(id);
  }

  /** Bring skipped steps back, then land on the first of them. */
  function showSkipped() {
    const first = skipped[0]?.id;
    focusWhenReady((section) => {
      if (section.querySelector("[data-show-skipped]")) return null;
      return (first && section.querySelector<HTMLElement>(`[data-optional-cta="${first}"]`)) || section;
    });
    onboarding.unskipAll();
  }

  return (
    <section
      ref={ref}
      id={GETTING_STARTED_HASH.slice(1)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cn("scroll-mt-[calc(var(--header-height,3.25rem)+1rem)] rounded-lg border bg-card shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <ProgressRing
          value={progress.done}
          total={progress.total}
          size={44}
          stroke={4}
          label={`${progress.done} of ${progress.total} steps done`}
          fillClassName={progress.complete ? "stroke-tone-success" : "stroke-primary"}
        >
          <span className="text-xs font-semibold tabular-nums">
            {progress.done}/{progress.total}
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold">
            {progress.complete ? "You are set up" : "Getting started"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {progress.complete
              ? "Every required step is done. The extras below are there when you want them."
              : garage
                ? "Four steps from an empty shelf to a shipped order. Each one ticks itself off when the work lands."
                : "Four steps from an empty warehouse to a shipped order. Each one ticks itself off when the work lands."}
          </p>
        </div>
        <div className="-mr-2 flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => openTour()} className="text-muted-foreground">
            <Compass />
            <span className="hidden sm:inline">How it works</span>
            <span className="sr-only sm:hidden">How Rackline works</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={hide} className="text-muted-foreground">
            <EyeOff />
            Hide
          </Button>
        </div>
      </div>

      {onboarding.sampleAvailable ? (
        <div data-sample-row className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/40 px-4 py-3">
          <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Just looking around?</span> Load a sample candle, its three
            parts, and five bays, then practice receiving and shipping before your real stock goes in.
          </p>
          <SampleDataButton
            onLoaded={() =>
              focusWhenReady((section) =>
                section.querySelector("[data-sample-row]")
                  ? null
                  : (section.querySelector<HTMLElement>("[data-next-step]") ?? section),
              )
            }
          />
        </div>
      ) : null}

      <div className={cn("grid", optional.length || skipped.length ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : null)}>
        <ol className="divide-y" aria-label="Required steps">
          {required.map((step, index) => (
            <StepRow key={step.id} step={step} index={index + 1} next={next === step.id} owner={owner} garage={garage} />
          ))}
        </ol>

        {optional.length || skipped.length ? (
          <div className="flex flex-col border-t lg:border-t-0 lg:border-l">
            <p className="bg-muted/30 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Optional
            </p>
            {optional.length ? (
              <ul className="divide-y border-t" aria-label="Optional steps">
                {optional.map((step) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    next={next === step.id}
                    owner={owner}
                    garage={garage}
                    onSkip={() => skipStep(step.id)}
                  />
                ))}
              </ul>
            ) : null}
            {skipped.length ? (
              <p className="mt-auto border-t px-4 py-2 text-xs text-muted-foreground">
                Skipped: {skipped.map((step) => step.title).join(", ")}.{" "}
                <button
                  type="button"
                  data-show-skipped
                  onClick={showSkipped}
                  className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Show {skipped.length === 1 ? "it" : "them"}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StepRow({
  step,
  index,
  next,
  owner,
  garage,
  onSkip,
}: {
  step: OnboardingStepView;
  index?: number;
  next: boolean;
  owner: boolean;
  garage: boolean;
  onSkip?: () => void;
}) {
  const note = step.done ? onboardingCountLabel(step.id, step.count) : null;
  const canAct = !step.done && (owner || !step.ownerOnly) && (!garage || garageAllowsPath(step.path));
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3", next && "bg-primary/[0.04]")}>
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
          step.done
            ? "border-transparent bg-tone-success-bg text-tone-success"
            : next
              ? "border-primary text-primary"
              : step.optional
                ? "border-dashed border-muted-foreground/50 text-muted-foreground"
                : "text-muted-foreground",
        )}
      >
        {step.done ? <Check className="size-3.5" strokeWidth={3} /> : (index ?? null)}
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className={cn("text-sm font-medium", step.done && "text-muted-foreground")}>
          {step.title}
          <span className="sr-only">{step.done ? " (done)" : step.skipped ? " (skipped)" : " (to do)"}</span>
        </p>
        <p className="text-sm text-muted-foreground">{step.done ? (note ?? "Done") : step.body}</p>
      </div>
      {canAct ? (
        <div className="ml-9 flex shrink-0 items-center gap-1 sm:ml-0">
          {onSkip ? (
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onSkip}>
              Skip
            </Button>
          ) : null}
          <Button asChild size="sm" variant={next ? "default" : "outline"}>
            <Link
              to={step.path}
              data-optional-cta={step.optional ? step.id : undefined}
              data-next-step={next ? "" : undefined}
            >
              {step.cta}
              {next ? <ArrowRight /> : null}
            </Link>
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Sidebar footer widget: a ring and "Getting started 2/4". Owners only, while a required step is open.
 * It links to the checklist on Today and brings it back if it was hidden.
 */
export function OnboardingProgress() {
  const me = useSession();
  const onboarding = useOnboarding();
  const [, setDismissed] = useOnboardingDismissed();
  const { isMobile, setOpenMobile } = useSidebar();

  if (me.role !== "owner" || !onboarding.incomplete) return null;
  const { done, total } = onboarding.progress;
  const nextStep = onboarding.steps.find((step) => step.id === onboarding.next);
  const summary = `Getting started ${done}/${total}`;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild size="lg" tooltip={summary} className="cursor-pointer">
          <Link
            to={`/today${GETTING_STARTED_HASH}`}
            aria-label={nextStep ? `${summary}. Next: ${nextStep.title}` : summary}
            onClick={() => {
              setDismissed(false);
              if (isMobile) setOpenMobile(false);
            }}
          >
            <ProgressRing
              value={done}
              total={total}
              size={32}
              stroke={3}
              label={`${done} of ${total} steps done`}
              trackClassName="stroke-sidebar-border"
              fillClassName="stroke-sidebar-primary"
            >
              <span className="text-[10px] font-semibold tabular-nums">{done}</span>
            </ProgressRing>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">
                Getting started <span className="tabular-nums text-sidebar-foreground/70">{done}/{total}</span>
              </span>
              {nextStep ? (
                <span className="truncate text-xs text-sidebar-foreground/70">Next: {nextStep.title}</span>
              ) : null}
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
