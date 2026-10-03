import { useCallback } from "react";
import { Download, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

export type RenderJob = {
  status: "preparing" | "rendering" | "done" | "failed" | "cancelled";
  width: number;
  height: number;
  samples: number;
  target: number;
  elapsedMs: number;
  /** The live canvas while it renders. */
  canvas: HTMLCanvasElement | null;
  url: string | null;
  fileName: string;
  error: string | null;
};

const STATUS_ANNOUNCEMENT: Record<RenderJob["status"], string> = {
  preparing: "Preparing the render.",
  rendering: "Rendering.",
  done: "Render finished. Download the PNG.",
  failed: "The render failed.",
  cancelled: "Render stopped.",
};

function seconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function RenderDialog({
  job,
  onCancel,
  onClose,
  onAgain,
}: {
  job: RenderJob | null;
  onCancel: () => void;
  onClose: () => void;
  onAgain: () => void;
}) {
  const canvas = job?.canvas ?? null;
  // A callback ref, not an effect: the dialog's portal mounts a commit after the dialog opens.
  const holder = useCallback(
    (box: HTMLDivElement | null) => {
      if (!box || !canvas) return;
      canvas.className = "block h-auto max-h-[62vh] w-auto max-w-full";
      if (canvas.parentElement !== box) box.replaceChildren(canvas);
    },
    [canvas],
  );

  const busy = job?.status === "preparing" || job?.status === "rendering";
  const remaining = job && job.samples > 0 ? (job.elapsedMs / job.samples) * (job.target - job.samples) : null;

  return (
    <Dialog open={!!job} onOpenChange={(open) => (!open ? (busy ? onCancel() : onClose()) : undefined)}>
      <DialogContent className="max-w-[min(96vw,1100px)] gap-3 sm:max-w-[min(96vw,1100px)]">
        <DialogHeader>
          <DialogTitle>Photo render</DialogTitle>
          <DialogDescription>
            {job ? `${job.width} × ${job.height} px, ${job.target} samples per pixel, path traced on this computer's GPU.` : null}
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid max-h-[62vh] min-h-48 place-items-center overflow-hidden rounded-xl border"
          style={{ backgroundColor: "#f4f4f5", backgroundImage: "linear-gradient(45deg, #e4e4e7 25%, transparent 25%), linear-gradient(-45deg, #e4e4e7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e4e4e7 75%), linear-gradient(-45deg, transparent 75%, #e4e4e7 75%)", backgroundSize: "20px 20px", backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0" }}
        >
          {job?.url ? (
            <img src={job.url} alt="Rendered product" className="block h-auto max-h-[62vh] w-auto max-w-full" />
          ) : (
            <div ref={holder} className="grid w-full place-items-center" />
          )}
        </div>
        {/* Screen readers hear the status change, not every sample count. */}
        <p className="sr-only" aria-live="polite">
          {job ? STATUS_ANNOUNCEMENT[job.status] : ""}
        </p>
        {job ? (
          <div className="grid gap-1.5">
            <Progress value={job.target ? (job.samples / job.target) * 100 : 0} />
            <p className="text-xs text-muted-foreground tabular-nums">
              {job.status === "preparing"
                ? "Building the scene for the path tracer…"
                : job.status === "rendering"
                  ? `${job.samples} of ${job.target} samples · ${seconds(job.elapsedMs)}${remaining != null ? ` · about ${seconds(remaining)} left` : ""}`
                  : job.status === "done"
                    ? `Done in ${seconds(job.elapsedMs)}.`
                    : job.status === "cancelled"
                      ? "Cancelled."
                      : job.error ?? "The render failed."}
            </p>
          </div>
        ) : null}
        <DialogFooter className="gap-2">
          {busy ? (
            <Button variant="outline" onClick={onCancel}>
              <X />
              Stop
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onAgain}>
                <RotateCcw />
                Render again
              </Button>
              {job?.url ? (
                <Button asChild>
                  <a href={job.url} download={job.fileName}>
                    <Download />
                    Download PNG
                  </a>
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
