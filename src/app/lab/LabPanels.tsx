import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Box,
  CircleAlert,
  CloudOff,
  Eye,
  EyeOff,
  FileUp,
  Loader2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  BACKDROPS,
  FINISHES,
  FINISH_GROUPS,
  LENSES,
  RENDER_ASPECTS,
  RENDER_LONG_EDGES,
  RENDER_QUALITIES,
  STUDIO_PRESETS,
  finishById,
  linearRgbToHex,
  modelSeries,
  type LabModel,
} from "@/domain/cad-lab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { CameraView, ToneMappingId, ViewerLook } from "./CadViewer";
import type { LabPart } from "./model-loader";
import { BOUNCE_CHOICES, F_STOPS, type ModelSettings, type RenderSettings } from "./lab-state";

/* ------------------------------------------------------------------ library */

export type LibraryEntry = LabModel & { state: "saved" | "saving" | "local"; error?: string | null };

export type ConvertJob = {
  total: number;
  done: number;
  file: string | null;
  stage: string | null;
  skipped: { file: string; reason: string }[];
  /** Models already in the library that this batch replaced. */
  replaced: string[];
  running: boolean;
};

const STAGE_LABELS: Record<string, string> = {
  unzip: "Unzipping",
  read: "Reading",
  tessellate: "Tessellating",
  compress: "Compressing",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatSize(sizeMm: [number, number, number]): string {
  if (!sizeMm.some((v) => v > 0)) return "";
  return `${sizeMm.map((v) => Math.round(v)).join(" × ")} mm`;
}

export function LibraryPanel({
  entries,
  selected,
  job,
  loading,
  storageNote,
  onSelect,
  onFiles,
  onDelete,
  onRetry,
}: {
  entries: LibraryEntry[];
  selected: string | null;
  job: ConvertJob | null;
  loading: boolean;
  storageNote: string | null;
  onSelect: (slug: string) => void;
  onFiles: (files: File[]) => void;
  onDelete: (entry: LibraryEntry) => void;
  onRetry: (entry: LibraryEntry) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<LibraryEntry | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, LibraryEntry[]>();
    for (const entry of entries) {
      const series = modelSeries(entry.name);
      const label = series ? `${series} series` : "Other";
      map.set(label, [...(map.get(label) ?? []), entry]);
    }
    return [...map.entries()];
  }, [entries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b p-3">
        <input
          ref={input}
          type="file"
          multiple
          accept=".stp,.step,.glb,.zip"
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-4 text-center text-sm transition-colors hover:bg-primary/10"
        >
          <FileUp className="size-5 text-primary" />
          <span className="font-medium">Add CAD files</span>
          <span className="text-xs text-muted-foreground">STEP, GLB, or a zip of them. Drop anywhere.</span>
        </button>
        {job ? <ConvertStatus job={job} /> : null}
        {storageNote ? (
          <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
            <CloudOff className="mt-0.5 size-3.5 shrink-0" />
            {storageNote}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading && entries.length === 0 ? (
          <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Opening the library…
          </p>
        ) : entries.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">
            No models yet. Add the product line's STEP zip; it converts in this browser and saves to your organization's private library.
          </p>
        ) : (
          groups.map(([label, items]) => (
            <section key={label} className="mb-2">
              <h3 className="px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</h3>
              <ul className="grid gap-0.5">
                {items.map((entry) => (
                  <li key={entry.slug} className="group relative">
                    <button
                      type="button"
                      onClick={() => onSelect(entry.slug)}
                      aria-current={selected === entry.slug ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 pr-8 text-left text-sm",
                        selected === entry.slug ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                      )}
                    >
                      <Box className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{entry.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[formatSize(entry.sizeMm), entry.parts ? `${entry.parts} parts` : "", formatBytes(entry.bytes)].filter(Boolean).join(" · ")}
                        </span>
                        {entry.state === "saving" ? (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" /> Saving to the library…
                          </span>
                        ) : entry.state === "local" ? (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--tone-warning)]">
                            <CircleAlert className="size-3" /> Only in this tab{entry.error ? `: ${entry.error}` : ""}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {entry.state === "local" ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-1.5 right-1"
                        aria-label={`Save ${entry.name} to the library`}
                        onClick={() => onRetry(entry)}
                      >
                        <RotateCw />
                      </Button>
                    ) : entry.state === "saved" ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-1.5 right-1 opacity-60 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        aria-label={`Delete ${entry.name}`}
                        onClick={() => setConfirm(entry)}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <AlertDialog open={!!confirm} onOpenChange={(open) => (!open ? setConfirm(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It leaves your organization's lab library for everyone. Add the STEP again to bring it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) onDelete(confirm);
                setConfirm(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConvertStatus({ job }: { job: ConvertJob }) {
  return (
    <div className="mt-2 grid gap-1 rounded-lg bg-muted px-2.5 py-2 text-xs" aria-live="polite">
      {job.running ? (
        <p className="flex items-center gap-1.5 font-medium">
          <Loader2 className="size-3.5 animate-spin" />
          {job.total ? `${Math.min(job.done + 1, job.total)} of ${job.total}` : "Starting"}
          {job.stage ? ` · ${STAGE_LABELS[job.stage] ?? job.stage}` : ""}
        </p>
      ) : (
        <p className="font-medium">
          Converted {job.done} of {job.total}.
        </p>
      )}
      {job.file && job.running ? <p className="truncate text-muted-foreground">{job.file.split("/").pop()}</p> : null}
      {job.replaced.length ? <p className="text-muted-foreground">Replaced {job.replaced.join(", ")}.</p> : null}
      {job.skipped.map((skip) => (
        <p key={skip.file} className="text-[var(--tone-warning)]">
          Skipped {skip.file.split("/").pop()}: {skip.reason}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ inspector pieces */

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="grid gap-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--primary)]"
      />
    </label>
  );
}

function FinishSelect({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FINISH_GROUPS.map((group) => (
          <SelectGroup key={group}>
            <SelectLabel>{group}</SelectLabel>
            {FINISHES.filter((finish) => finish.group === group).map((finish) => (
              <SelectItem key={finish.id} value={finish.id}>
                {finish.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function swatchFor(finishId: string, tint: string | undefined, part: LabPart | undefined): string {
  if (tint) return tint;
  const finish = finishById(finishId);
  if (finish.color !== "cad") return finish.color;
  return linearRgbToHex(part?.cadColor ?? [0.52, 0.52, 0.52]);
}

/* ------------------------------------------------------------------ look */

export function LookPanel({ look, onChange }: { look: ViewerLook; onChange: (next: ViewerLook) => void }) {
  const set = <K extends keyof ViewerLook>(key: K, value: ViewerLook[K]) => onChange({ ...look, [key]: value });
  return (
    <>
      <Section title="Studio">
        <div className="grid gap-1.5">
          {STUDIO_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => set("studio", preset.id)}
              aria-pressed={look.studio === preset.id}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                look.studio === preset.id ? "border-primary bg-accent" : "hover:bg-muted",
              )}
            >
              <span className="block font-medium">{preset.label}</span>
              <span className="block text-xs text-muted-foreground">{preset.hint}</span>
            </button>
          ))}
        </div>
        <Range label="Light" value={look.envIntensity} min={0.2} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set("envIntensity", v)} />
        <Range label="Turn the lights" value={look.envRotation} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => set("envRotation", v)} />
        <Range label="Exposure" value={look.exposure} min={-2} max={2} step={0.05} format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`} onChange={(v) => set("exposure", v)} />
        <label className="grid gap-1 text-sm">
          <span>Tone</span>
          <Select value={look.toneMapping} onValueChange={(v) => set("toneMapping", v as ToneMappingId)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="neutral">True color (Khronos Neutral)</SelectItem>
              <SelectItem value="agx">Filmic (AgX)</SelectItem>
              <SelectItem value="aces">Punchy (ACES)</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </Section>
      <Section title="Backdrop">
        <div className="grid grid-cols-2 gap-1.5">
          {BACKDROPS.map((backdrop) => (
            <button
              key={backdrop.id}
              type="button"
              onClick={() => set("backdrop", backdrop.id)}
              aria-pressed={look.backdrop === backdrop.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs",
                look.backdrop === backdrop.id ? "border-primary bg-accent" : "hover:bg-muted",
              )}
            >
              <span
                className="size-4 shrink-0 rounded-full border"
                style={
                  backdrop.color
                    ? { background: backdrop.color }
                    : backdrop.background === "studio"
                      ? { background: "linear-gradient(180deg, #3a3b40, #0d0e10)" }
                      : { background: "repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 50% / 8px 8px" }
                }
              />
              {backdrop.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <Label htmlFor="lab-glossy">Glossy floor</Label>
          <Switch id="lab-glossy" checked={look.glossyFloor} onCheckedChange={(v) => set("glossyFloor", v)} />
        </div>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ finishes */

export function FinishesPanel({
  parts,
  settings,
  selected,
  onSelect,
  onChange,
}: {
  parts: LabPart[];
  settings: ModelSettings;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: (settings: ModelSettings) => ModelSettings) => void;
}) {
  const finishOf = (part: LabPart) => settings.assign[part.id] ?? part.defaultFinish;
  const groups = useMemo(() => {
    const map = new Map<string, LabPart[]>();
    for (const part of parts) map.set(finishOf(part), [...(map.get(finishOf(part)) ?? []), part]);
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [parts, settings.assign]);
  const part = parts.find((p) => p.id === selected) ?? null;
  const hidden = new Set(settings.hidden);

  const assignAll = (members: LabPart[], finishId: string) =>
    onChange((s) => ({ ...s, assign: { ...s.assign, ...Object.fromEntries(members.map((m) => [m.id, finishId])) } }));

  return (
    <>
      {part ? (
        <Section
          title="Selected part"
          action={
            <Button variant="ghost" size="xs" onClick={() => onSelect(null)}>
              Clear
            </Button>
          }
        >
          <div>
            <p className="text-sm font-medium">{part.label.primary}</p>
            {part.label.secondary ? <p className="text-xs text-muted-foreground">{part.label.secondary}</p> : null}
            <p className="text-xs text-muted-foreground">{part.triangles.toLocaleString()} triangles</p>
          </div>
          <FinishSelect label="Finish for this part" value={finishOf(part)} onChange={(id) => assignAll([part], id)} />
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange((s) => ({
                  ...s,
                  hidden: hidden.has(part.id) ? s.hidden.filter((id) => id !== part.id) : [...s.hidden, part.id],
                }))
              }
            >
              {hidden.has(part.id) ? <Eye /> : <EyeOff />}
              {hidden.has(part.id) ? "Show" : "Hide"}
            </Button>
            {settings.assign[part.id] ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange((s) => {
                    const assign = { ...s.assign };
                    delete assign[part.id];
                    return { ...s, assign };
                  })
                }
              >
                <Undo2 />
                Default finish
              </Button>
            ) : null}
          </div>
        </Section>
      ) : null}
      <Section
        title="Finishes in this model"
        action={
          Object.keys(settings.assign).length || Object.keys(settings.tints).length ? (
            <Button variant="ghost" size="xs" onClick={() => onChange((s) => ({ ...s, assign: {}, tints: {} }))}>
              <RotateCcw />
              Reset
            </Button>
          ) : null
        }
      >
        <p className="text-xs text-muted-foreground">Click a part in the viewer to change just that part.</p>
        <ul className="grid gap-2">
          {groups.map(([finishId, members]) => {
            const finish = finishById(finishId);
            return (
              <li key={finishId} className="grid gap-1.5 rounded-lg border p-2">
                <div className="flex items-center gap-2">
                  <span className="size-5 shrink-0 rounded-full border" style={{ background: swatchFor(finishId, settings.tints[finishId], members[0]) }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{finish.label}</span>
                  <Badge variant="secondary">{members.length}</Badge>
                </div>
                <FinishSelect label={`Change ${finish.label}`} value={finishId} onChange={(id) => assignAll(members, id)} />
                {finish.tintable ? (
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Color</span>
                    <span className="flex items-center gap-1.5">
                      {settings.tints[finishId] ? (
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() =>
                            onChange((s) => {
                              const tints = { ...s.tints };
                              delete tints[finishId];
                              return { ...s, tints };
                            })
                          }
                        >
                          Reset
                        </button>
                      ) : null}
                      <input
                        type="color"
                        aria-label={`${finish.label} color`}
                        value={swatchFor(finishId, settings.tints[finishId], members[0])}
                        onChange={(event) => {
                          const color = event.target.value;
                          onChange((s) => ({ ...s, tints: { ...s.tints, [finishId]: color } }));
                        }}
                        className="h-6 w-9 cursor-pointer rounded border bg-transparent p-0"
                      />
                    </span>
                  </div>
                ) : null}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground select-none">Parts</summary>
                  <ul className="mt-1 grid max-h-40 gap-0.5 overflow-auto">
                    {members.map((member) => (
                      <li key={member.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(member.id)}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-muted",
                            selected === member.id && "bg-accent",
                            hidden.has(member.id) && "text-muted-foreground line-through",
                          )}
                          title={member.label.secondary ?? undefined}
                        >
                          <span className="truncate">{member.label.primary}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
        {settings.hidden.length ? (
          <Button variant="outline" size="sm" onClick={() => onChange((s) => ({ ...s, hidden: [] }))}>
            <Eye />
            Show {settings.hidden.length} hidden {settings.hidden.length === 1 ? "part" : "parts"}
          </Button>
        ) : null}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ camera */

export function CameraPanel({
  look,
  settings,
  onLook,
  onSettings,
  onView,
}: {
  look: ViewerLook;
  settings: ModelSettings;
  onLook: (next: ViewerLook) => void;
  onSettings: (next: (settings: ModelSettings) => ModelSettings) => void;
  onView: (view: CameraView) => void;
}) {
  const turn = (axis: "turn" | "tip" | "roll") =>
    onSettings((s) => ({ ...s, orientation: { ...s.orientation, [axis]: (s.orientation[axis] + 1) % 4 } }));
  const o = settings.orientation;
  return (
    <>
      <Section title="View">
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              ["three-quarter", "¾"],
              ["front", "Front"],
              ["side", "Side"],
              ["top", "Top"],
            ] as [CameraView, string][]
          ).map(([view, label]) => (
            <Button key={view} variant="outline" size="sm" onClick={() => onView(view)} aria-label={view === "three-quarter" ? "Three-quarter view" : `${label} view`}>
              {label}
            </Button>
          ))}
        </div>
      </Section>
      <Section title="Lens">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(look.lens)}
          onValueChange={(value) => value && onLook({ ...look, lens: Number(value) })}
          className="w-full"
        >
          {LENSES.map((mm) => (
            <ToggleGroupItem key={mm} value={String(mm)} className="flex-1 text-xs">
              {mm} mm
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center justify-between gap-2 text-sm">
          <Label htmlFor="lab-dof">Depth of field (photo mode)</Label>
          <Switch id="lab-dof" checked={look.dof} onCheckedChange={(v) => onLook({ ...look, dof: v })} />
        </div>
        {look.dof ? (
          <label className="grid gap-1 text-sm">
            <span>Aperture</span>
            <Select value={String(look.fStop)} onValueChange={(v) => onLook({ ...look, fStop: Number(v) })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {F_STOPS.map((stop) => (
                  <SelectItem key={stop} value={String(stop)}>
                    f/{stop}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Focus follows the orbit target, the middle of the product.</span>
          </label>
        ) : null}
      </Section>
      <Section
        title="Orientation"
        action={
          o.turn || o.tip || o.roll ? (
            <Button variant="ghost" size="xs" onClick={() => onSettings((s) => ({ ...s, orientation: { turn: 0, tip: 0, roll: 0 } }))}>
              <RotateCcw />
              Reset
            </Button>
          ) : null
        }
      >
        <p className="text-xs text-muted-foreground">CAD exports are not always upright. Turn the model until it sits on its feet.</p>
        <div className="grid grid-cols-3 gap-1.5">
          <Button variant="outline" size="sm" onClick={() => turn("turn")}>
            Turn {o.turn * 90}°
          </Button>
          <Button variant="outline" size="sm" onClick={() => turn("tip")}>
            Tip {o.tip * 90}°
          </Button>
          <Button variant="outline" size="sm" onClick={() => turn("roll")}>
            Roll {o.roll * 90}°
          </Button>
        </div>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ render */

const BOUNCE_HINTS: Record<(typeof BOUNCE_CHOICES)[number], string> = {
  4: "faster",
  8: "metal and plastic",
  14: "glass and acrylic",
};

export function RenderPanel({
  settings,
  dimensions,
  disabled,
  onChange,
  onRender,
}: {
  settings: RenderSettings;
  dimensions: { width: number; height: number };
  disabled: boolean;
  onChange: (next: RenderSettings) => void;
  onRender: () => void;
}) {
  const quality = RENDER_QUALITIES.find((q) => q.id === settings.quality) ?? RENDER_QUALITIES[1];
  return (
    <Section title="Photo render">
      <p className="text-xs text-muted-foreground">
        A path-traced still: light bounces, soft shadows, and reflections computed per pixel on this computer's GPU. The shaded frame in the viewer is what the PNG shows.
      </p>
      <label className="grid gap-1 text-sm">
        <span>Frame</span>
        <Select value={settings.aspect} onValueChange={(v) => onChange({ ...settings, aspect: v })}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RENDER_ASPECTS.map((aspect) => (
              <SelectItem key={aspect.id} value={aspect.id}>
                {aspect.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="grid gap-1 text-sm">
        <span>Long edge</span>
        <Select value={String(settings.longEdge)} onValueChange={(v) => onChange({ ...settings, longEdge: Number(v) })}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RENDER_LONG_EDGES.map((edge) => (
              <SelectItem key={edge} value={String(edge)}>
                {edge} px{edge === 3840 ? " (4K)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="grid gap-1 text-sm">
        <span>Quality</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={settings.quality}
          onValueChange={(v) => v && onChange({ ...settings, quality: v })}
          className="w-full"
        >
          {RENDER_QUALITIES.map((q) => (
            <ToggleGroupItem key={q.id} value={q.id} className="flex-1 text-xs">
              {q.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <label className="grid gap-1 text-sm">
        <span>Light bounces</span>
        <Select value={String(settings.bounces)} onValueChange={(v) => onChange({ ...settings, bounces: Number(v) })}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOUNCE_CHOICES.map((bounces) => (
              <SelectItem key={bounces} value={String(bounces)}>
                {bounces} · {BOUNCE_HINTS[bounces]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="flex items-center justify-between gap-2 text-sm">
        <Label htmlFor="lab-denoise">Smooth leftover grain</Label>
        <Switch id="lab-denoise" checked={settings.denoise} onCheckedChange={(v) => onChange({ ...settings, denoise: v })} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {dimensions.width} × {dimensions.height} px · {quality.samples} samples per pixel
      </p>
      <Button disabled={disabled} onClick={onRender}>
        Render photo
      </Button>
    </Section>
  );
}
