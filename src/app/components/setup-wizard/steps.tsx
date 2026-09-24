import { useId, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button, Field, Input } from "@/app/components/ui";
import { Term } from "@/app/components/term";
import { hierarchyLevel, type HierarchyLevelId } from "@/domain/hierarchy";
import { GARAGE_MODE_LABEL, MANUFACTURER_MODE_LABEL } from "@/domain/operating-mode";
import {
  SETUP_LIMITS,
  normalizeCode,
  type ExistingBin,
  type SetupAreaInput,
  type SetupInput,
  type SetupIssue,
  type SetupRacksInput,
  type SetupSource,
} from "@/domain/setup-wizard";
import { cn } from "@/lib/utils";
import { BinCodeBreakdown } from "@/app/components/tour/diagrams";

/* ------------------------------------------------------------------ shared bits */

/** The hierarchy levels a step teaches, with the copy from `hierarchyLevel`. */
export function LevelLesson({ ids, intro, className }: { ids: HierarchyLevelId[]; intro?: ReactNode; className?: string }) {
  const levels = ids.map(hierarchyLevel);
  return (
    <section aria-label="What this step teaches" className={cn("space-y-3 rounded-lg border bg-muted/40 p-3", className)}>
      {intro ? <p className="text-sm leading-relaxed">{intro}</p> : null}
      {levels.length ? (
        <dl className={cn("grid gap-x-4 gap-y-3", levels.length > 2 && "sm:grid-cols-2")}>
          {levels.map((level) => (
            <div key={level.id} className="min-w-0">
              <dt className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{level.title}</span>
                <code className="font-mono text-xs text-muted-foreground">{level.example}</code>
              </dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">
                {level.short} {level.long}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function issuesFor(issues: SetupIssue[], field: string): SetupIssue[] {
  return issues.filter((issue) => issue.field === field);
}

/** Inline problems for one field (or, with no field, the step's loose ones). */
export function IssueText({ issues, field, id }: { issues: SetupIssue[]; field?: string; id?: string }) {
  const rows = field ? issuesFor(issues, field) : issues.filter((issue) => !issue.field);
  if (!rows.length) return null;
  return (
    <p id={id} className="mt-1 text-xs text-tone-danger">
      {rows.map((issue) => issue.message).join(" ")}
    </p>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-start gap-3 py-1">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
      <div className="min-w-0">
        <label htmlFor={id} className={cn("block text-sm font-medium", disabled && "text-muted-foreground")}>
          {label}
        </label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

function CodeInput({
  value,
  onChange,
  invalid,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  placeholder?: string;
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => onChange(normalizeCode(value))}
      placeholder={placeholder}
      className="font-mono uppercase"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      maxLength={24}
      aria-invalid={invalid || undefined}
    />
  );
}

/** Bays of one kind that already exist, as code · name chips. */
function ExistingChips({ rows, title }: { rows: ExistingBin[]; title: string }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={title}>
        {rows.map((row) => (
          <li key={row.id} className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs">
            <code className="font-mono">{row.code}</code>
            {row.name && row.name !== row.code ? <span className="text-muted-foreground">· {row.name}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Switch this step on to add another.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ building */

export function BuildingStep({
  value,
  onChange,
  issues,
  garage,
  suggestedZone,
}: {
  value: SetupInput["building"];
  onChange: (next: SetupInput["building"]) => void;
  issues: SetupIssue[];
  garage: boolean;
  /** The timezone came from this browser because the building was still on UTC. */
  suggestedZone: boolean;
}) {
  return (
    <div className="space-y-4">
      <LevelLesson
        ids={["warehouse"]}
        intro={
          <>
            Name the building and set its clock. Every bin belongs to one building, and{" "}
            <Term id="on-hand">on hand</Term> is counted per building, so a second site never mixes its stock with this
            one.
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
        <div>
          <Field label="Building name">
            <Input
              value={value.name}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              placeholder="Main warehouse"
              autoComplete="organization"
              aria-invalid={issuesFor(issues, "name").length > 0 || undefined}
            />
          </Field>
          <IssueText issues={issues} field="name" />
        </div>
        <div>
          <Field label="Timezone">
            <Input
              value={value.timeZone}
              onChange={(event) => onChange({ ...value, timeZone: event.target.value })}
              onBlur={() => onChange({ ...value, timeZone: value.timeZone.trim() })}
              placeholder="America/Los_Angeles"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={issuesFor(issues, "timeZone").length > 0 || undefined}
            />
          </Field>
          <IssueText issues={issues} field="timeZone" />
          <p className="mt-1 text-xs text-muted-foreground">
            An IANA name like America/Los_Angeles. The day on Live starts at local midnight.
            {suggestedZone ? " Suggested from this browser because the building was on UTC." : ""}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {garage
          ? `${GARAGE_MODE_LABEL} has one building. ${MANUFACTURER_MODE_LABEL} can add more under Settings → Warehouse.`
          : "Need another building? Add it under Settings → Warehouse."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ dock, bench, outbound */

type AreaSource = Exclude<SetupSource, "rack">;

const AREA_COPY: Record<
  AreaSource,
  { type: string; switchLabel: string; existingTitle: string; codePlaceholder: string; namePlaceholder: string; intro: () => ReactNode }
> = {
  dock: {
    type: "receiving",
    switchLabel: "Add a dock",
    existingTitle: "You already have a dock",
    codePlaceholder: "DOCK",
    namePlaceholder: "Receiving dock",
    intro: () => (
      <>
        Boxes land on the <Term id="dock">dock</Term> first. A <Term id="receipt">receipt</Term> posts them there, then{" "}
        <Term id="putaway">putaway</Term> moves them to the shelves. The dock is an area with one bin in it.
      </>
    ),
  },
  bench: {
    type: "production",
    switchLabel: "Add a bench",
    existingTitle: "You already have a bench",
    codePlaceholder: "BENCH",
    namePlaceholder: "Assembly bench",
    intro: () => (
      <>
        <Term id="work-order">Builds</Term> and <Term id="kit">kits</Term> consume parts from one bay and produce the
        finished item into another. The bench is where that happens, so the <Term id="ledger">ledger</Term> shows parts
        leaving and the product arriving.
      </>
    ),
  },
  ship: {
    type: "shipping",
    switchLabel: "Add an outbound bay",
    existingTitle: "You already have an outbound bay",
    codePlaceholder: "SHIP",
    namePlaceholder: "Shipping bay",
    intro: () => (
      <>
        Packed <Term id="carton">cartons</Term> wait here for the carrier. Shipping posts from this bay, so it is the last
        place stock is seen before it leaves.
      </>
    ),
  },
};

export function AreaStep({
  source,
  value,
  onChange,
  issues,
  existing,
}: {
  source: AreaSource;
  value: SetupAreaInput;
  onChange: (next: SetupAreaInput) => void;
  issues: SetupIssue[];
  existing: ExistingBin[];
}) {
  const copy = AREA_COPY[source];
  const already = existing.filter((row) => row.type === copy.type);
  return (
    <div className="space-y-4">
      <LevelLesson ids={["area", "bin"]} intro={copy.intro()} />
      <ExistingChips rows={already} title={copy.existingTitle} />
      <SwitchRow
        label={copy.switchLabel}
        hint={already.length ? "Off, because one exists. Turn it on for a second one." : "Turn it off to leave this for later."}
        checked={value.include}
        onCheckedChange={(include) => onChange({ ...value, include })}
      />
      {value.include ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <div>
            <Field label="Code">
              <CodeInput
                value={value.code}
                onChange={(code) => onChange({ ...value, code })}
                invalid={issuesFor(issues, "code").length > 0}
                placeholder={copy.codePlaceholder}
              />
            </Field>
            <IssueText issues={issues} field="code" />
            <p className="mt-1 text-xs text-muted-foreground">Becomes the barcode on the bay.</p>
          </div>
          <div>
            <Field label="Name">
              <Input
                value={value.name}
                onChange={(event) => onChange({ ...value, name: event.target.value })}
                placeholder={copy.namePlaceholder}
              />
            </Field>
            <p className="mt-1 text-xs text-muted-foreground">Shown on the map and in pick lists.</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Skipped. You can add one later under Stock → Locations.</p>
      )}
      <IssueText issues={issues} />
    </div>
  );
}

/* ------------------------------------------------------------------ racks */

const SHOWN_CODES = 6;

function NumberInput({
  value,
  onChange,
  min,
  max,
  invalid,
}: {
  value: number | string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  invalid: boolean;
}) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
      className="tabular-nums"
      aria-invalid={invalid || undefined}
    />
  );
}

export function RacksStep({
  value,
  onChange,
  issues,
  existing,
  codes,
}: {
  value: SetupRacksInput;
  onChange: (next: SetupRacksInput) => void;
  issues: SetupIssue[];
  existing: ExistingBin[];
  /** From `previewRackCodes`: every bin the step would mint, in order. */
  codes: string[];
}) {
  const levels = Number(String(value.levels).trim());
  const singleLevel = !Number.isInteger(levels) || levels <= 1;
  const already = existing.filter((row) => row.type === "storage");
  const lastCode = codes[codes.length - 1];
  return (
    <div className="space-y-4">
      <LevelLesson
        ids={["aisle", "rack", "bay", "level"]}
        intro={
          <>
            Shelves get an address you read left to right: aisle, rack, bay, level. Level 1 is the{" "}
            <Term id="pick-face">pick face</Term> pickers take from; the levels above are{" "}
            <Term id="bulk-bay">bulk bays</Term> that <Term id="replenish">refill</Term> it.
          </>
        }
      />
      {already.length ? (
        <div className="rounded-lg border border-dashed p-3 text-sm">
          <p className="font-medium">You already have shelves</p>
          <p className="text-muted-foreground">
            {already.length} storage {already.length === 1 ? "bin" : "bins"} so far. New racks take the next free number
            in the aisle you pick.
          </p>
        </div>
      ) : null}
      <SwitchRow
        label="Add shelves"
        hint="One aisle of racks, all the same size. Build floor can add more later."
        checked={value.include}
        onCheckedChange={(include) => onChange({ ...value, include })}
      />
      {value.include ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:items-start">
            <div>
              <Field label="Aisle">
                <Input
                  value={value.aisle}
                  onChange={(event) => onChange({ ...value, aisle: event.target.value })}
                  onBlur={() => onChange({ ...value, aisle: normalizeCode(value.aisle) })}
                  placeholder="A"
                  maxLength={3}
                  className="font-mono uppercase"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={issuesFor(issues, "aisle").length > 0 || undefined}
                />
              </Field>
              <p className="mt-1 text-xs text-muted-foreground">1 to 3 letters</p>
            </div>
            <div>
              <Field label="Racks">
                <NumberInput
                  value={value.racks}
                  onChange={(racks) => onChange({ ...value, racks })}
                  min={SETUP_LIMITS.racks.min}
                  max={SETUP_LIMITS.racks.max}
                  invalid={issuesFor(issues, "racks").length > 0}
                />
              </Field>
              <p className="mt-1 text-xs text-muted-foreground">
                {SETUP_LIMITS.racks.min} to {SETUP_LIMITS.racks.max}
              </p>
            </div>
            <div>
              <Field label="Bays per rack">
                <NumberInput
                  value={value.bays}
                  onChange={(bays) => onChange({ ...value, bays })}
                  min={SETUP_LIMITS.bays.min}
                  max={SETUP_LIMITS.bays.max}
                  invalid={issuesFor(issues, "bays").length > 0}
                />
              </Field>
              <p className="mt-1 text-xs text-muted-foreground">
                {SETUP_LIMITS.bays.min} to {SETUP_LIMITS.bays.max}
              </p>
            </div>
            <div>
              <Field label="Levels">
                <NumberInput
                  value={value.levels}
                  onChange={(next) => onChange({ ...value, levels: next })}
                  min={SETUP_LIMITS.levels.min}
                  max={SETUP_LIMITS.levels.max}
                  invalid={issuesFor(issues, "levels").length > 0}
                />
              </Field>
              <p className="mt-1 text-xs text-muted-foreground">
                {SETUP_LIMITS.levels.min} to {SETUP_LIMITS.levels.max}
              </p>
            </div>
          </div>
          {["aisle", "racks", "bays", "levels"].map((field) => (
            <IssueText key={field} issues={issues} field={field} />
          ))}
          <SwitchRow
            label="Level 1 is the pick face, upper levels are bulk"
            hint={
              singleLevel
                ? "Needs two or more levels. With one level there is nothing above to refill from."
                : "Pickers take from the floor shelf; the shelves above hold the reserve that refills it."
            }
            checked={value.pickFaces && !singleLevel}
            disabled={singleLevel}
            onCheckedChange={(pickFaces) => onChange({ ...value, pickFaces })}
          />
          {codes.length ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">Bin codes this makes</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {codes.length} {codes.length === 1 ? "bin" : "bins"}
                </p>
              </div>
              <ul className="flex flex-wrap items-center gap-1.5" aria-label="Bin codes">
                {codes.slice(0, SHOWN_CODES).map((code) => (
                  <li key={code}>
                    <code className="inline-block rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">{code}</code>
                  </li>
                ))}
                {codes.length > SHOWN_CODES ? (
                  <li className="text-xs tabular-nums text-muted-foreground">… {codes.length} bins in all</li>
                ) : null}
              </ul>
              {lastCode ? (
                <div className="border-t pt-3">
                  <p className="mb-2 text-xs text-muted-foreground">How to read the last one</p>
                  <BinCodeBreakdown code={lastCode} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Skipped. Build floor on the map can add racks any time.</p>
      )}
      <IssueText issues={issues} />
    </div>
  );
}

/* ------------------------------------------------------------------ review */

export function ReviewIssues({ issues, onFix }: { issues: SetupIssue[]; onFix: (issue: SetupIssue) => void }) {
  if (!issues.length) return null;
  return (
    <div className="rounded-lg border border-destructive/25 bg-tone-danger-bg p-3">
      <p className="text-sm font-medium text-tone-danger">
        {issues.length === 1 ? "One thing to fix before creating" : `${issues.length} things to fix before creating`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {issues.map((issue, index) => (
          <li key={`${issue.step}:${issue.field ?? ""}:${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-tone-danger" />
            <span className="min-w-0 flex-1 basis-48 text-foreground">{issue.message}</span>
            <Button size="xs" variant="outline" onClick={() => onFix(issue)}>
              <Wrench className="size-3.5" />
              Fix
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
