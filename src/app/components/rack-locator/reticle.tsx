export type TargetTone = "target" | "origin";

export const TONE_STROKE: Record<TargetTone, string> = {
  target: "var(--primary)",
  origin: "var(--tone-success)",
};

/**
 * Crosshair drawn in a 40-unit box centred on 0,0. Targets get the four ticks; origins are a plain ring.
 * A background-coloured halo keeps it legible over busy racks in either theme.
 */
export function ReticleMark({ tone, focused, scale = 1 }: { tone: TargetTone; focused?: boolean; scale?: number }) {
  const stroke = TONE_STROKE[tone];
  const ticks = tone === "target" ? "M0 -19V-8 M0 8V19 M-19 0H-8 M8 0H19" : "";
  return (
    <g transform={scale === 1 ? undefined : `scale(${scale})`} pointerEvents="none">
      {focused ? (
        <circle r="12" fill="none" stroke={stroke} strokeWidth="2" className="rack-reticle-pulse" />
      ) : null}
      <circle r="12" fill="none" stroke="var(--background)" strokeWidth="5" opacity="0.85" />
      {ticks ? <path d={ticks} stroke="var(--background)" strokeWidth="5" strokeLinecap="round" opacity="0.85" /> : null}
      <circle r="12" fill="none" stroke={stroke} strokeWidth="2.5" />
      {ticks ? <path d={ticks} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" /> : null}
      <circle r="2.8" fill={stroke} stroke="var(--background)" strokeWidth="1" />
    </g>
  );
}

/** The same crosshair as a standalone DOM element, for overlays such as the 3D scene's HTML markers. */
export function Reticle({ tone, focused, size }: { tone: TargetTone; focused?: boolean; size?: number }) {
  const px = size ?? (focused ? 46 : tone === "target" ? 32 : 22);
  return (
    <svg viewBox="-24 -24 48 48" width={px} height={px} className="overflow-visible" aria-hidden="true">
      <ReticleMark tone={tone} focused={focused} />
    </svg>
  );
}
