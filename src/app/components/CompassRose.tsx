import type { Ref } from "react";
import { describeNorth, needleRotation } from "@/domain/compass";
import { cn } from "@/lib/utils";

/**
 * A compass rose for the floor maps. `mapNorth` is where north points on the map (degrees clockwise from the
 * top edge); `screenUp` is which map direction currently reads as up on screen, so an orbiting camera can turn
 * the rose live through `rotorRef` without re-rendering.
 */
export function CompassRose({
  mapNorth,
  screenUp = 0,
  size = 56,
  className,
  rotorRef,
}: {
  mapNorth: number;
  screenUp?: number;
  size?: number;
  className?: string;
  rotorRef?: Ref<HTMLDivElement>;
}) {
  const rotation = needleRotation(mapNorth, screenUp);
  return (
    <div
      className={cn(
        "grid place-items-center rounded-full bg-background/85 shadow-sm ring-1 ring-border backdrop-blur",
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label={describeNorth(mapNorth)}
      title={describeNorth(mapNorth)}
    >
      <div
        ref={rotorRef}
        className="h-full w-full"
        style={{ transform: `rotate(${rotation}deg)`, transition: "transform 80ms linear" }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
          <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
          {Array.from({ length: 8 }, (_, i) => {
            const angle = (i * 45 * Math.PI) / 180;
            const inner = i % 2 === 0 ? 36 : 40;
            return (
              <line
                key={i}
                x1={50 + Math.sin(angle) * inner}
                y1={50 - Math.cos(angle) * inner}
                x2={50 + Math.sin(angle) * 44}
                y2={50 - Math.cos(angle) * 44}
                stroke="currentColor"
                strokeOpacity={i % 2 === 0 ? 0.55 : 0.25}
                strokeWidth={i % 2 === 0 ? 2 : 1.5}
              />
            );
          })}
          {/* Needle: a filled north half in the selection orange, a hollow south half. */}
          <polygon points="50,14 57,50 43,50" fill="#e05d38" />
          <polygon points="50,86 57,50 43,50" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" />
          <circle cx="50" cy="50" r="3.5" fill="currentColor" />
          <text x="50" y="12" textAnchor="middle" fontSize="15" fontWeight="700" fill="#e05d38" fontFamily="ui-monospace, monospace">
            N
          </text>
          <text x="90" y="55" textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.8" fontFamily="ui-monospace, monospace">
            E
          </text>
          <text x="50" y="97" textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.8" fontFamily="ui-monospace, monospace">
            S
          </text>
          <text x="10" y="55" textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.8" fontFamily="ui-monospace, monospace">
            W
          </text>
        </svg>
      </div>
    </div>
  );
}
