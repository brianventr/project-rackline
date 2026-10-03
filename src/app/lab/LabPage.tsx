import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Aperture, Camera, FileUp, FlaskConical, Loader2, MousePointerClick, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ApiError, errorText } from "@/app/api";
import { useApiQuery } from "@/app/query";
import { useSession } from "@/app/session";
import {
  RENDER_ASPECTS,
  RENDER_QUALITIES,
  backdropById,
  cropVerticalFov,
  renderDimensions,
  renderFileName,
  slugifyModelName,
  sortLabModels,
  type LabModel,
} from "@/domain/cad-lab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CadViewer, TONE_MAPPINGS, type ViewerHandle } from "./CadViewer";
import { convertCadFiles } from "./convert-client";
import type { ConvertedModel } from "./convert-protocol";
import { CameraPanel, FinishesPanel, LibraryPanel, LookPanel, RenderPanel, type ConvertJob, type LibraryEntry } from "./LabPanels";
import { deleteLabModel, fetchLabGlb, forgetGlb, rememberGlb, saveLabModel } from "./lab-api";
import { forgetModelSettings, useModelSettings, useStoredLook, useStoredRender } from "./lab-state";
import { disposeModel, loadModel, type LoadedModel } from "./model-loader";
import { RenderDialog, type RenderJob } from "./RenderDialog";
import { LabBoundary } from "./LabBoundary";
import { renderStill } from "./render-still";

/** How far the viewer's photo mode converges before it stops drawing. */
const PHOTO_SAMPLES = 512;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The hidden lab: open the product line's CAD, dress it in real finishes, and path-trace a photo.
 * Reached from the mystery button in the top bar; it is not in the sidebar or the command palette.
 */
export function LabPage() {
  const me = useSession();
  if (!me.lab) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
        <p className="max-w-sm">The lab is not open to this organization. The shared demo login never gets it.</p>
      </div>
    );
  }
  return (
    <LabBoundary fallback={(message) => <p className="p-6 text-sm text-destructive">The lab stopped: {message} Reload the page to try again.</p>}>
      <LabStudio />
    </LabBoundary>
  );
}

function LabStudio() {
  const me = useSession();
  const [params, setParams] = useSearchParams();
  const library = useApiQuery<{ models: LabModel[] }>("/api/lab/cad", { retry: false, refetchOnWindowFocus: false });
  const [local, setLocal] = useState<Record<string, LibraryEntry>>({});
  const storageMissing = library.error instanceof ApiError && library.error.code === "MISSING_MEDIA";

  const entries = useMemo(() => {
    const map = new Map<string, LibraryEntry>();
    for (const model of library.data?.models ?? []) map.set(model.slug, { ...model, state: "saved" });
    for (const entry of Object.values(local)) if (entry.state !== "saved" || !map.has(entry.slug)) map.set(entry.slug, entry);
    return sortLabModels([...map.values()]);
  }, [library.data, local]);

  const wanted = params.get("model");
  const slug = wanted && entries.some((e) => e.slug === wanted) ? wanted : (entries[0]?.slug ?? null);
  const entry = entries.find((e) => e.slug === slug) ?? null;
  const select = useCallback(
    (next: string | null) => {
      const search = new URLSearchParams(params);
      if (next) search.set("model", next);
      else search.delete("model");
      setParams(search, { replace: true });
    },
    [params, setParams],
  );

  /* ---------------------------------------------------------------- the open model */

  const [loaded, setLoaded] = useState<{ slug: string; model: LoadedModel; version: number } | null>(null);
  const [opening, setOpening] = useState<{ slug: string; error: string | null } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!slug) {
      // The last model was deleted: let the viewer drop it (it frees the model once it has let go).
      setLoaded(null);
      setOpening(null);
      return;
    }
    if (loaded?.slug === slug && loaded.version === reload) return;
    let cancelled = false;
    setOpening({ slug, error: null });
    fetchLabGlb(slug)
      .then((glb) => loadModel(glb))
      .then((model) => {
        if (cancelled) {
          disposeModel(model);
          return;
        }
        setLoaded({ slug, model, version: reload });
        setOpening(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setOpening({ slug, error: errorText(err, "Could not open this model.") });
      });
    return () => {
      cancelled = true;
    };
    // `loaded` is read to skip reloading the open model, not to react to it. The viewer frees each
    // model once it has swapped it out, inside its own renderer's commit.
  }, [slug, reload]);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const mounted = useRef(true);
  useEffect(() => {
    // Set again on setup: StrictMode runs this effect's cleanup once before the real mount.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [settings, updateSettings] = useModelSettings(loaded?.slug ?? null);
  const [look, setLook] = useStoredLook();
  const [renderSettings, setRenderSettings] = useStoredRender();
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  useEffect(() => setSelectedPart(null), [loaded]);
  const [photo, setPhoto] = useState(false);
  const [samples, setSamples] = useState(0);
  const [tab, setTab] = useState("look");
  const viewer = useRef<ViewerHandle | null>(null);
  const onReady = useCallback((handle: ViewerHandle | null) => {
    viewer.current = handle;
  }, []);

  const viewerBox = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const [viewAspect, setViewAspect] = useState(16 / 9);
  useEffect(() => {
    const box = viewerBox.current;
    if (!box) return;
    const observer = new ResizeObserver(() => {
      if (box.clientHeight > 0) setViewAspect(box.clientWidth / box.clientHeight);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  /* ---------------------------------------------------------------- adding CAD */

  const [job, setJob] = useState<ConvertJob | null>(null);
  const [dragging, setDragging] = useState(false);

  const keep = useCallback(
    async (model: ConvertedModel, first: boolean) => {
      const replaced = entriesRef.current.find((e) => e.slug === model.slug && e.state === "saved");
      if (replaced) setJob((j) => j && { ...j, replaced: [...j.replaced, replaced.name] });
      rememberGlb(model.slug, model.glb);
      const pending: LibraryEntry = {
        slug: model.slug,
        ...model.stats,
        bytes: model.glb.byteLength,
        uploadedBy: me.user.email,
        uploadedAt: Date.now(),
        state: storageMissing ? "local" : "saving",
        error: storageMissing ? "the media bucket is not configured" : null,
      };
      setLocal((prev) => ({ ...prev, [model.slug]: pending }));
      // A batch outlives the page: once someone has left the lab, do not pull them back to it.
      if (first && mounted.current) select(model.slug);
      if (loadedRef.current?.slug === model.slug) setReload((n) => n + 1);
      if (storageMissing) return;
      try {
        const saved = await saveLabModel(model.slug, model.glb, model.stats);
        setLocal((prev) => ({ ...prev, [model.slug]: { ...saved, state: "saved" } }));
        void library.refetch();
      } catch (err) {
        setLocal((prev) => ({ ...prev, [model.slug]: { ...pending, state: "local", error: errorText(err, "not saved") } }));
      }
    },
    [me.user.email, storageMissing, select, library],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (job?.running) {
        toast("Still converting the last batch. Drop these again when it finishes.");
        return;
      }
      let firstModel = true;
      setJob({ total: 0, done: 0, file: null, stage: null, skipped: [], replaced: [], running: true });
      try {
        await convertCadFiles(files, (message) => {
          if (message.type === "queued") setJob((j) => j && { ...j, total: message.total });
          else if (message.type === "progress") setJob((j) => j && { ...j, file: message.file, stage: message.stage });
          else if (message.type === "skipped") setJob((j) => j && { ...j, skipped: [...j.skipped, { file: message.file, reason: message.reason }] });
          else if (message.type === "model") {
            setJob((j) => j && { ...j, done: j.done + 1 });
            void keep(message.model, firstModel);
            firstModel = false;
          }
        });
      } catch (err) {
        toast.error(errorText(err, "The converter stopped."));
      } finally {
        setJob((j) => j && { ...j, running: false, stage: null, file: null });
      }
    },
    [job?.running, keep],
  );

  async function retrySave(target: LibraryEntry) {
    setLocal((prev) => ({ ...prev, [target.slug]: { ...target, state: "saving", error: null } }));
    try {
      const glb = await fetchLabGlb(target.slug);
      const saved = await saveLabModel(target.slug, glb, {
        name: target.name,
        parts: target.parts,
        triangles: target.triangles,
        sizeMm: target.sizeMm,
        sourceName: target.sourceName,
        sourceBytes: target.sourceBytes,
      });
      setLocal((prev) => ({ ...prev, [target.slug]: { ...saved, state: "saved" } }));
      void library.refetch();
    } catch (err) {
      setLocal((prev) => ({ ...prev, [target.slug]: { ...target, state: "local", error: errorText(err, "not saved") } }));
    }
  }

  async function remove(target: LibraryEntry) {
    try {
      await deleteLabModel(target.slug);
      setLocal((prev) => {
        const next = { ...prev };
        delete next[target.slug];
        return next;
      });
      forgetGlb(target.slug);
      forgetModelSettings(target.slug);
      if (slug === target.slug) select(null);
      await library.refetch();
      toast.success(`Deleted ${target.name}.`);
    } catch (err) {
      toast.error(errorText(err, "Could not delete the model."));
    }
  }

  /* ---------------------------------------------------------------- photos */

  const [render, setRender] = useState<RenderJob | null>(null);
  const [still, setStill] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const renderUrl = useRef<string | null>(null);
  const revokeRender = () => {
    if (renderUrl.current) URL.revokeObjectURL(renderUrl.current);
    renderUrl.current = null;
  };
  const aspectRatio = RENDER_ASPECTS.find((a) => a.id === renderSettings.aspect)?.ratio ?? viewAspect;
  const dimensions = renderDimensions(aspectRatio, renderSettings.longEdge);
  const modelName = entry?.name ?? loaded?.slug ?? "model";

  useEffect(
    () => () => {
      abort.current?.abort();
      revokeRender();
    },
    [],
  );

  function closeRender() {
    revokeRender();
    setRender(null);
  }

  async function startRender() {
    const handle = viewer.current;
    if (!handle || !loaded || still) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const box = viewerBox.current;
    const liveAspect = box && box.clientHeight > 0 ? box.clientWidth / box.clientHeight : viewAspect;
    const ratio = RENDER_ASPECTS.find((a) => a.id === renderSettings.aspect)?.ratio ?? liveAspect;
    const { width, height } = renderDimensions(ratio, renderSettings.longEdge);
    const quality = RENDER_QUALITIES.find((q) => q.id === renderSettings.quality) ?? RENDER_QUALITIES[1];
    const canvas = document.createElement("canvas");
    revokeRender();
    setRender(() => {
      return {
        status: "preparing",
        width,
        height,
        samples: 0,
        target: quality.samples,
        elapsedMs: 0,
        canvas,
        url: null,
        fileName: renderFileName(modelName, look.studio, width, height),
        error: null,
      };
    });
    setStill(true);
    await nextFrame();
    await nextFrame();
    try {
      const blob = await renderStill({
        scene: handle.scene,
        camera: handle.camera,
        width,
        height,
        fov: cropVerticalFov(liveAspect, ratio, handle.camera.fov),
        samples: quality.samples,
        bounces: renderSettings.bounces,
        toneMapping: TONE_MAPPINGS[look.toneMapping],
        exposure: Math.pow(2, look.exposure),
        denoise: renderSettings.denoise,
        transparent: backdropById(look.backdrop).background === "transparent",
        canvas,
        signal: controller.signal,
        onProgress: (done, elapsedMs) => setRender((job) => job && { ...job, status: "rendering", samples: done, elapsedMs }),
      });
      // Stop pressed while the PNG was encoding still gets the finished picture; leaving the lab does not.
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      renderUrl.current = url;
      setRender((job) => job && { ...job, status: "done", url, canvas: null, samples: job.target });
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === "AbortError";
      setRender((job) => job && { ...job, status: cancelled ? "cancelled" : "failed", canvas: null, error: cancelled ? null : errorText(err, "The render failed.") });
    } finally {
      if (abort.current === controller) abort.current = null;
      setStill(false);
    }
  }

  function saveView() {
    const canvas = viewer.current?.canvas;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) download(blob, `${slugifyModelName(modelName)}-${photo ? "photo" : "view"}.png`);
    }, "image/png");
  }

  /* ---------------------------------------------------------------- layout */

  const opened = loaded && loaded.slug === slug ? loaded : null;
  const shownModel = loaded?.model ?? null;
  const storageNote = storageMissing
    ? "The media bucket is not configured here, so converted models stay in this tab only."
    : library.error && !storageMissing
      ? errorText(library.error, "Could not load the library.")
      : null;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-auto lg:overflow-hidden"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) void addFiles(files);
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-foreground text-background">
            <FlaskConical className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-sm font-semibold">
              The Lab
              <Badge variant="secondary" className="rounded-full text-[10px] tracking-wide uppercase">
                Hidden
              </Badge>
            </h1>
            <p className="truncate text-xs text-muted-foreground">CAD studio · open STEP files, dress them in real finishes, render a photo</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant={photo ? "default" : "outline"}
            size="sm"
            disabled={!opened || still}
            onClick={() => setPhoto((on) => !on)}
            aria-pressed={photo}
          >
            <Sparkles />
            Photo mode
            {photo ? <span className="tabular-nums opacity-80">{Math.min(samples, PHOTO_SAMPLES)}</span> : null}
          </Button>
          <Button variant="outline" size="sm" disabled={!opened || still} onClick={saveView}>
            <Camera />
            <span className="hidden sm:inline">Save view</span>
          </Button>
          <Button
            variant="forward"
            size="sm"
            disabled={!opened || still}
            onClick={() => {
              setTab("render");
              // Below lg the inspector sits under the viewer: bring the Render panel into view.
              if (!window.matchMedia("(min-width: 1024px)").matches) inspector.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <Aperture />
            Render
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex max-h-[40vh] min-h-0 shrink-0 flex-col border-y lg:max-h-none lg:w-72 lg:border-y-0 lg:border-r">
          <LibraryPanel
            entries={entries}
            selected={slug}
            job={job}
            loading={library.isLoading}
            storageNote={storageNote}
            onSelect={select}
            onFiles={(files) => void addFiles(files)}
            onDelete={(target) => void remove(target)}
            onRetry={(target) => void retrySave(target)}
          />
        </aside>

        {/* On a phone the viewer comes first; the library and the inspector stack under it. */}
        <div ref={viewerBox} className="relative order-first h-[58vh] min-h-0 min-w-0 shrink-0 lg:order-none lg:h-auto lg:flex-1 lg:shrink">
          <LabBoundary
            fallback={(message) => (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
                <p className="max-w-sm">The 3D viewer could not start ({message}). It needs WebGL 2; turn on hardware acceleration in the browser and reload.</p>
              </div>
            )}
          >
          <CadViewer
            model={shownModel}
            modelKey={loaded ? `${loaded.slug}#${loaded.version}` : ""}
            assign={settings.assign}
            tints={settings.tints}
            hidden={settings.hidden}
            look={look}
            orientation={settings.orientation}
            photo={photo && !!opened}
            still={still}
            paused={still}
            maxSamples={PHOTO_SAMPLES}
            selectedPart={selectedPart}
            crop={tab === "render" && opened ? aspectRatio : null}
            onSelectPart={(id) => {
              setSelectedPart(id);
              if (id) setTab("finishes");
            }}
            onSamples={setSamples}
            onReady={onReady}
          />
          </LabBoundary>
          {opened && entry ? (
            <div className="pointer-events-none absolute top-3 left-3 max-w-[70%] rounded-xl bg-background/85 px-3 py-2 shadow-sm backdrop-blur">
              <p className="truncate text-sm font-semibold">{entry.name}</p>
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                {[entry.sizeMm.some((v) => v > 0) ? `${entry.sizeMm.map((v) => Math.round(v)).join(" × ")} mm` : "", `${opened.model.parts.length} parts`, `${opened.model.triangles.toLocaleString()} triangles`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ) : null}
          {photo && opened ? (
            <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-foreground/85 px-3 py-1 text-xs text-background tabular-nums">
              {samples < PHOTO_SAMPLES ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              Path tracing · {Math.min(samples, PHOTO_SAMPLES)} / {PHOTO_SAMPLES}
            </div>
          ) : null}
          {opened && !photo ? (
            <p className="pointer-events-none absolute bottom-3 left-3 hidden items-center gap-1.5 rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur sm:flex">
              <MousePointerClick className="size-3.5" />
              Drag to orbit · scroll to zoom · right-drag to pan · click a part
            </p>
          ) : null}
          {opening && !opening.error && opening.slug === slug ? (
            <div className="absolute inset-0 grid place-items-center bg-background/40 backdrop-blur-[2px]">
              <p className="flex items-center gap-2 rounded-full bg-background px-4 py-2 text-sm shadow-sm">
                <Loader2 className="size-4 animate-spin" /> Opening {entry?.name ?? "the model"}…
              </p>
            </div>
          ) : null}
          {opening?.error && opening.slug === slug ? (
            <div className="absolute inset-0 grid place-items-center p-6">
              <p className="max-w-sm rounded-xl bg-background px-4 py-3 text-sm text-destructive shadow-sm">{opening.error}</p>
            </div>
          ) : null}
          {!slug && !library.isLoading ? (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="grid max-w-sm justify-items-center gap-2 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <FileUp className="size-6" />
                </span>
                <p className="text-base font-semibold">Drop the product line here</p>
                <p className="text-sm text-muted-foreground">
                  A zip of STEP files works. Each part is tessellated in this browser with OpenCascade, then saved to your organization's private lab library.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <aside ref={inspector} className="min-h-0 shrink-0 border-t lg:w-80 lg:overflow-auto lg:border-t-0 lg:border-l">
          <Tabs value={tab} onValueChange={setTab} className="gap-0">
            <div className="sticky top-0 z-10 border-b bg-background px-3 py-2">
              <TabsList className="w-full">
                <TabsTrigger value="look">Light</TabsTrigger>
                <TabsTrigger value="finishes">Finish</TabsTrigger>
                <TabsTrigger value="camera">Camera</TabsTrigger>
                <TabsTrigger value="render">Render</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="look">
              <LookPanel look={look} onChange={setLook} />
            </TabsContent>
            <TabsContent value="finishes">
              {opened ? (
                <FinishesPanel
                  parts={opened.model.parts}
                  settings={settings}
                  selected={selectedPart}
                  onSelect={setSelectedPart}
                  onChange={updateSettings}
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Open a model to set its finishes.</p>
              )}
            </TabsContent>
            <TabsContent value="camera">
              <CameraPanel look={look} settings={settings} onLook={setLook} onSettings={updateSettings} onView={(view) => viewer.current?.frame(view)} />
            </TabsContent>
            <TabsContent value="render">
              <RenderPanel
                settings={renderSettings}
                dimensions={dimensions}
                disabled={!opened || still}
                onChange={setRenderSettings}
                onRender={() => void startRender()}
              />
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px]">
          <p className={cn("rounded-full bg-background px-4 py-2 text-sm font-medium shadow")}>Drop STEP, GLB, or zip files to add them to the lab</p>
        </div>
      ) : null}

      <RenderDialog
        job={render}
        onCancel={() => abort.current?.abort()}
        onClose={closeRender}
        onAgain={() => void startRender()}
      />
    </div>
  );
}
