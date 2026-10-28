import { Keyboard, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScannerInputState } from "./useScannerInput";

/** Place inside an existing wrapping flex row of scan actions. Contains no form. */
export function ScannerFieldControls({ input, showModeControl = true }: { input: ScannerInputState; showModeControl?: boolean }) {
  return (
    <>
      {input.accessory ? (
        <Button type="button" variant="secondary" className="h-11 w-44 shrink-0" disabled={input.focused} onClick={input.focus}>
          <ScanLine className="mr-1 size-4" aria-hidden="true" />
          {input.focused ? "Scan field active" : "Resume scanning"}
        </Button>
      ) : null}
      {input.accessory ? (
        <Button type="button" variant="secondary" className="h-11" aria-pressed={input.manualEntry} onClick={input.toggleManualEntry}>
          <Keyboard className="mr-1 size-4" aria-hidden="true" />
          {input.manualEntry ? "Return to scanner" : "Type instead"}
        </Button>
      ) : null}
      {showModeControl ? (
        <Button type="button" variant="ghost" className="h-11" onClick={() => input.setMode(input.accessory ? "touch" : "accessory")}>
          {input.accessory ? "Use touch input" : "Use scanner accessory"}
        </Button>
      ) : null}
    </>
  );
}

export function ScannerFieldStatus({ input, ready = true }: { input: ScannerInputState; ready?: boolean }) {
  return (
    <p className="text-xs text-muted-foreground" role="status">
      {!ready
        ? "Loading work. Scans will wait until this screen is ready."
        : input.accessory && !input.manualEntry
          ? input.focused
            ? "Ready for keyboard scans. Configure your reader to finish with Enter."
            : "Scan field is paused. Tap Resume scanning when you are ready."
          : "Type a barcode and press Enter, or use the camera."}
    </p>
  );
}
