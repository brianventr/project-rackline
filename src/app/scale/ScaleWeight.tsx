import { Scale } from "lucide-react";
import { Button } from "../components/ui";
import { formatScaleValue, labelOunces, scaleStatusWords } from "@/domain/scale-report";
import { cn } from "@/lib/utils";
import { useScale } from "./ScaleProvider";

/** The live weight and what the scale says about it. */
export function ScaleReadout({ className }: { className?: string }) {
  const { device, reading } = useScale();
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className="font-mono tabular-nums">{reading ? formatScaleValue(reading) : "—"}</span>
      <span className="text-xs text-muted-foreground">
        {reading ? scaleStatusWords(reading) : device ? "Waiting for the scale" : "No scale"}
      </span>
    </span>
  );
}

/**
 * Connect a USB scale and pull its settled weight into a weight field. Renders nothing where the browser cannot read
 * a scale, so the typed field stays the whole story there.
 */
export function ScaleWeight({ onUse, size = "sm" }: { onUse: (weightOz: number) => void; size?: "sm" | "lg" }) {
  const scale = useScale();
  if (!scale.supported) return null;
  const buttonClass = size === "lg" ? "h-11" : undefined;
  if (!scale.device) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="outline" className={buttonClass} disabled={scale.connecting} onClick={() => void scale.connect()}>
          <Scale className="size-4" />
          {scale.connecting ? "Connecting…" : "Connect scale"}
        </Button>
        {scale.error ? <span className="text-xs text-tone-warning">{scale.error}</span> : null}
      </div>
    );
  }
  const oz = labelOunces(scale.reading);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Scale className="size-4 text-muted-foreground" aria-hidden />
      <ScaleReadout />
      <Button
        size="sm"
        variant="outline"
        className={buttonClass}
        disabled={oz === null}
        title={oz === null ? "Wait for the scale to settle on a weight" : `Fills in ${oz} oz, rounded up to the next ounce`}
        onClick={() => {
          if (oz !== null) onUse(oz);
        }}
      >
        Use scale weight
      </Button>
    </div>
  );
}
