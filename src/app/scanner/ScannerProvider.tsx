import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { accumulateHidKey, type HidBufferState } from "@/domain/hid-buffer";

export type ScanSource = "hid" | "camera" | "typed";

export type ScanEvent = {
  raw: string;
  source: ScanSource;
  at: number;
};

export type ScanPrefs = {
  beep: boolean;
  preferCamera: boolean;
};

type ScanHandler = (event: ScanEvent) => void;

type ScannerContextValue = {
  lastScan: ScanEvent | null;
  emitScan: (raw: string, source: ScanSource) => void;
  emitScanError: () => void;
  subscribe: (handler: ScanHandler) => () => void;
  openCamera: () => void;
  closeCamera: () => void;
  cameraOpen: boolean;
  cameraSupported: boolean;
  prefs: ScanPrefs;
  setPrefs: (next: Partial<ScanPrefs>) => void;
};

const ScannerContext = createContext<ScannerContextValue | null>(null);
const PREFS_KEY = "rackline.scanPrefs";
const CAMERA_DEBOUNCE_MS = 800;

function defaultPrefs(): ScanPrefs {
  return { beep: true, preferCamera: false };
}

function loadPrefs(): ScanPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<ScanPrefs>;
    return {
      beep: parsed.beep !== false,
      preferCamera: Boolean(parsed.preferCamera),
    };
  } catch {
    return defaultPrefs();
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
  const [prefs, setPrefsState] = useState<ScanPrefs>(() =>
    typeof window === "undefined" ? defaultPrefs() : loadPrefs(),
  );
  const hid = useRef<HidBufferState>({ buffer: "", lastKeyAt: 0 });
  const listeners = useRef(new Set<ScanHandler>());
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
      publish({ raw: value, source, at: Date.now() });
    },
    [publish],
  );

  const emitScanError = useCallback(() => {
    playTone(false, prefsRef.current.beep);
  }, []);

  const subscribe = useCallback((handler: ScanHandler) => {
    listeners.current.add(handler);
    return () => {
      listeners.current.delete(handler);
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

  const onCameraScan = useCallback(
    (raw: string) => {
      emitScan(raw, "camera");
      setCameraOpen(false);
    },
    [emitScan],
  );

  const value = useMemo<ScannerContextValue>(
    () => ({
      lastScan,
      emitScan,
      emitScanError,
      subscribe,
      openCamera: () => setCameraOpen(true),
      closeCamera: () => setCameraOpen(false),
      cameraOpen,
      cameraSupported: cameraHardwareAvailable(),
      prefs,
      setPrefs,
    }),
    [lastScan, emitScan, emitScanError, subscribe, cameraOpen, prefs, setPrefs],
  );

  return (
    <ScannerContext.Provider value={value}>
      {children}
      {cameraOpen ? <CameraOverlay onClose={() => setCameraOpen(false)} onScan={onCameraScan} /> : null}
    </ScannerContext.Provider>
  );
}

export function useScanner() {
  const ctx = useContext(ScannerContext);
  if (!ctx) throw new Error("useScanner must be used within ScannerProvider");
  return ctx;
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

function CameraOverlay({ onClose, onScan }: { onClose: () => void; onScan: (raw: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<"detector" | "zxing" | null>(null);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;

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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open the camera");
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
        {error ? (
          <p className="px-4 py-3 text-sm text-bad">{error}</p>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {engine === "zxing"
              ? "Using ZXing camera decode. USB and Bluetooth guns also work from any screen."
              : barcodeDetectorAvailable()
                ? "USB and Bluetooth gun scanners also work from any screen — just scan."
                : "Camera decode via ZXing. USB and Bluetooth guns also work from any screen."}
          </p>
        )}
      </div>
    </div>
  );
}
