import { useCallback, useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { scanFieldInputMode } from "@/domain/scanner-input";
import { useScanner } from "./ScannerProvider";

/** Shared keyboard and focus behavior for the floor's scan fields. */
export function useScannerInput(ref: RefObject<HTMLInputElement | null>) {
  const scanner = useScanner();
  const accessory = scanner.inputMode === "accessory";
  const [manualEntry, setManualEntry] = useState(false);
  const [focused, setFocused] = useState(false);

  const focus = useCallback(() => {
    const input = ref.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [ref]);

  const safeFocus = useCallback(() => {
    const active = document.activeElement;
    if (active !== ref.current && (
      (active instanceof HTMLElement && active.isContentEditable) ||
      active?.closest("input, textarea, select, [role='dialog']")
    )) {
      return;
    }
    focus();
  }, [focus, ref]);

  useEffect(() => {
    setManualEntry(false);
    const input = ref.current;
    if (input) input.inputMode = accessory ? "none" : "text";
    if (accessory) {
      // Changing the attribute alone does not always dismiss an already-open iPad keyboard.
      if (document.activeElement === input) input?.blur();
      safeFocus();
    }
  }, [accessory, ref, safeFocus]);

  const toggleManualEntry = useCallback(() => {
    const next = !manualEntry;
    setManualEntry(next);
    const input = ref.current;
    if (!input) return;
    // Update during the tap gesture so iPad can open its keyboard immediately.
    input.inputMode = next ? "text" : "none";
    if (!next) input.blur();
    focus();
  }, [manualEntry, ref, focus]);

  return {
    accessory,
    manualEntry,
    focused,
    inputMode: scanFieldInputMode(scanner.inputMode, manualEntry),
    setMode: scanner.setInputMode,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      // Holding Enter or confirming IME composition must not post another scan or shipment.
      if (event.key === "Enter" && (event.repeat || event.nativeEvent.isComposing)) event.preventDefault();
    },
    focus,
    safeFocus,
    toggleManualEntry,
  };
}

export type ScannerInputState = ReturnType<typeof useScannerInput>;
