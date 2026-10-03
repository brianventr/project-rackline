import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "@/app/session";
import { homePath } from "@/app/warehouse";
import { CAD_LAB_PATH } from "@/domain/lab-path";
import { cn } from "@/lib/utils";

/**
 * A plain "?" block at the far end of the top bar. It opens the hidden lab (and closes it again);
 * nothing else in the app links there, and it is not drawn where the lab is closed (the demo login).
 */
export function MysteryButton() {
  const navigate = useNavigate();
  const me = useSession();
  const inLab = useLocation().pathname === CAD_LAB_PATH;
  if (!me.lab) return null;
  return (
    <button
      type="button"
      aria-label={inLab ? "Leave the lab" : "Mystery"}
      onClick={() => navigate(inLab ? homePath(me.role, me.organization.operatingMode) : CAD_LAB_PATH)}
      className={cn(
        "mystery-block grid size-8 shrink-0 place-items-center rounded-full outline-none transition-colors",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        inLab ? "bg-primary/10 text-primary" : "text-muted-foreground/45 hover:bg-primary/10 hover:text-primary",
      )}
    >
      <MysteryBlockIcon className="mystery-glyph size-[18px]" filled={inLab} />
    </button>
  );
}

function MysteryBlockIcon({ className, filled }: { className?: string; filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="3.5" stroke="currentColor" strokeWidth="1.6" fill={filled ? "currentColor" : "none"} fillOpacity={filled ? 0.14 : 0} />
      <circle cx="6.6" cy="6.6" r="0.85" fill="currentColor" />
      <circle cx="17.4" cy="6.6" r="0.85" fill="currentColor" />
      <circle cx="6.6" cy="17.4" r="0.85" fill="currentColor" />
      <circle cx="17.4" cy="17.4" r="0.85" fill="currentColor" />
      <path
        d="M9.55 9.55a2.5 2.5 0 1 1 3.55 2.27c-.7.33-1.1.86-1.1 1.6v.38"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="16.35" r="1" fill="currentColor" />
    </svg>
  );
}
