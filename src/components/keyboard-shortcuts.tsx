"use client";

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GO_SHORTCUTS, INITIAL_SHORTCUT_STATE, readShortcut, type ShortcutState } from "@/domain/shortcuts";
import { garageAllowsPath } from "@/domain/operating-mode";

function inField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=dialog]");
}

/** `g` + key to jump, `/` to search, `?` for the cheat sheet. Office screens only; scanner bursts never trigger it. */
export function useGlobalShortcuts({
  enabled,
  garage,
  owner,
  onSearch,
  onHelp,
}: {
  enabled: boolean;
  garage: boolean;
  owner: boolean;
  onSearch: () => void;
  onHelp: () => void;
}) {
  const navigate = useNavigate();
  const state = useRef<ShortcutState>(INITIAL_SHORTCUT_STATE);
  const handlers = useRef({ onSearch, onHelp });
  handlers.current = { onSearch, onHelp };

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.key.length !== 1) return;
      const result = readShortcut(state.current, {
        key: event.key,
        now: event.timeStamp || performance.now(),
        inField: inField(event.target),
        modifier: event.metaKey || event.ctrlKey || event.altKey,
      });
      state.current = result.state;
      if (result.search) {
        event.preventDefault();
        handlers.current.onSearch();
      } else if (result.help) {
        event.preventDefault();
        handlers.current.onHelp();
      } else if (result.go) {
        if (result.go === "/setup" && !owner) return;
        if (garage && !garageAllowsPath(result.go)) return;
        event.preventDefault();
        navigate(result.go);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, garage, owner, navigate]);
}

function Key({ children }: { children: string }) {
  return <kbd className="inline-flex min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs">{children}</kbd>;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
  garage,
  owner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  garage: boolean;
  owner: boolean;
}) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const jumps = Object.entries(GO_SHORTCUTS).filter(
    ([, target]) => (owner || target.path !== "/setup") && (!garage || garageAllowsPath(target.path)),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work from anywhere in the office. A barcode gun never triggers these.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Anywhere</p>
            <div className="flex items-center justify-between">
              <span>Search and commands</span>
              <span className="flex gap-1">
                <Key>{mac ? "⌘" : "Ctrl"}</Key>
                <Key>K</Key>
                <span className="px-1 text-muted-foreground">or</span>
                <Key>/</Key>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>This cheat sheet</span>
              <Key>?</Key>
            </div>
          </section>
          <section className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Go to</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {jumps.map(([key, target]) => (
                <div key={key} className="flex items-center justify-between">
                  <span>{target.label}</span>
                  <span className="flex gap-1">
                    <Key>g</Key>
                    <Key>{key}</Key>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
