import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseScaleReport, SCALE_USAGE_PAGE, type ScaleReading } from "@/domain/scale-report";

/** The slice of WebHID the scale uses. Chrome and Edge on desktop have it; Safari, Firefox, and phones do not. */
type HidCollection = { usagePage: number };
type HidDevice = EventTarget & {
  opened: boolean;
  productName: string;
  collections: HidCollection[];
  open: () => Promise<void>;
  close: () => Promise<void>;
  forget?: () => Promise<void>;
};
type HidInputReportEvent = Event & { device: HidDevice; reportId: number; data: DataView };
type HidConnectionEvent = Event & { device: HidDevice };
type Hid = EventTarget & {
  getDevices: () => Promise<HidDevice[]>;
  requestDevice: (options: { filters: { usagePage: number }[] }) => Promise<HidDevice[]>;
};

type ReadingHandler = (reading: ScaleReading) => void;

type ScaleContextValue = {
  /** This browser can read a USB scale. Without it, typed weights still work everywhere. */
  supported: boolean;
  /** The connected scale's name, or null. */
  device: string | null;
  /** The latest weight report; null until the scale sends one. */
  reading: ScaleReading | null;
  error: string | null;
  connecting: boolean;
  /** Opens the browser's device picker; call it from a click. */
  connect: () => Promise<void>;
  /** Closes the scale and forgets it, so it is not reopened on the next visit. */
  disconnect: () => Promise<void>;
  /** Every changed reading, as it arrives; auto-ship watches these. */
  subscribe: (handler: ReadingHandler) => () => void;
  /** Reopen a scale this browser was already allowed to use. Screens that weigh call it once. */
  resume: () => void;
};

const ScaleContext = createContext<ScaleContextValue | null>(null);

function webHid(): Hid | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  return (navigator as Navigator & { hid?: Hid }).hid ?? null;
}

function isScale(device: HidDevice): boolean {
  return device.collections.some((row) => row.usagePage === SCALE_USAGE_PAGE);
}

function sameReading(a: ScaleReading | null, b: ScaleReading): boolean {
  return Boolean(a && a.status === b.status && a.unit === b.unit && a.value === b.value);
}

function openError(err: unknown): string | null {
  // Closing the device picker without choosing one.
  if (err instanceof DOMException && err.name === "NotFoundError") return null;
  const detail = err instanceof Error && err.message ? ` ${err.message}` : "";
  return `Could not open the scale. Close other apps or tabs using it, then try again.${detail}`;
}

export function ScaleProvider({ children }: { children: ReactNode }) {
  const hid = useMemo(webHid, []);
  const [device, setDevice] = useState<HidDevice | null>(null);
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const listeners = useRef(new Set<ReadingHandler>());
  const deviceRef = useRef<HidDevice | null>(null);
  const lastReading = useRef<ScaleReading | null>(null);
  const resumed = useRef(false);

  const onReport = useCallback((event: Event) => {
    const report = event as HidInputReportEvent;
    const next = parseScaleReport(
      new Uint8Array(report.data.buffer, report.data.byteOffset, report.data.byteLength),
      report.reportId,
    );
    if (!next || sameReading(lastReading.current, next)) return;
    lastReading.current = next;
    setReading(next);
    for (const handler of listeners.current) handler(next);
  }, []);

  const release = useCallback(() => {
    deviceRef.current?.removeEventListener("inputreport", onReport);
    deviceRef.current = null;
    lastReading.current = null;
    setDevice(null);
    setReading(null);
  }, [onReport]);

  const attach = useCallback(
    async (next: HidDevice) => {
      if (deviceRef.current === next) return;
      if (!next.opened) await next.open();
      deviceRef.current?.removeEventListener("inputreport", onReport);
      next.addEventListener("inputreport", onReport);
      deviceRef.current = next;
      lastReading.current = null;
      setDevice(next);
      setReading(null);
      setError(null);
    },
    [onReport],
  );

  const resume = useCallback(() => {
    if (!hid || resumed.current) return;
    resumed.current = true;
    void hid
      .getDevices()
      .then((devices) => {
        const scale = devices.find(isScale);
        return scale ? attach(scale) : undefined;
      })
      .catch((err: unknown) => setError(openError(err)));
  }, [hid, attach]);

  const connect = useCallback(async () => {
    if (!hid) return;
    setConnecting(true);
    setError(null);
    try {
      const picked = await hid.requestDevice({ filters: [{ usagePage: SCALE_USAGE_PAGE }] });
      const scale = picked.find(isScale) ?? picked[0];
      if (scale) await attach(scale);
    } catch (err) {
      setError(openError(err));
    } finally {
      setConnecting(false);
    }
  }, [hid, attach]);

  const disconnect = useCallback(async () => {
    const current = deviceRef.current;
    release();
    if (!current) return;
    try {
      await current.close();
      await current.forget?.();
    } catch {
      // Already unplugged or closed.
    }
  }, [release]);

  useEffect(() => {
    if (!hid) return;
    const onConnect = (event: Event) => {
      const next = (event as HidConnectionEvent).device;
      if (resumed.current && !deviceRef.current && isScale(next)) void attach(next).catch((err: unknown) => setError(openError(err)));
    };
    const onDisconnect = (event: Event) => {
      if ((event as HidConnectionEvent).device === deviceRef.current) release();
    };
    hid.addEventListener("connect", onConnect);
    hid.addEventListener("disconnect", onDisconnect);
    return () => {
      hid.removeEventListener("connect", onConnect);
      hid.removeEventListener("disconnect", onDisconnect);
    };
  }, [hid, attach, release]);

  const subscribe = useCallback((handler: ReadingHandler) => {
    listeners.current.add(handler);
    return () => {
      listeners.current.delete(handler);
    };
  }, []);

  const value = useMemo<ScaleContextValue>(
    () => ({
      supported: Boolean(hid),
      device: device ? device.productName || "USB scale" : null,
      reading,
      error,
      connecting,
      connect,
      disconnect,
      subscribe,
      resume,
    }),
    [hid, device, reading, error, connecting, connect, disconnect, subscribe, resume],
  );

  return <ScaleContext.Provider value={value}>{children}</ScaleContext.Provider>;
}

/** The pack-bench scale. Mounting a screen that uses it reopens a scale this browser already allowed. */
export function useScale() {
  const ctx = useContext(ScaleContext);
  if (!ctx) throw new Error("useScale must be used within ScaleProvider");
  const { resume } = ctx;
  useEffect(() => resume(), [resume]);
  return ctx;
}
