import type { ReactNode } from "react";
import { binKindLabel, type HierarchyNode } from "@/domain/hierarchy";
import type { SetupPlan, SetupStepId } from "@/domain/setup-wizard";
import { cn } from "@/lib/utils";
import { HierarchyTree } from "./HierarchyTree";
import { RackPreview } from "./RackPreview";

export type RackPreviewShape = { aisle: string; rack: string; bays: number; levels: number; pickFaces: boolean };

/** The steps the plan will take, one line each, with the slot roles rolled up. */
export function planLines(plan: SetupPlan): string[] {
  const lines: string[] = [];
  let pick = 0;
  let bulk = 0;
  for (const request of plan.requests) {
    if (request.kind === "warehouse") {
      const what = [request.body.name ? "name" : null, request.body.timeZone ? "timezone" : null].filter(Boolean).join(" and ");
      lines.push(`Save the building's ${what || "settings"}`);
    } else if (request.kind === "area") {
      lines.push(`Add ${binKindLabel(request.body.type).toLowerCase()} ${request.body.code}`);
    } else if (request.kind === "rack") {
      lines.push(`Create rack ${request.body.aisle}-${request.body.rack} with ${request.codes.length} bins`);
    } else if (request.slotRole === "pick") pick += 1;
    else bulk += 1;
  }
  if (pick || bulk) {
    const roles = [pick ? `${pick} pick ${pick === 1 ? "face" : "faces"}` : null, bulk ? `${bulk} bulk ${bulk === 1 ? "bay" : "bays"}` : null];
    lines.push(`Mark ${roles.filter(Boolean).join(" and ")}`);
  }
  return lines;
}

/**
 * The live picture beside the form: the tree of what exists plus what is planned, the rack face
 * while shelves are being shaped, and the list of API calls on the review step.
 */
export function LivePanel({
  step,
  plan,
  tree,
  highlight,
  rack,
  className,
}: {
  step: SetupStepId;
  plan: SetupPlan;
  tree: HierarchyNode;
  highlight: ReadonlySet<string>;
  rack: RackPreviewShape | null;
  className?: string;
}) {
  const lines = step === "review" ? planLines(plan) : [];
  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <p className="text-sm font-medium">{step === "review" ? "What Create will do" : "Your building"}</p>
        <p className="text-xs text-muted-foreground">
          {plan.description ? `Adding ${plan.description}.` : "Nothing planned yet. Switch a step on to add to the tree."}
        </p>
      </div>
      {step === "racks" && rack ? (
        <PanelSection title={`Rack ${rack.aisle}-${rack.rack}, from the front`}>
          <RackPreview {...rack} />
        </PanelSection>
      ) : null}
      {step === "review" ? (
        lines.length ? (
          <ol className="space-y-1.5 text-sm">
            {lines.map((line, index) => (
              <li key={line} className="flex items-start gap-2">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        )
      ) : (
        <PanelSection title="The tree so far" hint="Planned bins are marked new.">
          <HierarchyTree tree={tree} highlightCodes={highlight} />
        </PanelSection>
      )}
    </div>
  );
}

function PanelSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
