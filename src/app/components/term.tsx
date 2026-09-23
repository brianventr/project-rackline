import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useSession } from "@/app/session";
import type { Me } from "@/app/api";
import { glossaryEntry, glossaryPathFor, type GlossaryEntry } from "@/domain/glossary";
import { isGarageMode } from "@/domain/operating-mode";
import { cn } from "@/lib/utils";

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 200;

const warned = new Set<string>();

function useOptionalSession(): Me | null {
  try {
    return useSession();
  } catch {
    return null;
  }
}

/** The page behind "Learn more", or null when there is none this person can open. */
export function useGlossaryPath(entry: GlossaryEntry | undefined): string | null {
  const me = useOptionalSession();
  if (!entry || !me) return null;
  return glossaryPathFor(entry, { role: me.role, garage: isGarageMode(me.organization.operatingMode) });
}

/**
 * A warehouse word with a plain-language definition behind it. Hover, keyboard focus, or a tap
 * opens a small card; Enter or a click pins it. Unknown ids render the text as is.
 *
 * `<Term id="atp" />` shows "ATP"; `<Term id="fefo">earliest expiry first</Term>` keeps your words.
 */
export function Term({ id, children, className }: { id: string; children?: ReactNode; className?: string }): JSX.Element {
  const entry = glossaryEntry(id);
  if (!entry) {
    if (import.meta.env.DEV && !warned.has(id)) {
      warned.add(id);
      console.warn(`Term: no glossary entry for "${id}".`);
    }
    return <>{children ?? id}</>;
  }
  return (
    <TermCard entry={entry} className={className}>
      {children ?? entry.term}
    </TermCard>
  );
}

type OpenedBy = "hover" | "focus" | "press";

function TermCard({ entry, className, children }: { entry: GlossaryEntry; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openedBy = useRef<OpenedBy | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** A mouse or finger is down on the word, so the focus that follows is not keyboard focus. */
  const pointerDown = useRef(false);
  /** We are moving focus back to the word ourselves; do not treat it as a new keyboard focus. */
  const quietFocus = useRef(false);
  /** Focus is inside the card (keyboard users reach "Learn more" there). */
  const focusInCard = useRef(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardId = useId();
  const textId = useId();
  const path = useGlossaryPath(entry);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function clearTimer() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }

  function later(run: () => void, ms: number) {
    clearTimer();
    timer.current = window.setTimeout(run, ms);
  }

  function show(by: OpenedBy) {
    clearTimer();
    openedBy.current = by;
    setOpen(true);
  }

  function hide() {
    clearTimer();
    openedBy.current = null;
    setOpen(false);
  }

  function focusCard() {
    window.requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card) return;
      const target = card.querySelector<HTMLElement>("a[href]") ?? card;
      target.focus();
    });
  }

  function returnFocus() {
    quietFocus.current = true;
    triggerRef.current?.focus();
  }

  /** Click, tap, Enter, or Space. Pins a hover/focus card; otherwise toggles. */
  function press(fromKeyboard: boolean) {
    if (open && openedBy.current !== "press") {
      openedBy.current = "press";
      if (fromKeyboard) focusCard();
      return;
    }
    if (open) {
      hide();
      return;
    }
    show("press");
    if (fromKeyboard) focusCard();
  }

  function onPointerEnter(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    if (open) {
      if (openedBy.current === "hover") clearTimer();
      return;
    }
    later(() => show("hover"), HOVER_OPEN_MS);
  }

  function onPointerLeave(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    if (!open) clearTimer();
    else if (openedBy.current === "hover") later(hide, HOVER_CLOSE_MS);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    press(true);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) hide();
      }}
    >
      <PopoverAnchor asChild>
        <span
          ref={triggerRef}
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? cardId : undefined}
          aria-describedby={open ? textId : undefined}
          data-slot="term"
          className={cn(
            "relative cursor-help rounded-[2px] underline decoration-muted-foreground/70 decoration-dotted decoration-1 underline-offset-[3px] outline-none transition-colors",
            "hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            // An invisible hit area at least 44x44, centered on the word, so a finger can hit a short word like "ATP".
            "after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-[max(100%,2.75rem)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
            open && "decoration-foreground",
            className,
          )}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onPointerDown={() => {
            pointerDown.current = true;
          }}
          onPointerCancel={() => {
            pointerDown.current = false;
          }}
          onFocus={() => {
            if (quietFocus.current) {
              quietFocus.current = false;
              return;
            }
            if (pointerDown.current || open) return;
            show("focus");
          }}
          onBlur={(event) => {
            pointerDown.current = false;
            const next = event.relatedTarget as Node | null;
            if (next && cardRef.current?.contains(next)) return;
            if (openedBy.current === "focus") hide();
          }}
          onClick={(event) => {
            // Terms sit inside clickable rows and labels; the tap is for the definition only.
            event.preventDefault();
            event.stopPropagation();
            const fromKeyboard = !pointerDown.current && event.detail === 0;
            pointerDown.current = false;
            press(fromKeyboard);
          }}
          onKeyDown={onKeyDown}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        ref={cardRef}
        id={cardId}
        side="top"
        align="start"
        collisionPadding={12}
        aria-label={entry.term}
        tabIndex={-1}
        className="w-[min(18rem,calc(100vw-2rem))] p-3 text-sm outline-none motion-reduce:animate-none"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (focusInCard.current) {
            focusInCard.current = false;
            returnFocus();
          }
        }}
        onInteractOutside={(event) => {
          // The word itself toggles the card; do not let Radix close it first.
          if (triggerRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch" && openedBy.current === "hover") clearTimer();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch" && openedBy.current === "hover") later(hide, HOVER_CLOSE_MS);
        }}
        onFocus={() => {
          focusInCard.current = true;
          if (openedBy.current !== "press") openedBy.current = "press";
        }}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          focusInCard.current = Boolean(next && cardRef.current?.contains(next));
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            // The card is portaled to the end of the page; send focus back to the word instead.
            event.preventDefault();
            hide();
            returnFocus();
          }
        }}
      >
        <p className="font-medium leading-snug text-foreground">{entry.term}</p>
        <p id={textId} className="mt-1 leading-snug text-muted-foreground">
          {entry.short}
        </p>
        {path ? (
          <Link
            to={path}
            className="-mb-2.5 mt-0.5 flex min-h-11 w-fit items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
            onClick={() => {
              focusInCard.current = false;
              hide();
            }}
          >
            Learn more
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
