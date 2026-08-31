import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";

/** A thin draggable divider between two flex panels. Reports the raw
 * horizontal drag delta each frame; the caller decides how to apply it
 * (which panel grows/shrinks) — this component has no opinion on layout.
 *
 * The three-pane desktop layout this lives in renders on any viewport
 * ≥768px wide, including landscape tablets with no mouse — so dragging has
 * to work from touch, not just `mousemove`/`mouseup`. */
export function ResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const trackDrag = (startX: number) => {
    let lastX = startX;

    const handleMouseMove = (ev: MouseEvent) => {
      onDrag(ev.clientX - lastX);
      lastX = ev.clientX;
    };
    const handleTouchMove = (ev: TouchEvent) => {
      const touch = ev.touches[0];
      if (!touch) return;
      onDrag(touch.clientX - lastX);
      lastX = touch.clientX;
    };
    // Both pairs are attached on every drag start regardless of which input
    // began it, so both must come off on either end event — otherwise the
    // input type that *didn't* end the drag leaks its listener on `window`
    // forever, holding a stale `lastX` that later fires on unrelated input.
    const stopTracking = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopTracking);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", stopTracking);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopTracking);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", stopTracking);
  };

  const handleMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    trackDrag(e.clientX);
  };

  const handleTouchStart = (e: ReactTouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    trackDrag(touch.clientX);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      className="cs-resize-handle"
      style={{ width: 6, flex: "none", cursor: "col-resize", position: "relative", touchAction: "none" }}
    >
      <div style={{ position: "absolute", inset: "0 2px" }} />
    </div>
  );
}
