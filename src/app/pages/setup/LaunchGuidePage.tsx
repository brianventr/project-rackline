import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, BookOpen, Building2, Check, ClipboardCheck, Download, Factory, Monitor, Package, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner, PageHeader } from "@/app/components/ui";
import { useOnboarding } from "@/app/onboarding";
import { useSession } from "@/app/session";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";
import { FULFILLMENT_LAUNCH_CHECKS, SETUP_REQUIREMENTS, WALKTHROUGHS, requirementTier, type LaunchProfile } from "@/domain/launch-guide";
import { cn } from "@/lib/utils";
import { LaunchCapacityPlanner } from "@/app/components/launch-guide/LaunchCapacityPlanner";

const PROFILES = [
  { id: "core", title: "Stock and ship", body: "A clear path from your first item to a shipped order.", icon: Package },
  { id: "manufacturing", title: "Make and assemble", body: "Add recipes, components, and production work.", icon: Factory },
  { id: "fulfillment", title: "Fulfillment partner", body: "Run customer stock, serialized orders, and a launch surge.", icon: Building2 },
] as const;

const TIERS = {
  essential: { label: "Essential", className: "bg-primary/10 text-primary" },
  conditional: { label: "When needed", className: "bg-tone-warning-bg text-tone-warning" },
  advanced: { label: "Power tool", className: "bg-muted text-muted-foreground" },
};

function loadProfile(key: string): LaunchProfile {
  try {
    const value = localStorage.getItem(key);
    if (value === "manufacturing" || value === "fulfillment") return value;
  } catch { /* The guide also works without local storage. */ }
  return "core";
}

function loadReviewed(key: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string" && FULFILLMENT_LAUNCH_CHECKS.some((row) => row.id === id)));
  } catch { /* A blocked or outdated preference starts with no acknowledgements. */ }
  return new Set();
}

function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Keep this session usable. */ }
}

export function LaunchGuidePage() {
  const me = useSession();
  return <LaunchGuide key={`${me.organization.id}:${me.user.id}`} />;
}

function LaunchGuide() {
  const me = useSession();
  const onboarding = useOnboarding();
  const garage = isGarageMode(me.organization.operatingMode);
  const profileKey = `rackline.launchProfile:${me.organization.id}`;
  const reviewKey = `rackline.launchReview:${me.organization.id}:${me.user.id}`;
  const [profile, setProfile] = useState<LaunchProfile>(() => loadProfile(profileKey));
  const [reviewed, setReviewed] = useState(() => loadReviewed(reviewKey));
  const [filter, setFilter] = useState("all");
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab = requestedTab === "walkthroughs" || requestedTab === "readiness" ? requestedTab : "plan";
  const walkthrough = WALKTHROUGHS.find((row) => row.id === params.get("guide")) ?? WALKTHROUGHS[0]!;
  const basic = onboarding.steps.filter((row) => !row.optional);
  const recorded = basic.filter((row) => row.done).length;
  const next = basic.find((row) => !row.done);
  const rows = SETUP_REQUIREMENTS.filter((row) => filter === "all" || requirementTier(row, profile) === filter);

  function selectTab(value: string) {
    setParams((previous) => {
      const result = new URLSearchParams(previous);
      result.set("tab", value);
      return result;
    }, { replace: true });
  }

  function openWalkthrough(id: string) {
    setParams({ tab: "walkthroughs", guide: id });
    document.querySelector('[data-slot="launch-guide"]')?.scrollIntoView({ block: "start" });
  }

  function review(id: string, checked: boolean) {
    setReviewed((previous) => {
      const result = new Set(previous);
      if (checked) result.add(id); else result.delete(id);
      savePreference(reviewKey, JSON.stringify([...result]));
      return result;
    });
  }

  function downloadChecklist() {
    const contents = [
      "# Rackline launch checklist", "", `Workflow: ${PROFILES.find((row) => row.id === profile)?.title}`, "",
      "## Setup priorities", "",
      ...SETUP_REQUIREMENTS.map((row) => `- [ ] ${row.title} (${TIERS[requirementTier(row, profile)].label}) — ${row.when}\n  ${row.why}`),
      "", "## Fulfillment acceptance review", "", "Assign an owner, evidence, and a target date to each requirement. A reviewed item is not a passed test.", "",
      ...FULFILLMENT_LAUNCH_CHECKS.map((row) => `- [ ] ${row.title}\n  Requirement: ${row.requirement}\n  Acceptance check: ${row.verify}${row.limitation ? `\n  Current limit: ${row.limitation}` : ""}\n  Owner: ______  Evidence: ______  Target date: ______`),
      "", "## Operating plan", "", "Orders expected: ______  Operating days: ______  Cartons per order: ______", "Measured orders per person per day: ______  Shift coverage: ______", "Receiving/unloading plan: ______  Returns SOP: ______", "Insurance approval: ______  Carrier account and pricing approval: ______", "Customer acceptance date and owner: ______", "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "rackline-launch-checklist.md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-5" data-slot="launch-guide">
      <PageHeader eyebrow="Launch guide" title="Get your warehouse ready" description="Set up the essentials, learn the work, and add power tools when they earn their place."
        actions={<Button asChild className="min-h-11"><Link to="/welcome">Start quick setup <ArrowRight className="size-4" /></Link></Button>} />

      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <Monitor aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold">Set up on a laptop or desktop</p>
          <p className="text-muted-foreground">Use the larger screen to add your team, plan buildings, and arrange racks and bays. Move to an iPad or scanner for daily floor work after a practice run.</p>
        </div>
      </div>

      <section aria-labelledby="launch-profile-heading" className="space-y-2">
        <h2 id="launch-profile-heading" className="text-sm font-semibold">What are you setting up?</h2>
        <div role="group" aria-label="Your workflow" className="grid gap-3 md:grid-cols-3">
          {PROFILES.map((item) => (
            <button key={item.id} type="button" aria-pressed={profile === item.id}
              onClick={() => { setProfile(item.id); savePreference(profileKey, item.id); }}
              className={cn("flex min-h-24 items-start gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50", profile === item.id && "border-primary bg-primary/5 ring-1 ring-primary/20")}>
              <item.icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", profile === item.id ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0"><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.body}</span></span>
              {profile === item.id ? <Check aria-hidden className="ml-auto size-4 shrink-0 text-primary" /> : null}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Your selection tailors the recommendations. You can change it at any time.</p>
      </section>

      {profile === "fulfillment" && garage ? (
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p className="font-medium">Plan fulfillment in the full warehouse workspace</p>
          <p className="mt-1 text-muted-foreground">Client stock, warehouse task controls, and full floor workflows use Manufacturer mode. Review the workflow and building license options in Warehouse settings.</p>
          <Link className="mt-2 inline-flex min-h-11 items-center gap-2 font-medium text-primary underline underline-offset-4" to="/setup/warehouse">Review Warehouse settings <ArrowRight className="size-4" /></Link>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={selectTab} className="gap-5">
        <TabsList className="h-auto min-h-12 w-full justify-start gap-1 sm:w-fit">
          <TabsTrigger value="plan" className="min-h-11 px-3"><ClipboardCheck className="hidden size-4 sm:inline" />Setup plan</TabsTrigger>
          <TabsTrigger value="walkthroughs" className="min-h-11 px-3"><BookOpen className="hidden size-4 sm:inline" />Walkthroughs</TabsTrigger>
          <TabsTrigger value="readiness" className="min-h-11 px-3">Launch review</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="space-y-5">
          <ErrorBanner error={onboarding.error?.message ?? null} />
          {onboarding.error ? <Button variant="outline" className="min-h-11" onClick={() => void onboarding.refetch()}>Retry progress check</Button> : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,1fr)]">
            <section aria-labelledby="basic-progress-heading" className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="basic-progress-heading" className="text-base font-semibold">Your basic stock-to-shipment loop</h2>
                <span className="text-sm tabular-nums text-muted-foreground">{onboarding.data ? `${recorded} of ${basic.length} recorded` : "Checking saved activity…"}</span>
              </div>
              <Progress value={basic.length ? recorded / basic.length * 100 : 0} className="mt-3 h-2" aria-label="Basic workflow activity" />
              <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                {basic.map((row) => (
                  <li key={row.id}><Link to={row.path} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs", row.done ? "border-primary/20 bg-primary/10 text-primary" : "text-muted-foreground")}>{row.done ? <Check className="size-3.5" /> : basic.indexOf(row) + 1}</span>
                    <span>{row.title}</span><span className="sr-only">{row.done ? ", activity recorded" : ", not yet recorded"}</span>
                  </Link></li>
                ))}
              </ol>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Progress reflects saved Rackline activity. Test the full workflow before live use; integration checks and operational launch approvals are separate.</p>
            </section>
            <section aria-labelledby="next-setup-heading" className="rounded-xl border bg-primary/5 p-5">
              <h2 id="next-setup-heading" className="text-base font-semibold">{!onboarding.data ? "Start with quick setup" : next ? "Your next useful step" : "Build confidence before launch"}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{!onboarding.data ? "Your saved activity is still being checked. You can open the wizard to plan your team and building while this loads." : next?.body ?? "Walk through a representative order, confirm labels and tracking, and review the launch checks with the people doing the work."}</p>
              <Button asChild className="mt-4 min-h-11"><Link to={!onboarding.data ? "/welcome" : next?.path ?? "/setup/start?tab=readiness"}>{!onboarding.data ? "Open quick setup" : next?.cta ?? "Review launch checks"}<ArrowRight className="size-4" /></Link></Button>
              <Link to="/setup/team" className="mt-2 flex min-h-11 items-center gap-2 text-sm font-medium text-primary"><Users className="size-4" />Add people and assign responsibilities</Link>
            </section>
          </div>

          <section aria-labelledby="setup-matrix-heading" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 id="setup-matrix-heading" className="text-lg font-semibold">What you need, and what can wait</h2><p className="mt-1 text-sm text-muted-foreground">Essentials support daily work. Conditional setup follows your business. Power tools add control as you grow.</p></div>
              <div role="group" aria-label="Filter setup priorities" className="flex flex-wrap gap-1">
                {[{ id: "all", label: "All" }, ...Object.entries(TIERS).map(([id, item]) => ({ id, label: item.label }))].map((item) => (
                  <Button key={item.id} variant={filter === item.id ? "secondary" : "ghost"} aria-pressed={filter === item.id} className="min-h-11" onClick={() => setFilter(item.id)}>{item.label}</Button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[760px] text-left text-sm" aria-label="Setup requirements matrix">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr><th className="w-[32%] p-4 font-medium">Setup item</th><th className="p-4 font-medium">Priority</th><th className="w-[29%] p-4 font-medium">When it matters</th><th className="p-4 font-medium">Next step</th></tr></thead>
                <tbody className="divide-y">
                  {rows.map((row) => {
                    const tier = requirementTier(row, profile);
                    const signal = row.signal && onboarding.steps.find((step) => step.id === row.signal);
                    return <tr key={row.id}>
                      <td className="p-4 align-top"><p className="font-medium">{row.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.why}</p>{signal?.done ? <p className="mt-2 flex items-center gap-1 text-xs text-primary"><Check className="size-3.5" />Activity recorded</p> : null}</td>
                      <td className="p-4 align-top"><span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", TIERS[tier].className)}>{TIERS[tier].label}</span></td>
                      <td className="p-4 align-top text-muted-foreground">{row.when}</td>
                      <td className="p-4 align-top"><GuideLink path={row.path} label={row.actionLabel} garage={garage} /><button type="button" onClick={() => openWalkthrough(row.walkthroughId)} className="mt-1 flex min-h-11 items-center text-xs font-medium text-primary underline underline-offset-4">Read walkthrough</button></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="walkthroughs">
          <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <nav aria-label="Walkthrough library" className="rounded-xl border bg-card p-2 lg:sticky lg:top-3">
              {WALKTHROUGHS.map((row) => <button key={row.id} type="button" aria-current={walkthrough.id === row.id ? "step" : undefined} onClick={() => openWalkthrough(row.id)} className={cn("flex min-h-12 w-full items-center gap-3 rounded-lg p-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50", walkthrough.id === row.id && "bg-primary/10 font-medium text-primary")}><BookOpen aria-hidden className="size-4 shrink-0" />{row.title}</button>)}
            </nav>
            <article className="min-w-0 rounded-xl border bg-card p-5 sm:p-7" aria-labelledby="walkthrough-heading">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Walkthrough · {walkthrough.steps.length} steps</p>
              <h2 id="walkthrough-heading" className="mt-2 text-2xl font-semibold tracking-tight">{walkthrough.title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{walkthrough.summary}</p>
              <ol className="mt-6 space-y-6">
                {walkthrough.steps.map((step, index) => <li key={step.title} className="flex gap-3 sm:gap-4"><span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{index + 1}</span><div className="min-w-0 flex-1"><h3 className="pt-1 text-base font-semibold">{step.title}</h3><p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{step.body}</p>{step.path ? <div className="mt-2"><GuideLink path={step.path} label={step.actionLabel ?? "Open this step"} garage={garage} /></div> : null}</div></li>)}
              </ol>
              <div className="mt-7 border-t pt-4"><Button variant="outline" className="min-h-11" onClick={() => selectTab("plan")}>Back to setup plan</Button></div>
            </article>
          </div>
        </TabsContent>

        <TabsContent value="readiness" className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-5">
            <div className="max-w-3xl"><h2 className="text-xl font-semibold">Fulfillment launch review</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Use this for container arrivals, store-connected fulfillment, serialized pack-out, and multi-box shipping. Review each requirement with a launch owner and collect evidence from a representative pilot.</p><p className="mt-2 text-xs text-muted-foreground">{reviewed.size} of {FULFILLMENT_LAUNCH_CHECKS.length} reviewed on this device. A review acknowledgement is separate from a passed test or an operational approval.</p></div>
            <Button variant="outline" className="min-h-11" onClick={downloadChecklist}><Download className="size-4" />Download checklist</Button>
          </div>
          <LaunchCapacityPlanner />
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {FULFILLMENT_LAUNCH_CHECKS.map((row) => <section key={row.id} className="min-w-0 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.scope}</span><span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", row.support === "partial" ? "bg-tone-warning-bg text-tone-warning" : "bg-muted text-muted-foreground")}>{row.support === "partial" ? "Gap to resolve" : row.support === "external" ? "Business sign-off" : "Available · test in pilot"}</span></div>
              <h3 className="mt-3 text-base font-semibold">{row.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{row.requirement}</p>
              {row.limitation ? <p className="mt-3 rounded-lg bg-tone-warning-bg p-3 text-sm leading-relaxed text-tone-warning"><strong>Current limit: </strong>{row.limitation}</p> : null}
              <div className="mt-3 border-l-2 border-primary/30 pl-3"><p className="text-xs font-semibold">Acceptance check</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{row.verify}</p></div>
              {row.path ? <div className="mt-2"><GuideLink path={row.path} label="Open relevant workspace" garage={garage} /></div> : null}
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 border-t pt-3 text-sm"><input type="checkbox" checked={reviewed.has(row.id)} onChange={(event) => review(row.id, event.target.checked)} className="size-4 accent-primary" />Reviewed with launch owner</label>
            </section>)}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GuideLink({ path, label, garage }: { path: string; label: string; garage: boolean }) {
  const available = !garage || garageAllowsPath(path);
  return <Link to={available ? path : "/setup/warehouse"} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-4">{available ? label : "Review full warehouse mode"}<ArrowRight aria-hidden className="size-3.5 shrink-0" /></Link>;
}
