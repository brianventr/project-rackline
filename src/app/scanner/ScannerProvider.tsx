import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { accumulateHidKey, type HidBufferState } from "@/domain/hid-buffer";
import {
  defaultScanPrefs,
  parseScanPrefs,
  scanResultTone,
  scanVibration,
  type ScanFeedbackPrefs,
} from "@/domain/floor-usage";
import { cn } from "@/lib/utils";
import { cameraFailureCopy, cameraFailureKind, cameraListed } from "./camera";
import { focusScanCapture } from "./scan-capture";

export type ScanSource = "hid" | "camera" | "typed";

export type ScanEvent = {
  raw: string;
  source: ScanSource;
  at: number;
};

/** `vibrate` and `flash` answer each scan result on top of the beep. All three default on. */
export type ScanPrefs = ScanFeedbackPrefs;

/** One accept/reject answer, published after a page checks a scan. */
export type ScanFeedback = {
  id: number;
  accepted: boolean;
  at: number;
};

type ScanHandler = (event: ScanEvent) => void;
type FeedbackHandler = (feedback: ScanFeedback) => void;

type ScannerContextValue = {
  lastScan: ScanEvent | null;
  emitScan: (raw: string, source: ScanSource) => void;
  /** Answer a scan: tone, buzz, and a screen flash, each per the prefs. */
  emitScanResult: (accepted: boolean) => void;
  /** Same as `emitScanResult(false)`. */
  emitScanError: () => void;
  subscribe: (handler: ScanHandler) => () => void;
  /** Listen for accept/reject answers (the overlay uses this). */
  subscribeFeedback: (handler: FeedbackHandler) => () => void;
  openCamera: () => void;
  closeCamera: () => void;
  cameraOpen: boolean;
  /** The browser can open a camera and this device has not said it has none. */
  cameraSupported: boolean;
  /** Camera access is denied for this site, so opening it would only fail. */
  cameraBlocked: boolean;
  prefs: ScanPrefs;
  setPrefs: (next: Partial<ScanPrefs>) => void;
};

const ScannerContext = createContext<ScannerContextValue | null>(null);
const PREFS_KEY = "rackline.scanPrefs";
const CAMERA_DEBOUNCE_MS = 800;

function defaultPrefs(): ScanPrefs {
  return defaultScanPrefs();
}

function loadPrefs(): ScanPrefs {
  try {
    return parseScanPrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return defaultPrefs();
  }
}

function vibrate(accepted: boolean, enabled: boolean) {
  if (!enabled || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(scanVibration(accepted));
  } catch {
    // Vibration is optional; some browsers throw without a user gesture.
  }
}

function cameraHardwareAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

function barcodeDetectorAvailable(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

function playTone(ok: boolean, enabled: boolean) {
  if (!enabled) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    void ctx.resume();
  } catch {
    // Audio is optional feedback for gun scanners.
  }
}

export function ScannerProvider({ children }: { children: ReactNode }) {
  const [lastScan, setLastScan] = useState<ScanEvent | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // null until the device list says whether a camera exists.
  const [cameraFound, setCameraFound] = useState<boolean | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [prefs, setPrefsState] = useState<ScanPrefs>(() =>
    typeof window === "undefined" ? defaultPrefs() : loadPrefs(),
  );
  const hid = useRef<HidBufferState>({ buffer: "", lastKeyAt: 0 });
  const listeners = useRef(new Set<ScanHandler>());
  const feedbackListeners = useRef(new Set<FeedbackHandler>());
  const feedbackSeq = useRef(0);
  const lastHeardAt = useRef<number | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const lastCamera = useRef<{ raw: string; at: number } | null>(null);

  const publish = useCallback((event: ScanEvent) => {
    setLastScan(event);
    for (const handler of listeners.current) handler(event);
  }, []);

  const emitScan = useCallback(
    (raw: string, source: ScanSource) => {
      const value = raw.trim();
      if (!value) return;
      if (source === "camera") {
        const prev = lastCamera.current;
        const now = Date.now();
        if (prev && prev.raw === value && now - prev.at < CAMERA_DEBOUNCE_MS) return;
        lastCamera.current = { raw: value, at: now };
      }
      playTone(true, prefsRef.current.beep);
      lastHeardAt.current = Date.now();
      publish({ raw: value, source, at: Date.now() });
    },
    [publish],
  );

  const emitScanResult = useCallback((accepted: boolean) => {
    const now = Date.now();
    const current = prefsRef.current;
    const tone = scanResultTone(accepted, lastHeardAt.current, now);
    if (tone) playTone(tone === "ok", current.beep);
    vibrate(accepted, current.vibrate);
    feedbackSeq.current += 1;
    const feedback: ScanFeedback = { id: feedbackSeq.current, accepted, at: now };
    for (const handler of feedbackListeners.current) handler(feedback);
  }, []);

  const emitScanError = useCallback(() => {
    emitScanResult(false);
  }, [emitScanResult]);

  const subscribe = useCallback((handler: ScanHandler) => {
    listeners.current.add(handler);
    return () => {
      listeners.current.delete(handler);
    };
  }, []);

  const subscribeFeedback = useCallback((handler: FeedbackHandler) => {
    feedbackListeners.current.add(handler);
    return () => {
      feedbackListeners.current.delete(handler);
    };
  }, []);

  const setPrefs = useCallback((next: Partial<ScanPrefs>) => {
    setPrefsState((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
      } catch {
        // Ignore quota / private mode.
      }
      return merged;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inCapture = Boolean(target?.closest("[data-scan-capture]"));
      const inField =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || Boolean(target?.isContentEditable);
      const result = accumulateHidKey(hid.current, {
        key: event.key,
        now: Date.now(),
        inCapture,
        inField,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      });
      hid.current = result.state;
      if (result.action === "emit") {
        event.preventDefault();
        emitScan(result.value, "hid");
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [emitScan]);

  // Learn whether this device has a camera and whether this site may use it, so Scan does not
  // open a viewfinder that can only fail. Unknown answers keep the camera on offer.
  useEffect(() => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia) return;
    let cancelled = false;
    const listDevices = () => {
      if (typeof media.enumerateDevices !== "function") return;
      media
        .enumerateDevices()
        .then((devices) => {
          if (!cancelled) setCameraFound(cameraListed(devices));
        })
        .catch(() => undefined);
    };
    listDevices();
    media.addEventListener?.("devicechange", listDevices);

    let permission: PermissionStatus | null = null;
    const readPermission = () => {
      if (permission && !cancelled) setCameraBlocked(permission.state === "denied");
    };
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        permission = status;
        readPermission();
        status.addEventListener?.("change", readPermission);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      media.removeEventListener?.("devicechange", listDevices);
      permission?.removeEventListener?.("change", readPermission);
    };
  }, []);

  const onCameraScan = useCallback(
    (raw: string) => {
      emitScan(raw, "camera");
      setCameraOpen(false);
    },
    [emitScan],
  );

  /** The camera would not start: close the sheet, hand over to the scan field, and say why in plain words. */
  const onCameraFail = useCallback((err: unknown) => {
    const kind = cameraFailureKind(err);
    setCameraOpen(false);
    if (kind === "missing") setCameraFound(false);
    if (kind === "blocked") setCameraBlocked(true);
    const copy = cameraFailureCopy(kind, focusScanCapture());
    toast.error(copy.message, { description: copy.hint });
  }, []);

  const value = useMemo<ScannerContextValue>(
    () => ({
      lastScan,
      emitScan,
      emitScanResult,
      emitScanError,
      subscribe,
      subscribeFeedback,
      openCamera: () => setCameraOpen(true),
      closeCamera: () => setCameraOpen(false),
      cameraOpen,
      cameraSupported: cameraHardwareAvailable() && cameraFound !== false,
      cameraBlocked,
      prefs,
      setPrefs,
    }),
    [
      lastScan,
      emitScan,
      emitScanResult,
      emitScanError,
      subscribe,
      subscribeFeedback,
      cameraOpen,
      cameraFound,
      cameraBlocked,
      prefs,
      setPrefs,
    ],
  );

  return (
    <ScannerContext.Provider value={value}>
      {children}
      {cameraOpen ? (
        <CameraOverlay onClose={() => setCameraOpen(false)} onScan={onCameraScan} onFail={onCameraFail} />
      ) : null}
      <ScanFeedbackOverlay subscribe={subscribeFeedback} enabled={prefs.flash} />
    </ScannerContext.Provider>
  );
}

export function useScanner() {
  const ctx = useContext(ScannerContext);
  if (!ctx) throw new Error("useScanner must be used within ScannerProvider");
  return ctx;
}

const FLASH_MS = 250;
const PULSE_MS = 450;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Full-screen answer to a scan: a quick translucent green or red wash. Under reduced motion it
 * is a still coloured border instead. Never takes pointer input and is hidden from assistive tech;
 * the page's own banner carries the words.
 */
export function ScanFeedbackOverlay({
  subscribe,
  enabled,
}: {
  subscribe: (handler: FeedbackHandler) => () => void;
  enabled: boolean;
}) {
  const [feedback, setFeedback] = useState<{ id: number; accepted: boolean; reduced: boolean } | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const washRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () =>
      subscribe((next) => {
        if (!enabledRef.current) return;
        setFeedback({ id: next.id, accepted: next.accepted, reduced: prefersReducedMotion() });
      }),
    [subscribe],
  );

  useEffect(() => {
    if (!feedback) return;
    const el = washRef.current;
    let animation: Animation | null = null;
    if (el && !feedback.reduced && typeof el.animate === "function") {
      try {
        animation = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FLASH_MS, easing: "ease-out", fill: "forwards" });
      } catch {
        animation = null;
      }
    }
    const timer = window.setTimeout(() => setFeedback(null), feedback.reduced ? PULSE_MS : FLASH_MS + 20);
    return () => {
      window.clearTimeout(timer);
      animation?.cancel();
    };
  }, [feedback]);

  if (!feedback) return null;
  return (
    <div
      key={feedback.id}
      ref={washRef}
      aria-hidden="true"
      data-scan-feedback={feedback.accepted ? "ok" : "bad"}
      className={cn(
        "pointer-events-none fixed inset-0 z-[100] print:hidden",
        feedback.reduced
          ? feedback.accepted
            ? "border-[6px] border-ok"
            : "border-[6px] border-bad"
          : feedback.accepted
            ? "bg-ok/25"
            : "bg-bad/30",
      )}
    />
  );
}

type Detector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

async function decodeWithZxing(video: HTMLVideoElement): Promise<string | null> {
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    const result = await reader.decodeOnceFromVideoElement(video);
    return result.getText()?.trim() || null;
  } catch {
    return null;
  }
}

function CameraOverlay({
  onClose,
  onScan,
  onFail,
}: {
  onClose: () => void;
  onScan: (raw: string) => void;
  /** The camera would not start. The provider closes the sheet and explains. */
  onFail: (err: unknown) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [engine, setEngine] = useState<"detector" | "zxing" | null>(null);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const onFailRef = useRef(onFail);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;
  onFailRef.current = onFail;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let closed = false;
    let zxingTimer = 0;
    const video = videoRef.current;
    if (!video) return;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        if (!closed) onFailRef.current(err);
        return;
      }
      try {
        if (!video || closed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();

        const DetectorCtor = (window as Window & { BarcodeDetector?: new (opts: { formats: string[] }) => Detector })
          .BarcodeDetector;
        if (DetectorCtor) {
          setEngine("detector");
          const detector = new DetectorCtor({
            formats: ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "itf"],
          });
          const tick = async () => {
            if (closed || !video) return;
            try {
              const found = await detector.detect(video);
              const value = found[0]?.rawValue?.trim();
              if (value) {
                onScanRef.current(value);
                onCloseRef.current();
                return;
              }
            } catch {
              // Keep the viewfinder open if a frame fails to decode.
            }
            raf = window.requestAnimationFrame(() => {
              void tick();
            });
          };
          void tick();
          return;
        }

        setEngine("zxing");
        const poll = async () => {
          if (closed || !video) return;
          const value = await decodeWithZxing(video);
          if (value) {
            onScanRef.current(value);
            onCloseRef.current();
            return;
          }
          zxingTimer = window.setTimeout(() => {
            void poll();
          }, 250);
        };
        void poll();
      } catch {
        // The stream opened but would not play: not a missing or blocked camera.
        if (!closed) onFailRef.current(null);
      }
    }

    void start();
    return () => {
      closed = true;
      window.cancelAnimationFrame(raf);
      window.clearTimeout(zxingTimer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4 print:hidden">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-card text-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Scanner</p>
            <p className="font-semibold">Point at a location or SKU barcode</p>
          </div>
          <button className="text-sm text-muted-foreground hover:text-ink" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="relative bg-bay">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-amber/80" />
        </div>
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {engine === "zxing"
            ? "Using ZXing camera decode. USB and Bluetooth guns also work from any screen."
            : barcodeDetectorAvailable()
              ? "USB and Bluetooth gun scanners also work from any screen — just scan."
              : "Camera decode via ZXing. USB and Bluetooth guns also work from any screen."}
        </p>
      </div>
    </div>
  );
}
