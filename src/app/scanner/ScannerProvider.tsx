import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ScanSource = "hid" | "camera" | "typed";

export type ScanEvent = {
  raw: string;
  source: ScanSource;
  at: number;
};

type ScannerContextValue = {
  lastScan: ScanEvent | null;
  emitScan: (raw: string, source: ScanSource) => void;
  openCamera: () => void;
  closeCamera: () => void;
  cameraOpen: boolean;
  cameraSupported: boolean;
};

const ScannerContext = createContext<ScannerContextValue | null>(null);

const HID_GAP_MS = 40;
const HID_MIN_LEN = 3;

function cameraSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

function playTone(ok: boolean) {
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
  const buffer = useRef("");
  const lastKeyAt = useRef(0);

  const emitScan = useCallback((raw: string, source: ScanSource) => {
    const value = raw.trim();
    if (!value) return;
    playTone(true);
    setLastScan({ raw: value, source, at: Date.now() });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inCapture = Boolean(target?.closest("[data-scan-capture]"));
      const inField =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || Boolean(target?.isContentEditable);
      const now = Date.now();
      const rapid = now - lastKeyAt.current <= HID_GAP_MS;

      if (event.key === "Enter") {
        if (inCapture) {
          buffer.current = "";
          lastKeyAt.current = now;
          return;
        }
        if (buffer.current.length >= HID_MIN_LEN && rapid) {
          event.preventDefault();
          const value = buffer.current;
          buffer.current = "";
          emitScan(value, "hid");
        } else {
          buffer.current = "";
        }
        lastKeyAt.current = now;
        return;
      }

      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;

      if (!rapid && inField && !inCapture) {
        buffer.current = "";
        lastKeyAt.current = now;
        return;
      }

      if (!rapid) buffer.current = "";
      buffer.current += event.key;
      lastKeyAt.current = now;
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
      openCamera: () => setCameraOpen(true),
      closeCamera: () => setCameraOpen(false),
      cameraOpen,
      cameraSupported: cameraSupported(),
    }),
    [lastScan, emitScan, cameraOpen],
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

function CameraOverlay({ onClose, onScan }: { onClose: () => void; onScan: (raw: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let closed = false;
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
        if (!DetectorCtor) {
          setError("Camera barcode decoding is not available in this browser. Use a USB / Bluetooth scanner.");
          return;
        }
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open the camera");
      }
    }

    void start();
    return () => {
      closed = true;
      window.cancelAnimationFrame(raf);
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
        {error ? <p className="px-4 py-3 text-sm text-bad">{error}</p> : <p className="px-4 py-3 text-sm text-muted-foreground">USB and Bluetooth gun scanners also work from any screen — just scan.</p>}
      </div>
    </div>
  );
}
