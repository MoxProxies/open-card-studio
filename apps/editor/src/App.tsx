import { useCallback, useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { CanvasStage } from "./components/CanvasStage";
import { Toolbar } from "./components/Toolbar";
import { LayerPanel } from "./components/LayerPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { ResizeHandle } from "./components/ResizeHandle";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useFullscreenLightbox } from "./hooks/useFullscreenLightbox";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { Layers as LayersIcon, SlidersHorizontal, X } from "lucide-react";

// Above anything a host page could plausibly stack above it — this is a
// deliberate lightbox, meant to sit on top of the entire page regardless of
// whatever z-indexes the embedding site's own nav/modals use.
const FULLSCREEN_Z_INDEX = 2147483647;

const PANEL_MIN_WIDTH = 180;
const PANEL_MAX_WIDTH = 520;
// The card/working area is flex:1 (takes whatever's left), so only the two
// side panels need explicit widths. Properties panel defaults wider than
// layers — its two-column numeric fields are what overflowed before
// cs-input had width:100%; keeping the default roomy avoids reintroducing
// that by accident on a narrower browser window. Layer panel widened from
// 220 for grouping (LayerPanel.tsx): a group header row's drag handle +
// folder icon + name + visible/lock/ungroup/delete buttons is
// meaningfully wider than a plain layer row ever was — 220 truncated
// almost every label down to a couple of characters.
const DEFAULT_LAYER_PANEL_WIDTH = 260;
const DEFAULT_PROPERTIES_PANEL_WIDTH = 300;

const clamp = (value: number) => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, value));

export function App() {
  const stageRef = useRef<Konva.Stage>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [layerPanelWidth, setLayerPanelWidth] = useState(DEFAULT_LAYER_PANEL_WIDTH);
  const [propertiesPanelWidth, setPropertiesPanelWidth] = useState(DEFAULT_PROPERTIES_PANEL_WIDTH);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // On a phone the three-pane layout doesn't fit, so the two side panels
  // become one bottom sheet with a segmented control — the pattern every
  // mobile design tool converges on, because the canvas is the thing you
  // need to see and the panels are what you dip into.
  const narrow = useIsNarrow();
  const [sheet, setSheet] = useState<"layers" | "properties" | null>(null);
  useKeyboardShortcuts();
  useFullscreenLightbox(
    isFullscreen,
    useCallback(() => setIsFullscreen(false), [])
  );

  // Lets the host page react to the lightbox toggling — most importantly,
  // temporarily ducking its own fixed/sticky nav bar out of the way.
  // FULLSCREEN_Z_INDEX above only wins *within* whatever stacking context
  // the host happens to wrap this element in (e.g. a `position: relative;
  // z-index: 20` container) — it says nothing about how that container
  // itself compares to a sibling like a nav bar sitting in a *different*
  // stacking context with its own, possibly higher, z-index, so the
  // lightbox can still end up underneath one despite this z-index. This
  // event's `detail.fullscreen` is the host's cue to sort that out on its
  // own end however it needs to (lower the nav's z-index, hide it, ...).
  // Dispatched on this shadow-tree node with composed:true so it crosses
  // the shadow boundary — event.target is retargeted to
  // <card-studio-editor> itself for any listener outside this tree, same
  // as embed.ts's own "design-change".
  useEffect(() => {
    rootRef.current?.dispatchEvent(
      new CustomEvent("fullscreen-change", { detail: { fullscreen: isFullscreen }, bubbles: true, composed: true })
    );
  }, [isFullscreen]);

  return (
    <div
      ref={rootRef}
      className="cs-root"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "system-ui, sans-serif",
        // position:fixed escapes whatever height/width the host page's own
        // layout constrains the embed to (see embed.ts) — a shadow root
        // doesn't create a new containing block for fixed positioning, so
        // this covers the real viewport regardless of how the custom
        // element itself is sized on the page.
        ...(isFullscreen ? { position: "fixed" as const, inset: 0, zIndex: FULLSCREEN_Z_INDEX } : {}),
      }}
    >
      <Toolbar stageRef={stageRef} isFullscreen={isFullscreen} onToggleFullscreen={() => setIsFullscreen((v) => !v)} />

      {narrow ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} data-testid="editor-narrow">
          <div style={{ flex: 1, minHeight: 0 }}>
            <CanvasStage stageRef={stageRef} />
          </div>

          {sheet && (
            <div
              data-testid="editor-sheet"
              style={{
                // Capped so the canvas never disappears entirely behind
                // the sheet — you have to be able to see what you're editing.
                height: "min(46vh, 380px)",
                borderTop: "1px solid var(--cs-border)",
                background: "var(--cs-surface)",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", padding: "6px 8px", borderBottom: "1px solid var(--cs-border)", flex: "none" }}>
                <span className="cs-heading" style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                  {sheet === "layers" ? "Layers" : "Properties"}
                </span>
                <button className="cs-icon-btn" onClick={() => setSheet(null)} title="Close" data-testid="editor-sheet-close">
                  <X size={16} />
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex" }}>
                {/* width="100%" rather than a pixel width: the panels take
                    a number for the desktop resizable columns, but here they
                    just fill the sheet. */}
                {sheet === "layers" ? <LayerPanel width="100%" /> : <PropertiesPanel width="100%" />}
              </div>
            </div>
          )}

          <div style={{ display: "flex", borderTop: "1px solid var(--cs-border)", flex: "none", background: "var(--cs-surface)" }} data-testid="editor-sheet-tabs">
            {([
              ["layers", "Layers", <LayersIcon key="l" size={18} />],
              ["properties", "Properties", <SlidersHorizontal key="p" size={18} />],
            ] as const).map(([key, label, icon]) => (
              <button
                key={key}
                data-testid={`editor-sheet-${key}`}
                data-active={sheet === key}
                onClick={() => setSheet((current) => (current === key ? null : key))}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  minHeight: 48,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: sheet === key ? "var(--cs-accent)" : "var(--cs-text-muted)",
                  fontSize: 12,
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CanvasStage stageRef={stageRef} />
          </div>

          {/* Each handle owns the panel to its right: dragging right shrinks
              that panel (and grows whatever's to the left); dragging left
              grows it. The canvas area (flex:1) absorbs the difference. */}
          <ResizeHandle onDrag={(dx) => setLayerPanelWidth((w) => clamp(w - dx))} />
          <LayerPanel width={layerPanelWidth} />

          <ResizeHandle onDrag={(dx) => setPropertiesPanelWidth((w) => clamp(w - dx))} />
          <PropertiesPanel width={propertiesPanelWidth} />
        </div>
      )}
    </div>
  );
}
