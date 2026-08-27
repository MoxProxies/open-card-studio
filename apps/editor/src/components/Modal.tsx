import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { useRegisterModal } from "../modalStack";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Fixed strip under the title bar — filters, tabs, a save row. Stays
   * put while `children` scrolls. */
  toolbar?: ReactNode;
  /** Sticky footer below the scrolling body (buttons). */
  footer?: ReactNode;
  /** Panel width; anything valid for CSS `width`. */
  width?: string;
  /** Renders the panel as a <form> — submit fires this instead of a click handler. */
  onSubmit?: () => void;
  /** False blocks Escape, the backdrop click, and the X (AiArtModal mid-generation). */
  dismissable?: boolean;
  /** True when this modal is opened *on top of* another one: it takes the
   * higher z-index, and the modal underneath skips its own Escape handler
   * so one press closes only the top one. */
  stacked?: boolean;
  /** The backdrop node, for a caller that dispatches DOM events from its
   * own root (aiArtBridge.ts) rather than calling an API directly. */
  rootRef?: RefObject<HTMLDivElement>;
  /** data-testid for the panel. */
  testId?: string;
}

/**
 * The one modal shell — backdrop, centered panel, title bar with an X,
 * Escape-to-close, click-outside-to-close, scrolling body, optional
 * sticky footer. Every dialog in the editor is built from this; before
 * it existed each one hand-rolled the same six things slightly
 * differently.
 *
 * Focus moves to the panel on mount. That's the usual accessibility
 * reason, and also a real bug fix: Escape is a plain window listener, and
 * with focus left on whatever toolbar button opened the dialog, the first
 * press could land before the dialog's own handler saw it.
 */
export function Modal({
  title,
  onClose,
  children,
  toolbar,
  footer,
  width = "min(480px, 92vw)",
  onSubmit,
  dismissable = true,
  stacked = false,
  rootRef,
  testId,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement & HTMLFormElement>(null);
  const isTopmost = useRegisterModal();

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // The latest onClose/dismissable, read through a ref so the listener
  // below can register once and never churn. Re-registering it on every
  // render (onClose is usually an inline arrow) is what let a re-render
  // triggered *by the keypress itself* remove the listener before the
  // browser reached it — see modalStack.ts.
  const latest = useRef({ onClose, dismissable });
  latest.current = { onClose, dismissable };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only the topmost dialog reacts, so Escape peels one layer off a
      // stack instead of collapsing the whole thing.
      if (e.key === "Escape" && latest.current.dismissable && isTopmost()) latest.current.onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isTopmost]);

  const Panel = (onSubmit ? "form" : "div") as "div";

  return (
    <div
      ref={rootRef}
      className="cs-root"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--cs-backdrop)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: stacked ? 1001 : 1000,
      }}
    >
      <Panel
        ref={panelRef}
        data-testid={testId}
        tabIndex={-1}
        {...(onSubmit
          ? {
              onSubmit: (e: { preventDefault: () => void }) => {
                e.preventDefault();
                onSubmit();
              },
            }
          : {})}
        style={{
          background: "var(--cs-surface)",
          borderRadius: 12,
          width,
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 50px var(--cs-shadow)",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid var(--cs-border)",
            flex: "none",
          }}
        >
          <h2 className="cs-heading" style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>
            {title}
          </h2>
          <button type="button" className="cs-icon-btn" onClick={onClose} disabled={!dismissable} title="Close">
            <X size={16} />
          </button>
        </div>

        {toolbar && (
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--cs-border)",
              alignItems: "center",
              flexWrap: "wrap",
              flex: "none",
            }}
          >
            {toolbar}
          </div>
        )}

        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>{children}</div>

        {footer && (
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              padding: "12px 16px",
              borderTop: "1px solid var(--cs-border)",
              flex: "none",
            }}
          >
            {footer}
          </div>
        )}
      </Panel>
    </div>
  );
}
