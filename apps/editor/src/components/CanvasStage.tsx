import { useEffect, useRef, useState, type RefObject } from "react";
import { Stage, Layer as KonvaLayer, Group, Rect, Line, Transformer } from "react-konva";
import type Konva from "konva";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import type { Layer } from "@card-studio/scene-schema";
import { useDesignStore } from "../store/DesignProvider";
import { MIN_ZOOM, MAX_ZOOM } from "../store/designStore";
import { mmToStagePx } from "../geometry";
import { isTypingTarget } from "../isTypingTarget";
import { LayerNode } from "./LayerNode";

const SNAP_THRESHOLD_PX = 6;
const CLICK_DRAG_THRESHOLD_PX = 3;
const FIT_MARGIN_PX = 40;
const WHEEL_ZOOM_SPEED = 0.0015;
const BUTTON_ZOOM_STEP = 1.2;
// "R3" die-cut corner radius — the standard rounding trading-card stock is
// trimmed to. Only used when showBleed is off, to preview how the card
// looks post-trim; the bleed box itself (and the print export, which reads
// the design JSON directly rather than this canvas) always stays sharp-
// cornered, since a printer needs the full rectangular bleed to trim from.
const BLEED_MASK_CORNER_RADIUS_MM = 2.5;

/** Draws a rounded-rect path on a Konva clipFunc's context (or any
 * canvas-2D-shaped context) — moveTo/arcTo/closePath rather than the
 * newer ctx.roundRect, since Konva.Context only proxies the older API. */
function roundedRectPath(ctx: { moveTo: (x: number, y: number) => void; arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) => void; closePath: () => void }, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

type Guide = { points: number[] };
type MarqueeRect = { x: number; y: number; width: number; height: number };
type PanDrag = { startClientX: number; startClientY: number; startPanX: number; startPanY: number };

/** The card canvas: renders every scene layer, cut-line and safe-area
 * guides, marquee (rubber-band) multi-select, alignment/snap guides while
 * dragging, a shared Transformer bound to the current selection, and
 * pan/zoom over an otherwise-fixed-resolution card.
 *
 * The Stage itself is sized to the *viewport* (this component's own
 * container, tracked via ResizeObserver) and never scaled — all card
 * content lives inside a single Group that carries the pan/zoom transform.
 * Scaling the Stage directly would have re-introduced the old handle-
 * clipping bug: a canvas element's own pixel bounds still clip whatever's
 * drawn beyond them regardless of an internal transform, so the "camera"
 * has to be the thing that's viewport-sized, not the card. */
export function CanvasStage({ stageRef }: { stageRef: RefObject<Konva.Stage> }) {
  const design = useDesignStore((s) => s.design);
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds);
  const showSafeArea = useDesignStore((s) => s.showSafeArea);
  const showBleed = useDesignStore((s) => s.showBleed);
  const selectOnly = useDesignStore((s) => s.selectOnly);
  const toggleSelect = useDesignStore((s) => s.toggleSelect);
  const setSelection = useDesignStore((s) => s.setSelection);
  const clearSelection = useDesignStore((s) => s.clearSelection);
  const commitLayerChanges = useDesignStore((s) => s.commitLayerChanges);
  const zoom = useDesignStore((s) => s.zoom);
  const panX = useDesignStore((s) => s.panX);
  const panY = useDesignStore((s) => s.panY);
  const setZoom = useDesignStore((s) => s.setZoom);
  const setPan = useDesignStore((s) => s.setPan);
  const panBy = useDesignStore((s) => s.panBy);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentGroupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [nodeRefs] = useState(() => new Map<string, Konva.Node>());
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const marqueeStart = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  // Mirrors marqueeRect synchronously: mousedown+mouseup can both fire before React
  // re-renders (they're native Konva listeners, not batched together), so reading
  // the *state* value from inside handleStageMouseUp risks seeing the pre-gesture
  // value. The ref is always current; marqueeRect (state) exists only to render the
  // live selection-box overlay.
  const marqueeRectRef = useRef<MarqueeRect | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panDragRef = useRef<PanDrag | null>(null);
  const hasFramedRef = useRef(false);

  // Canvas text doesn't automatically repaint when a @font-face it depends
  // on finishes loading — react-konva only redraws in response to React
  // prop changes, and font loading is async and outside that loop. Without
  // this, text can render in the browser's fallback font on first paint
  // and only pick up the real embedded font on the next unrelated redraw.
  useEffect(() => {
    const redraw = () => stageRef.current?.batchDraw();
    document.fonts.ready.then(redraw);
    document.fonts.addEventListener("loadingdone", redraw);
    return () => document.fonts.removeEventListener("loadingdone", redraw);
  }, [stageRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Space-to-pan, matching Figma/Photoshop convention. Layers themselves
  // stop being draggable while held (see LayerNode's panModeActive), so a
  // space+drag never fights with Konva's own node-dragging underneath it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e)) setSpaceHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const widthPx = mmToStagePx(design.size.widthMm);
  const heightPx = mmToStagePx(design.size.heightMm);

  // Cut line and safe area are both centered within the full-bleed canvas
  // (widthPx/heightPx), so each is just an even inset computed from its own
  // size — see STANDARD_CARD_SIZE_MM for why the safe-area inset differs
  // between axes (it's asymmetric in the source print spec, not a bug).
  const cutWidthPx = mmToStagePx(design.size.cutWidthMm);
  const cutHeightPx = mmToStagePx(design.size.cutHeightMm);
  const cutInsetXPx = (widthPx - cutWidthPx) / 2;
  const cutInsetYPx = (heightPx - cutHeightPx) / 2;

  const safeWidthPx = mmToStagePx(design.size.safeWidthMm);
  const safeHeightPx = mmToStagePx(design.size.safeHeightMm);
  const safeInsetXPx = (widthPx - safeWidthPx) / 2;
  const safeInsetYPx = (heightPx - safeHeightPx) / 2;

  const bleedMaskCornerRadiusPx = mmToStagePx(BLEED_MASK_CORNER_RADIUS_MM);

  const fitToView = (capAt100: boolean) => {
    if (viewport.width === 0 || viewport.height === 0) return;
    const scaleX = (viewport.width - FIT_MARGIN_PX * 2) / widthPx;
    const scaleY = (viewport.height - FIT_MARGIN_PX * 2) / heightPx;
    let next = Math.min(scaleX, scaleY);
    if (capAt100) next = Math.min(next, 1);
    next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(next);
    setPan((viewport.width - widthPx * next) / 2, (viewport.height - heightPx * next) / 2);
  };

  // Frame the card once, the first time the viewport size is known — after
  // that, pan/zoom is entirely user-driven.
  useEffect(() => {
    if (hasFramedRef.current || viewport.width === 0 || viewport.height === 0) return;
    hasFramedRef.current = true;
    fitToView(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height]);

  const attachTransformer = () => {
    // A locked layer gets no resize/rotate handles at all, not just no
    // drag — the Transformer's own handles are otherwise completely
    // independent of LayerNode's `draggable` prop, so without this a
    // "locked" layer could still be freely resized/rotated on canvas.
    const lockedIds = new Set(design.layers.filter((l) => l.locked).map((l) => l.id));
    const nodes = selectedLayerIds
      .filter((id) => !lockedIds.has(id))
      .map((id) => nodeRefs.get(id))
      .filter((n): n is Konva.Node => !!n);
    const transformer = transformerRef.current;
    if (!transformer) return;
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  };

  useEffect(attachTransformer, [selectedLayerIds, design.layers]);

  function computeSnapAndApply(node: Konva.Node, activeId: string): Guide[] {
    const w = node.width();
    const h = node.height();
    const left = node.x();
    const top = node.y();
    const centerX = left + w / 2;
    const centerY = top + h / 2;

    const targetsX = [0, widthPx / 2, widthPx];
    const targetsY = [0, heightPx / 2, heightPx];
    for (const layer of design.layers) {
      if (layer.id === activeId) continue;
      const bx = mmToStagePx(layer.x);
      const by = mmToStagePx(layer.y);
      const bw = mmToStagePx(layer.width);
      const bh = mmToStagePx(layer.height);
      targetsX.push(bx, bx + bw / 2, bx + bw);
      targetsY.push(by, by + bh / 2, by + bh);
    }

    let bestDx: number | null = null;
    let snapX: number | null = null;
    for (const edge of [left, centerX, left + w]) {
      for (const t of targetsX) {
        const d = t - edge;
        if (Math.abs(d) <= SNAP_THRESHOLD_PX && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) {
          bestDx = d;
          snapX = t;
        }
      }
    }
    let bestDy: number | null = null;
    let snapY: number | null = null;
    for (const edge of [top, centerY, top + h]) {
      for (const t of targetsY) {
        const d = t - edge;
        if (Math.abs(d) <= SNAP_THRESHOLD_PX && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) {
          bestDy = d;
          snapY = t;
        }
      }
    }

    if (bestDx !== null) node.x(node.x() + bestDx);
    if (bestDy !== null) node.y(node.y() + bestDy);

    const nextGuides: Guide[] = [];
    if (snapX !== null) nextGuides.push({ points: [snapX, 0, snapX, heightPx] });
    if (snapY !== null) nextGuides.push({ points: [0, snapY, widthPx, snapY] });
    return nextGuides;
  }

  const handleLayerDragStart = () => {
    dragStartPositions.current.clear();
    for (const id of selectedLayerIds) {
      const node = nodeRefs.get(id);
      if (node) dragStartPositions.current.set(id, { x: node.x(), y: node.y() });
    }
  };

  const handleLayerDragMove = (activeNode: Konva.Node) => {
    const activeId = activeNode.id();
    if (selectedLayerIds.length > 1 && selectedLayerIds.includes(activeId)) {
      const start = dragStartPositions.current.get(activeId);
      if (start) {
        const dx = activeNode.x() - start.x;
        const dy = activeNode.y() - start.y;
        for (const id of selectedLayerIds) {
          if (id === activeId) continue;
          const other = nodeRefs.get(id);
          const otherStart = dragStartPositions.current.get(id);
          if (other && otherStart) {
            other.x(otherStart.x + dx);
            other.y(otherStart.y + dy);
          }
        }
      }
      setGuides([]);
      return;
    }
    setGuides(computeSnapAndApply(activeNode, activeId));
  };

  const handleLayerDragEnd = (activeNode: Konva.Node) => {
    const activeId = activeNode.id();
    const pxPerMm = mmToStagePx(1);
    const ids = selectedLayerIds.includes(activeId) && selectedLayerIds.length > 1 ? selectedLayerIds : [activeId];
    const entries = ids
      .map((id) => nodeRefs.get(id))
      .filter((n): n is Konva.Node => !!n)
      .map((n) => ({ id: n.id(), patch: { x: n.x() / pxPerMm, y: n.y() / pxPerMm } }));
    commitLayerChanges(entries);
    setGuides([]);
  };

  const handleTransformEnd = () => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const pxPerMm = mmToStagePx(1);
    const entries = transformer.nodes().map((node) => {
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      const patch: Partial<Layer> = {
        x: node.x() / pxPerMm,
        y: node.y() / pxPerMm,
        width: (node.width() * scaleX) / pxPerMm,
        height: (node.height() * scaleY) / pxPerMm,
        rotationDeg: node.rotation(),
      };
      return { id: node.id(), patch };
    });
    commitLayerChanges(entries);
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const pointer = stageRef.current?.getPointerPosition();
      if (!pointer) return;
      setZoom(zoom * Math.exp(-e.evt.deltaY * WHEEL_ZOOM_SPEED), pointer);
    } else {
      panBy(-e.evt.deltaX, -e.evt.deltaY);
    }
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    const isMiddlePan = e.evt.button === 1 && e.target === stage;
    if (spaceHeld || isMiddlePan) {
      e.evt.preventDefault();
      panDragRef.current = { startClientX: e.evt.clientX, startClientY: e.evt.clientY, startPanX: panX, startPanY: panY };
      setIsPanning(true);
      return;
    }

    if (!stage || e.target !== stage) return; // a shape handles its own click/select
    const pos = contentGroupRef.current?.getRelativePointerPosition();
    if (!pos) return;
    marqueeStart.current = { x: pos.x, y: pos.y, additive: e.evt.shiftKey };
    marqueeRectRef.current = { x: pos.x, y: pos.y, width: 0, height: 0 };
    setMarqueeRect(marqueeRectRef.current);
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (panDragRef.current) {
      const drag = panDragRef.current;
      setPan(drag.startPanX + (e.evt.clientX - drag.startClientX), drag.startPanY + (e.evt.clientY - drag.startClientY));
      return;
    }

    const start = marqueeStart.current;
    if (!start) return;
    const pos = contentGroupRef.current?.getRelativePointerPosition();
    if (!pos) return;
    marqueeRectRef.current = {
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    };
    setMarqueeRect(marqueeRectRef.current);
  };

  const handleStageMouseUp = () => {
    if (panDragRef.current) {
      panDragRef.current = null;
      setIsPanning(false);
      return;
    }

    const start = marqueeStart.current;
    const rect = marqueeRectRef.current;
    marqueeStart.current = null;
    marqueeRectRef.current = null;
    setMarqueeRect(null);
    if (!start || !rect) return;

    if (rect.width < CLICK_DRAG_THRESHOLD_PX && rect.height < CLICK_DRAG_THRESHOLD_PX) {
      if (!start.additive) clearSelection();
      return;
    }

    // Both rect and layer bboxes are in the same model space here (children
    // of the pan/zoom Group), so no coordinate conversion is needed.
    const hitIds = design.layers
      .filter((layer) => {
        const lx = mmToStagePx(layer.x);
        const ly = mmToStagePx(layer.y);
        const lw = mmToStagePx(layer.width);
        const lh = mmToStagePx(layer.height);
        return lx < rect.x + rect.width && lx + lw > rect.x && ly < rect.y + rect.height && ly + lh > rect.y;
      })
      .map((l) => l.id);

    setSelection(start.additive ? Array.from(new Set([...selectedLayerIds, ...hitIds])) : hitIds);
  };

  // Touch's stand-in for space+drag: there's no modifier key on a touch
  // device, so a single-finger drag that starts on empty canvas space (the
  // same `e.target === stage` distinction handleStageMouseDown uses to
  // separate a layer drag from an empty-space one) always pans, once
  // zoomed in past the viewport is otherwise unreachable on a phone or
  // tablet. A second finger joining mid-drag (the start of a pinch) isn't
  // handled here — it's left alone rather than fought over.
  const handleStageTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const stage = e.target.getStage();
    if (e.evt.touches.length !== 1 || !stage || e.target !== stage) return; // a shape handles its own drag
    const touch = e.evt.touches[0];
    if (!touch) return;
    panDragRef.current = { startClientX: touch.clientX, startClientY: touch.clientY, startPanX: panX, startPanY: panY };
    setIsPanning(true);
  };

  const handleStageTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const drag = panDragRef.current;
    if (!drag) return;
    const touch = e.evt.touches[0];
    if (!touch) return;
    e.evt.preventDefault();
    setPan(drag.startPanX + (touch.clientX - drag.startClientX), drag.startPanY + (touch.clientY - drag.startClientY));
  };

  const handleStageTouchEnd = () => {
    if (!panDragRef.current) return;
    panDragRef.current = null;
    setIsPanning(false);
  };

  const zoomFocal = () => ({ x: viewport.width / 2, y: viewport.height / 2 });
  const cursor = isPanning ? "grabbing" : spaceHeld ? "grab" : "default";

  return (
    <div
      ref={containerRef}
      className="cs-root"
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#e3d9c0", cursor, touchAction: "none" }}
    >
      <Stage
        ref={stageRef}
        width={viewport.width}
        height={viewport.height}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchStart={handleStageTouchStart}
        onTouchMove={handleStageTouchMove}
        onTouchEnd={handleStageTouchEnd}
      >
        <KonvaLayer>
          <Group ref={contentGroupRef} x={panX} y={panY} scaleX={zoom} scaleY={zoom}>
            {/* Decorative background — must not intercept pointer events, or every
                click targets this Rect instead of the Stage and empty-canvas
                click/marquee handling below never sees e.target === stage.
                Shrinks to the cut box with a die-cut corner radius when
                showBleed is off, so the card reads as a floating, trimmed
                card rather than a rectangle sitting in its own bleed. */}
            <Rect
              x={showBleed ? 0 : cutInsetXPx}
              y={showBleed ? 0 : cutInsetYPx}
              width={showBleed ? widthPx : cutWidthPx}
              height={showBleed ? heightPx : cutHeightPx}
              cornerRadius={showBleed ? 0 : bleedMaskCornerRadiusPx}
              fill={design.backgroundColor}
              listening={false}
              shadowColor="black"
              shadowBlur={16}
              shadowOpacity={0.25}
            />

            {/* Layer content always clips to *some* card-shaped boundary —
                the full-bleed rect (sharp corners) when the bleed is
                shown, the same rounded cut box the background Rect above
                uses when it's hidden. Nothing a design ends up with should
                ever paint past the full-bleed edge: that's the exact edge
                of the exported/printed image (see units.ts), so a
                misplaced or oversized layer — most commonly an imported
                image or a manually resized frame — rendering into the
                workspace background outside it isn't a preview of
                anything real, just visual noise while editing. This is
                a hard clip, not a toggle: the Transformer's own selection
                handles live in the separate, unclipped "cs-export-hide"
                group below, so a layer that overhangs the edge is still
                fully selectable/draggable/resizable — only its painted
                pixels are held to the boundary. */}
            <Group
              clipFunc={(ctx) =>
                showBleed
                  ? ctx.rect(0, 0, widthPx, heightPx)
                  : roundedRectPath(ctx, cutInsetXPx, cutInsetYPx, cutWidthPx, cutHeightPx, bleedMaskCornerRadiusPx)
              }
            >
              {design.layers.map((layer) => (
                <LayerNode
                  key={layer.id}
                  layer={layer}
                  panModeActive={spaceHeld}
                  onSelect={(e) => {
                    if (e.evt.shiftKey) toggleSelect(layer.id);
                    else selectOnly(layer.id);
                  }}
                  registerRef={(node) => {
                    if (node) nodeRefs.set(layer.id, node);
                    else nodeRefs.delete(layer.id);
                    attachTransformer();
                  }}
                  onDragStart={handleLayerDragStart}
                  onDragMove={handleLayerDragMove}
                  onDragEnd={handleLayerDragEnd}
                />
              ))}
            </Group>

            {/* Every editor-only overlay below (cut-line, safe-area, snap
                guides, marquee, and the Transformer's selection handles)
                shares the "cs-export-hide" name so handleExport (Toolbar.tsx)
                can look them up with one stage.find(".cs-export-hide") and
                hide them for the duration of the client-side quick-proof
                export — none of them belong in a card image. */}
            <Group name="cs-export-hide" listening={false}>
              {/* Cut line — where the card is actually trimmed. Only
                  meaningful (and only drawn) when the bleed itself is
                  visible; with the bleed hidden the card's own solid,
                  rounded edge already is the cut line. */}
              {showBleed && (
                <Rect
                  x={cutInsetXPx}
                  y={cutInsetYPx}
                  width={cutWidthPx}
                  height={cutHeightPx}
                  stroke="#ef4444"
                  dash={[4, 4]}
                />
              )}

              {/* Safe area — recommended inset from the cut line, toggle-able. */}
              {showSafeArea && (
                <Rect
                  x={safeInsetXPx}
                  y={safeInsetYPx}
                  width={safeWidthPx}
                  height={safeHeightPx}
                  stroke="#f59e0b"
                  dash={[4, 4]}
                />
              )}

              {guides.map((g, i) => (
                <Line key={i} points={g.points} stroke="#ec4899" strokeWidth={1} dash={[4, 4]} />
              ))}

              {marqueeRect && (
                <Rect
                  x={marqueeRect.x}
                  y={marqueeRect.y}
                  width={marqueeRect.width}
                  height={marqueeRect.height}
                  fill="rgba(59, 130, 246, 0.1)"
                  stroke="#3b82f6"
                  strokeWidth={1 / zoom}
                />
              )}
            </Group>

            <Transformer ref={transformerRef} name="cs-export-hide" rotateEnabled onTransformEnd={handleTransformEnd} />
          </Group>
        </KonvaLayer>
      </Stage>

      <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", gap: 4, background: "var(--cs-surface)", border: "1px solid var(--cs-border)", borderRadius: 8, padding: 4, boxShadow: "0 2px 8px rgba(58,38,15,0.18)" }}>
        <button className="cs-icon-btn" title="Zoom out" onClick={() => setZoom(zoom / BUTTON_ZOOM_STEP, zoomFocal())}>
          <ZoomOut size={16} />
        </button>
        <button className="cs-btn" style={{ minWidth: 52, justifyContent: "center" }} title="Reset to 100%" onClick={() => setZoom(1, zoomFocal())}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="cs-icon-btn" title="Zoom in" onClick={() => setZoom(zoom * BUTTON_ZOOM_STEP, zoomFocal())}>
          <ZoomIn size={16} />
        </button>
        <div className="cs-divider" />
        <button className="cs-icon-btn" title="Fit to view" onClick={() => fitToView(false)}>
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
