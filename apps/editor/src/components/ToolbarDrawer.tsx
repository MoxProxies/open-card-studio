import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, ChevronDown } from "lucide-react";
import { useRegisterModal } from "../modalStack";

interface ToolbarDrawerProps {
  onClose: () => void;
  children: ReactNode;
}

/**
 * The narrow-toolbar hamburger menu's sliding sidebar (see Toolbar.tsx's
 * narrow branch). Structurally this is the fix for TextTemplateMenu.tsx's
 * old clipping bug, not a patch on top of it: the narrow toolbar used to be
 * a horizontally-scrolling row (`overflowX: auto`) with several
 * independent `position: absolute` popups (TextTemplateMenu chief among
 * them) living *inside* that scrolling row — and a CSS `overflow` other
 * than `visible` on an ancestor clips every descendant that visually
 * extends past its box, regardless of the descendant's own z-index, which
 * only resolves stacking order between siblings that are already visible.
 * Every one of those popups is now a section of this drawer instead
 * (DrawerSection below) — ordinary in-flow content inside a plain
 * `overflowY: auto` panel, never `position: absolute` — so there is no
 * clipping ancestor left to clip anything.
 *
 * `position: fixed`, not sequenced after the toolbar in normal flow: that's
 * what lets it sit above the canvas without pushing it down or being
 * clipped by anything *this* has as an ancestor in turn (App.tsx's
 * fullscreen lightbox included). z-index 900 — under Modal.tsx's 1000/1001
 * (a drawer item that opens a modal must still end up underneath it) but
 * the narrow toolbar's own persistent row (Toolbar.tsx) sits at 901 so it
 * stays visible and usable — Undo/Redo/Duplicate/Delete included — while
 * the drawer is open, per the "always one tap away" call in Toolbar.tsx.
 */
export function ToolbarDrawer({ onClose, children }: ToolbarDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isTopmost = useRegisterModal();
  // Slides in on mount rather than starting in its resting position —
  // flipped a frame after mount so the initial (offscreen) state actually
  // paints before the transition to the open one starts.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Same ref-read-latest pattern as Modal.tsx, for the same reason: a
  // window listener registered once must still call whatever onClose the
  // most recent render closed over.
  const latestOnClose = useRef(onClose);
  latestOnClose.current = onClose;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmost()) latestOnClose.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isTopmost]);

  return (
    <div
      className="cs-root"
      data-testid="toolbar-drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--cs-backdrop)",
        opacity: entered ? 1 : 0,
        transition: "opacity 180ms ease",
        zIndex: 900,
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="toolbar-drawer"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: "min(320px, 86vw)",
          background: "var(--cs-surface)",
          borderLeft: "1px solid var(--cs-border)",
          boxShadow: "0 0 32px var(--cs-shadow)",
          display: "flex",
          flexDirection: "column",
          // Slides in from the right, matching the hamburger button that
          // opens it now sitting at the right end of the persistent bar
          // (Toolbar.tsx) rather than the left.
          transform: entered ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms ease",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--cs-border)", flex: "none" }}>
          <span className="cs-heading" style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>
            Tools
          </span>
          <button className="cs-icon-btn" onClick={onClose} title="Close menu" data-testid="toolbar-drawer-close">
            <X size={19} />
          </button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: 8 }}>{children}</div>
      </div>
    </div>
  );
}

interface DrawerSectionProps {
  /** Suffixes `toolbar-drawer-section-` for this header's data-testid. */
  id: string;
  label: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * One collapsible group inside the drawer (Insert/View/File — see
 * Toolbar.tsx) — or, nested one level deeper, the old "Text Fields"
 * dropdown's replacement inside Insert. Plain in-flow content, expand/
 * collapse only ever changes what's rendered, never how it's positioned —
 * exactly what keeps this immune to the clipping bug the old floating
 * popups had.
 */
export function DrawerSection({ id, label, icon, defaultOpen = false, children }: DrawerSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: 2 }}>
      <button
        type="button"
        className="cs-btn"
        onClick={() => setOpen((o) => !o)}
        data-testid={`toolbar-drawer-section-${id}`}
        data-expanded={open}
        style={{ width: "100%", justifyContent: "flex-start", border: "none", background: "transparent", fontWeight: 600 }}
      >
        {icon}
        <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
        <ChevronDown size={16} style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 150ms ease", flex: "none" }} />
      </button>
      {open && (
        <div data-testid={`toolbar-drawer-section-${id}-panel`} style={{ padding: "2px 2px 10px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Shared style for a full-width row button inside a drawer section —
 * every item that used to be its own icon-only or icon+label toolbar
 * button becomes one of these: a full row, icon and label both always
 * visible, instead of relying on a hover/long-press title for icon-only
 * buttons or letting a label wrap awkwardly in a cramped scrolling row
 * (the "button text wraps badly" half of the original bug report). */
export const drawerRowStyle = { width: "100%", justifyContent: "flex-start" as const };
