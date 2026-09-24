import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { SETUP_STEPS, type SetupStepId } from "@/domain/setup-wizard";
import { cn } from "@/lib/utils";

export type StepStatus = { issues: number; included: boolean };

/**
 * The six steps, each a button so any of them can be opened. A horizontal, scrollable row on
 * phones; a vertical rail from lg up. Steps with a problem carry a danger dot; switched-off
 * steps read "Skipped".
 */
export function SetupStepper({
  current,
  status,
  onSelect,
  disabled,
  className,
}: {
  current: SetupStepId;
  status: Record<SetupStepId, StepStatus>;
  onSelect: (id: SetupStepId) => void;
  /** While Create runs: the steps stay visible but cannot be opened. */
  disabled?: boolean;
  className?: string;
}) {
  const currentIndex = SETUP_STEPS.findIndex((step) => step.id === current);
  const activeRef = useRef<HTMLButtonElement>(null);

  // On phones the row scrolls sideways; keep the current step on screen when it changes.
  useEffect(() => {
    const node = activeRef.current;
    if (!node) return;
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* Old browsers: scroll without animating. */
    }
    node.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
  }, [current]);
  return (
    <ol
      aria-label="Setup steps"
      className={cn("-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0", className)}
    >
      {SETUP_STEPS.map((step, index) => {
        const active = step.id === current;
        const state = status[step.id];
        const trouble = state.issues > 0;
        const skipped = !state.included;
        const passed = index < currentIndex && !trouble && !skipped;
        const note = trouble
          ? `${state.issues === 1 ? "1 thing" : `${state.issues} things`} to fix`
          : skipped
            ? "Skipped"
            : step.teaches;
        return (
          <li key={step.id} className="shrink-0 lg:shrink">
            <button
              ref={active ? activeRef : undefined}
              type="button"
              aria-current={active ? "step" : undefined}
              disabled={disabled}
              onClick={() => onSelect(step.id)}
              className={cn(
                "flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default disabled:opacity-70",
                active ? "border-primary/50 bg-primary/5 ring-2 ring-primary/10" : "border-transparent hover:bg-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
                  trouble
                    ? "border-tone-danger bg-tone-danger-bg text-tone-danger"
                    : passed
                      ? "border-transparent bg-tone-success-bg text-tone-success"
                      : active
                        ? "border-primary bg-primary text-primary-foreground"
                        : skipped
                          ? "border-dashed border-muted-foreground/50 text-muted-foreground"
                          : "text-muted-foreground",
                )}
              >
                {passed ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <span className="grid min-w-0 leading-tight">
                <span className={cn("whitespace-nowrap text-sm font-medium", skipped && !active && "text-muted-foreground")}>
                  {step.title}
                  <span className="sr-only">
                    {trouble ? ` (${note})` : skipped ? " (skipped)" : passed ? " (done)" : ""}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "flex items-center gap-1 whitespace-nowrap text-[11px]",
                    trouble ? "text-tone-danger" : "text-muted-foreground",
                  )}
                >
                  {trouble ? <span className="size-1.5 rounded-full bg-current" /> : null}
                  {note}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
