import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { buildLabelPayload, type LabelKind, type LabelMedia } from "@/domain/labels/zpl";
import { resolvePrinterForKind, type PrintKind } from "@/domain/print-station";

export type PrinterRecord = {
  id: string;
  name: string;
  connection: "browser" | "qz" | "download";
  media: LabelMedia;
  dpi: number;
  qzPrinterName: string | null;
  isDefault: boolean;
};

export type PrintStationRecord = {
  id: string;
  name: string;
  warehouseId: string | null;
  defaultPrinterId: string | null;
  bayPrinterId: string | null;
  shippingPrinterId: string | null;
};

type PrintRequest = {
  kind: PrintKind | "sheet";
  title: string;
  href?: string;
  zpl?: string;
  data?: Record<string, string>;
  refType?: string;
  refId?: string;
  /** Force a path regardless of station printer (e.g. sheet ZPL download). */
  forceConnection?: "browser" | "qz" | "download";
};

type PrintContextValue = {
  printers: PrinterRecord[];
  stations: PrintStationRecord[];
  stationId: string | null;
  station: PrintStationRecord | null;
  setStationId: (id: string | null) => void;
  statusLabel: string;
  refresh: () => Promise<void>;
  print: (job: PrintRequest) => Promise<{ ok: boolean; message: string }>;
};

const PrintContext = createContext<PrintContextValue | null>(null);
const STATION_KEY = "rackline.printStationId";

type QzApi = {
  websocket: { connect: () => Promise<void>; isActive: () => boolean };
  configs: { create: (printer: string) => unknown };
  print: (config: unknown, data: unknown[]) => Promise<void>;
};

declare global {
  interface Window {
    qz?: QzApi;
  }
}

function downloadZpl(filename: string, body: string) {
  const blob = new Blob([body], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".zpl") ? filename : `${filename}.zpl`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function ensureQz(): Promise<QzApi | null> {
  if (window.qz) return window.qz;
  try {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-qz-tray]");
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("QZ Tray script failed")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";
      script.async = true;
      script.dataset.qzTray = "1";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("QZ Tray script failed to load"));
      document.head.appendChild(script);
    });
  } catch {
    return null;
  }
  return window.qz ?? null;
}

async function printViaQz(printerName: string, zpl: string): Promise<void> {
  const qz = await ensureQz();
  if (!qz) throw new Error("QZ Tray is not available in this browser");
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
  }
  const config = qz.configs.create(printerName);
  await qz.print(config, [{ type: "raw", format: "command", data: zpl }]);
}

async function auditJob(input: {
  printerId: string | null;
  stationId: string | null;
  kind: string;
  payloadFormat: "html" | "zpl";
  status: "sent" | "failed";
  refType?: string;
  refId?: string;
  error?: string;
}) {
  try {
    await api("/api/print-jobs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch {
    // Audit is best-effort.
  }
}

export function PrintProvider({ children }: { children: ReactNode }) {
  const [printers, setPrinters] = useState<PrinterRecord[]>([]);
  const [stations, setStations] = useState<PrintStationRecord[]>([]);
  const [stationId, setStationIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STATION_KEY);
    } catch {
      return null;
    }
  });

  const refresh = useCallback(async () => {
    const [nextPrinters, nextStations] = await Promise.all([
      api<PrinterRecord[]>("/api/printers"),
      api<PrintStationRecord[]>("/api/print-stations"),
    ]);
    setPrinters(nextPrinters);
    setStations(nextStations);
    if (!stationId && nextStations[0]) {
      setStationIdState(nextStations[0].id);
      try {
        localStorage.setItem(STATION_KEY, nextStations[0].id);
      } catch {
        // ignore
      }
    }
  }, [stationId]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  const setStationId = useCallback((id: string | null) => {
    setStationIdState(id);
    try {
      if (id) localStorage.setItem(STATION_KEY, id);
      else localStorage.removeItem(STATION_KEY);
    } catch {
      // ignore
    }
  }, []);

  const station = useMemo(
    () => stations.find((row) => row.id === stationId) ?? stations[0] ?? null,
    [stations, stationId],
  );

  const statusLabel = useMemo(() => {
    if (!station) return "Browser only";
    const printerId = resolvePrinterForKind(station, printers, "bay");
    const printer = printers.find((row) => row.id === printerId);
    if (!printer) return `${station.name} · Browser only`;
    if (printer.connection === "qz") return `${station.name} · QZ (${printer.name})`;
    if (printer.connection === "download") return `${station.name} · Download ZPL`;
    return `${station.name} · ${printer.name}`;
  }, [station, printers]);

  const print = useCallback(
    async (job: PrintRequest) => {
      const printerId = resolvePrinterForKind(station, printers, job.kind);
      const printer = printers.find((row) => row.id === printerId) ?? null;
      const connection = job.forceConnection ?? printer?.connection ?? "browser";
      const media = printer?.media ?? (job.kind === "shipping-label" ? "4x6" : job.kind === "pack-slip" ? "letter" : "2x1");
      const dpi = printer?.dpi ?? 203;

      let zpl = job.zpl ?? null;
      if (!zpl && job.data && job.kind !== "pack-slip") {
        const payload = buildLabelPayload(job.kind as LabelKind, job.data, media, dpi);
        zpl = payload.body;
      }

      try {
        if (job.kind === "pack-slip" || (connection === "browser" && job.kind !== "sheet")) {
          if (job.href && job.kind === "pack-slip") {
            window.open(job.href, "_blank", "noopener,noreferrer");
          } else if (job.href && !zpl) {
            window.open(job.href, "_blank", "noopener,noreferrer");
          } else {
            window.print();
          }
          await auditJob({
            printerId: printer?.id ?? null,
            stationId: station?.id ?? null,
            kind: job.kind,
            payloadFormat: "html",
            status: "sent",
            refType: job.refType,
            refId: job.refId,
          });
          return { ok: true, message: "Opened browser print" };
        }

        if (!zpl && job.href) {
          window.open(job.href, "_blank", "noopener,noreferrer");
          await auditJob({
            printerId: printer?.id ?? null,
            stationId: station?.id ?? null,
            kind: job.kind,
            payloadFormat: "html",
            status: "sent",
            refType: job.refType,
            refId: job.refId,
          });
          return { ok: true, message: "Opened label page" };
        }

        if (!zpl) throw new Error("No ZPL payload for this label");

        if (connection === "qz") {
          const qzName = printer?.qzPrinterName?.trim();
          if (!qzName) throw new Error("QZ printer name is not configured");
          await printViaQz(qzName, zpl);
          await auditJob({
            printerId: printer?.id ?? null,
            stationId: station?.id ?? null,
            kind: job.kind,
            payloadFormat: "zpl",
            status: "sent",
            refType: job.refType,
            refId: job.refId,
          });
          return { ok: true, message: `Sent to QZ (${qzName})` };
        }

        const filename =
          job.kind === "bay"
            ? `${job.data?.code || "bay"}.zpl`
            : job.kind === "item"
              ? `${job.data?.sku || "item"}.zpl`
              : `${job.title.replace(/\s+/g, "-").toLowerCase()}.zpl`;
        downloadZpl(filename, zpl);
        await auditJob({
          printerId: printer?.id ?? null,
          stationId: station?.id ?? null,
          kind: job.kind,
          payloadFormat: "zpl",
          status: "sent",
          refType: job.refType,
          refId: job.refId,
        });
        return { ok: true, message: "Downloaded ZPL" };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Print failed";
        await auditJob({
          printerId: printer?.id ?? null,
          stationId: station?.id ?? null,
          kind: job.kind,
          payloadFormat: zpl ? "zpl" : "html",
          status: "failed",
          refType: job.refType,
          refId: job.refId,
          error: message,
        });
        return { ok: false, message };
      }
    },
    [station, printers],
  );

  const value = useMemo(
    () => ({
      printers,
      stations,
      stationId: station?.id ?? null,
      station,
      setStationId,
      statusLabel,
      refresh,
      print,
    }),
    [printers, stations, station, setStationId, statusLabel, refresh, print],
  );

  return <PrintContext.Provider value={value}>{children}</PrintContext.Provider>;
}

export function usePrint() {
  const ctx = useContext(PrintContext);
  if (!ctx) throw new Error("usePrint must be used within PrintProvider");
  return ctx;
}
