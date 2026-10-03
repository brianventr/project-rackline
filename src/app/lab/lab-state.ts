import { useCallback, useEffect, useState } from "react";
import { BACKDROPS, LENSES, RENDER_ASPECTS, RENDER_LONG_EDGES, RENDER_QUALITIES, STUDIO_PRESETS, isFinishId } from "@/domain/cad-lab";
import type { Orientation, ViewerLook } from "./CadViewer";

export const DEFAULT_LOOK: ViewerLook = {
  studio: "softbox",
  backdrop: "white",
  glossyFloor: false,
  exposure: 0,
  envIntensity: 1,
  envRotation: 0,
  toneMapping: "neutral",
  lens: 50,
  dof: false,
  fStop: 5.6,
};

export type ModelSettings = {
  assign: Record<string, string>;
  tints: Record<string, string>;
  hidden: string[];
  orientation: Orientation;
};

export const DEFAULT_SETTINGS: ModelSettings = {
  assign: {},
  tints: {},
  hidden: [],
  orientation: { turn: 0, tip: 0, roll: 0 },
};

export type RenderSettings = { aspect: string; longEdge: number; quality: string; denoise: boolean; bounces: number };

export const DEFAULT_RENDER: RenderSettings = { aspect: "view", longEdge: 1920, quality: "good", denoise: true, bounces: 8 };

export const BOUNCE_CHOICES = [4, 8, 14] as const;
export const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22] as const;

const PREFIX = "rackline.lab.v1";

/* Per-viewer conveniences only: storage can be blocked or empty, and the page works the same without it. */
function read<T>(key: string): Partial<T> | null {
  try {
    const raw = window.localStorage.getItem(`${PREFIX}.${key}`);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(`${PREFIX}.${key}`, JSON.stringify(value));
  } catch {
    /* Private windows and full storage just do not remember. */
  }
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function quarter(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) ? ((n % 4) + 4) % 4 : 0;
}

/** Saved settings pass through here so a stale or hand-edited entry cannot break the viewer. */
export function cleanSettings(raw: Partial<ModelSettings> | null): ModelSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const assign: Record<string, string> = {};
  for (const [part, finish] of Object.entries(raw.assign ?? {})) if (typeof finish === "string" && isFinishId(finish)) assign[part] = finish;
  const tints: Record<string, string> = {};
  for (const [finish, color] of Object.entries(raw.tints ?? {})) if (isFinishId(finish) && isHex(color)) tints[finish] = color.toLowerCase();
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((id): id is string => typeof id === "string") : [];
  const o = (raw.orientation ?? {}) as Partial<Orientation>;
  return { assign, tints, hidden, orientation: { turn: quarter(o.turn), tip: quarter(o.tip), roll: quarter(o.roll) } };
}

function oneOf<T>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

function clamped(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** A remembered look, with anything unknown or out of range back at its default. */
export function cleanLook(raw: Partial<ViewerLook> | null): ViewerLook {
  if (!raw || typeof raw !== "object") return DEFAULT_LOOK;
  return {
    studio: oneOf(raw.studio, STUDIO_PRESETS.map((p) => p.id), DEFAULT_LOOK.studio),
    backdrop: oneOf(raw.backdrop, BACKDROPS.map((b) => b.id), DEFAULT_LOOK.backdrop),
    glossyFloor: typeof raw.glossyFloor === "boolean" ? raw.glossyFloor : DEFAULT_LOOK.glossyFloor,
    exposure: clamped(raw.exposure, -2, 2, DEFAULT_LOOK.exposure),
    envIntensity: clamped(raw.envIntensity, 0.2, 3, DEFAULT_LOOK.envIntensity),
    envRotation: clamped(raw.envRotation, 0, 360, DEFAULT_LOOK.envRotation),
    toneMapping: oneOf(raw.toneMapping, ["neutral", "agx", "aces"] as const, DEFAULT_LOOK.toneMapping),
    lens: oneOf(raw.lens, LENSES as readonly number[], DEFAULT_LOOK.lens),
    dof: typeof raw.dof === "boolean" ? raw.dof : DEFAULT_LOOK.dof,
    fStop: oneOf(raw.fStop, F_STOPS as readonly number[], DEFAULT_LOOK.fStop),
  };
}

/** Remembered render settings, limited to what the Render panel offers. */
export function cleanRender(raw: Partial<RenderSettings> | null): RenderSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_RENDER;
  return {
    aspect: oneOf(raw.aspect, RENDER_ASPECTS.map((a) => a.id), DEFAULT_RENDER.aspect),
    longEdge: oneOf(raw.longEdge, RENDER_LONG_EDGES as readonly number[], DEFAULT_RENDER.longEdge),
    quality: oneOf(raw.quality, RENDER_QUALITIES.map((q) => q.id) as string[], DEFAULT_RENDER.quality),
    denoise: typeof raw.denoise === "boolean" ? raw.denoise : DEFAULT_RENDER.denoise,
    bounces: oneOf(raw.bounces, BOUNCE_CHOICES as readonly number[], DEFAULT_RENDER.bounces),
  };
}

export function useStoredLook() {
  const [look, setLook] = useState<ViewerLook>(() => cleanLook(read<ViewerLook>("look")));
  useEffect(() => write("look", look), [look]);
  return [look, setLook] as const;
}

export function useStoredRender() {
  const [settings, setSettings] = useState<RenderSettings>(() => cleanRender(read<RenderSettings>("render")));
  useEffect(() => write("render", settings), [settings]);
  return [settings, setSettings] as const;
}

/** Drop a model's remembered finishes when it leaves the library, so a new upload of the name starts clean. */
export function forgetModelSettings(slug: string) {
  try {
    window.localStorage.removeItem(`${PREFIX}.model.${slug}`);
  } catch {
    /* Nothing stored, or storage is blocked. */
  }
}

/** Finishes, tints, hidden parts, and orientation, remembered per model in this browser. */
export function useModelSettings(slug: string | null) {
  const [state, setState] = useState<{ slug: string | null; settings: ModelSettings }>(() => ({
    slug,
    settings: slug ? cleanSettings(read<ModelSettings>(`model.${slug}`)) : DEFAULT_SETTINGS,
  }));
  // Switch models synchronously during render so the viewer never pairs one model with another's finishes.
  let current = state;
  if (state.slug !== slug) {
    current = { slug, settings: slug ? cleanSettings(read<ModelSettings>(`model.${slug}`)) : DEFAULT_SETTINGS };
    setState(current);
  }
  const update = useCallback(
    (next: (settings: ModelSettings) => ModelSettings) => {
      setState((prev) => {
        if (prev.slug !== slug) return prev;
        const settings = next(prev.settings);
        if (slug) write(`model.${slug}`, settings);
        return { slug, settings };
      });
    },
    [slug],
  );
  return [current.settings, update] as const;
}
