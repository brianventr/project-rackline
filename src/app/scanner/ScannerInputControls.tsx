import { Keyboard, ScanLine, Tablet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScanner } from "./ScannerProvider";

/** Configure input, without claiming a physical keyboard scanner is connected. */
export function ScannerInputControls() {
  const scanner = useScanner();
  const accessory = scanner.inputMode === "accessory";
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Scanner input mode" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {([
          { mode: "touch", label: "Touch & camera", Icon: Tablet },
          { mode: "accessory", label: "Scanner accessory", Icon: ScanLine },
        ] as const).map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={scanner.inputMode === mode}
            onClick={() => scanner.setInputMode(mode)}
            className={cn(
              "flex min-h-12 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
              scanner.inputMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="flex items-start gap-2 text-sm">
        <Keyboard className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{accessory ? "Accessory mode enabled" : "Choose how you scan"}</p>
          <p className="text-muted-foreground">
            {accessory
              ? "Set your case, USB, or Bluetooth reader to keyboard mode with Enter after each barcode. The on-screen keyboard stays tucked away."
              : "Use the camera or type a barcode. Have a scanner case? Enable accessory mode to keep the screen clear."}
          </p>
          <p className="text-xs text-muted-foreground" role="status">
            {scanner.lastScan
              ? `Last scan received at ${new Date(scanner.lastScan.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
              : accessory
                ? "Scan a label to test input. Connection status is managed by your device."
                : "Keyboard scanners also work automatically when you are outside an editing field."}
          </p>
        </div>
      </div>
    </div>
  );
}
