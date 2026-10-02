import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "@/app/api";
import { useDashboard } from "@/app/dashboard";
import { useExceptionInbox } from "@/app/exceptions";
import { useApiQuery } from "@/app/query";
import { useWrite } from "@/app/use-write";
import { FlowCanvas } from "@/app/components/automation/FlowCanvas";
import { Inspector } from "@/app/components/automation/Inspector";
import {
  FLOW_STEPS,
  draftFromView,
  draftsEqual,
  normalizeDraft,
  reviewLines,
  type AutomationDraft,
  type AutomationView,
  type FlowStepId,
} from "@/app/components/automation/model";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function stepIndex(value: string | null): number {
  const index = FLOW_STEPS.findIndex((step) => step.id === value);
  return index < 0 ? 0 : index;
}

export function AutomationPage() {
  const view = useApiQuery<AutomationView>("/api/organization/automation");
  const dashboard = useDashboard();
  const inbox = useExceptionInbox();
  const write = useWrite();
  const [params, setParams] = useSearchParams();
  const index = stepIndex(params.get("step"));
  const step = FLOW_STEPS[index]!.id;
  const [saved, setSaved] = useState<AutomationDraft | null>(null);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!view.data || saved) return;
    const next = draftFromView(view.data);
    setSaved(next);
    setDraft(next);
  }, [view.data, saved]);

  useEffect(() => {
    setSelectedId(null);
  }, [step]);

  const dirty = saved && draft ? !draftsEqual(saved, draft) : false;
  const counts = useMemo(() => {
    const items = inbox.data?.items ?? [];
    return {
      suggestions: dashboard.data?.replenishDue ?? 0,
      openReplenishments: dashboard.data?.openReplenishments ?? 0,
      exceptions: inbox.data?.counts.open ?? 0,
      restock: items.filter((item) => item.state === "open" && item.source === "restock").length,
      reorder: dashboard.data?.lowStock.length ?? 0,
    };
  }, [dashboard.data, inbox.data]);

  function go(next: number) {
    const id = FLOW_STEPS[next]?.id;
    if (!id) return;
    const search = new URLSearchParams(params);
    search.set("step", id);
    setParams(search, { replace: true });
  }

  async function publish() {
    if (!draft || !saved || !dirty) return;
    const next = normalizeDraft(draft);
    const result = await write.run(
      "Publish automation",
      async () => {
        if (JSON.stringify(next.policy) !== JSON.stringify(saved.policy)) {
          await api("/api/organization/automation", {
            method: "PATCH",
            body: JSON.stringify({ policy: next.policy }),
          });
        }
        if (next.restockPolicy !== saved.restockPolicy) {
          await api("/api/organization", {
            method: "PATCH",
            body: JSON.stringify({ restockPolicy: next.restockPolicy }),
          });
        }
        const mailChanged =
          next.shipped !== saved.shipped ||
          next.outForDelivery !== saved.outForDelivery ||
          next.delivered !== saved.delivered ||
          next.deliveryException !== saved.deliveryException ||
          next.returnLabel !== saved.returnLabel ||
          next.replyTo.toLowerCase() !== saved.replyTo.trim().toLowerCase() ||
          next.senderName !== saved.senderName.trim().replace(/\s+/g, " ");
        if (mailChanged) {
          await api("/api/organization/notifications", {
            method: "PATCH",
            body: JSON.stringify({
              shipped: next.shipped,
              outForDelivery: next.outForDelivery,
              delivered: next.delivered,
              deliveryException: next.deliveryException,
              returnLabel: next.returnLabel,
              replyTo: next.replyTo || null,
              senderName: next.senderName || null,
            }),
          });
        }
        return next;
      },
      "Automation published.",
    );
    if (result) {
      setSaved(result);
      setDraft(result);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {FLOW_STEPS.map((item, itemIndex) => {
            const current = itemIndex === index;
            return (
              <li key={item.id} className="flex items-center gap-1">
                {itemIndex > 0 ? <span className="mx-1 hidden h-px w-5 bg-border sm:block" /> : null}
                <button
                  type="button"
                  onClick={() => go(itemIndex)}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-2 py-1 text-sm whitespace-nowrap",
                    current ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full text-[11px] font-semibold",
                      current ? "bg-background text-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    {String(itemIndex + 1).padStart(2, "0")}
                  </span>
                  {item.label}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={index === 0} onClick={() => go(index - 1)}>
            <ArrowLeft />
            Back
          </Button>
          <Button variant="forward" size="sm" disabled={index === FLOW_STEPS.length - 1} onClick={() => go(index + 1)}>
            Next step
            <ArrowRight />
          </Button>
          <Button size="sm" disabled={!dirty || write.busy} onClick={() => void publish()}>
            {dirty ? "Publish" : "Published"}
          </Button>
        </div>
      </div>

      {view.error ? (
        <p className="p-4 text-sm text-destructive">{view.error.message}</p>
      ) : !draft || !saved ? (
        <p className="p-4 text-sm text-muted-foreground">Opening the automation map…</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 min-w-0 flex-1">
            {step === "review" ? (
              <Review draft={draft} />
            ) : (
              <FlowCanvas
                step={step}
                saved={saved}
                draft={draft}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id || null)}
              />
            )}
          </div>
          <aside className="max-h-[46%] shrink-0 overflow-auto border-t lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l">
            <Inspector draft={draft} selectedId={step === "review" ? null : selectedId} counts={counts} onChange={setDraft} />
            {write.error ? <p className="px-4 pb-4 text-sm text-destructive">{write.error}</p> : null}
          </aside>
        </div>
      )}
    </div>
  );
}

function Review({ draft }: { draft: AutomationDraft }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3 overflow-auto p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-muted-foreground">
          Publish writes replenishment, alerts, and customer email together. Until then, these choices stay on this map.
        </p>
      </div>
      {reviewLines(draft).map((line) => (
        <article key={line.title} className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
          <h2 className="text-sm font-semibold">{line.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{line.body}</p>
        </article>
      ))}
    </div>
  );
}

export type { FlowStepId };
