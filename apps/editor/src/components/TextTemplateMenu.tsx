import { useEffect, useRef, useState } from "react";
import { LayoutTemplate, ChevronDown } from "lucide-react";
import type { TextFieldTemplate } from "../textTemplates";

interface TextTemplateMenuProps {
  /** The field set to list — already resolved for the design's current
   * frame category (or the base/default set if none applies), see
   * Toolbar.tsx. */
  templates: TextFieldTemplate[];
  onAdd: (template: TextFieldTemplate) => void;
  onAddAll: () => void;
}

/** Toolbar dropdown for inserting the standard MTG text fields (title,
 * mana cost, typeline, ...) at their pre-set positions — either one at a
 * time or all at once. */
export function TextTemplateMenu({ templates, onAdd, onAddAll }: TextTemplateMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      // e.target, not composedPath()[0]: inside the embed (rendered into a
      // shadow root — see embed.ts), a listener attached to window sits
      // *outside* the shadow boundary, so any event that originated inside
      // it gets retargeted — e.target becomes the shadow host
      // (<card-studio-editor> itself), never the actual button that was
      // clicked. rootRef.current.contains(e.target) is then always false,
      // even for a click on a menu item, so the menu closed itself (on
      // mousedown, before the click that would've fired onAdd/onAddAll)
      // on every single interaction — "Add all fields" silently doing
      // nothing, only inside the embed, never in the standalone app (no
      // shadow root there, so e.target was never retargeted to begin
      // with). composedPath()[0] is the real innermost target regardless
      // of shadow boundaries, exactly what this check needs.
      const target = (e.composedPath()[0] ?? e.target) as Node;
      if (rootRef.current && !rootRef.current.contains(target)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button className="cs-btn" onClick={() => setOpen((o) => !o)}>
        <LayoutTemplate size={19} /> Text Fields <ChevronDown size={17} />
      </button>

      {open && (
        <div
          className="cs-root"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "var(--cs-surface)",
            border: "1px solid var(--cs-border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px var(--cs-shadow)",
            minWidth: 190,
            zIndex: 1000,
            padding: 4,
          }}
        >
          <button
            className="cs-btn"
            style={{ width: "100%", justifyContent: "flex-start", border: "none", fontWeight: 600 }}
            onClick={() => {
              onAddAll();
              setOpen(false);
            }}
          >
            Add all fields
          </button>
          <div style={{ height: 1, background: "var(--cs-border)", margin: "4px 0" }} />
          {templates.map((template) => (
            <button
              key={template.id}
              className="cs-btn"
              style={{ width: "100%", justifyContent: "flex-start", border: "none" }}
              onClick={() => {
                onAdd(template);
                setOpen(false);
              }}
            >
              {template.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
