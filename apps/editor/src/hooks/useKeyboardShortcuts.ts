import { useEffect } from "react";
import { useDesignStore } from "../store/DesignProvider";
import { isTypingTarget } from "../isTypingTarget";
import { isModalOpen } from "../modalStack";

const NUDGE_MM = 0.5;
const NUDGE_MM_LARGE = 5;

/** Delete/backspace, arrow-key nudge, ctrl/cmd+Z undo, ctrl/cmd+shift+Z (or ctrl+Y) redo,
 * ctrl/cmd+D duplicate, Escape to clear selection. Disabled while typing in
 * an input, and while any modal is open (see modalStack.ts). */
export function useKeyboardShortcuts() {
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds);
  const removeLayers = useDesignStore((s) => s.removeLayers);
  const duplicateLayers = useDesignStore((s) => s.duplicateLayers);
  const nudgeLayers = useDesignStore((s) => s.nudgeLayers);
  const clearSelection = useDesignStore((s) => s.clearSelection);
  const undo = useDesignStore((s) => s.undo);
  const redo = useDesignStore((s) => s.redo);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e) || isModalOpen()) return;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (meta && e.key.toLowerCase() === "d") {
        if (selectedLayerIds.length === 0) return;
        e.preventDefault();
        duplicateLayers(selectedLayerIds);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedLayerIds.length === 0) return;
        e.preventDefault();
        removeLayers(selectedLayerIds);
        return;
      }
      if (e.key === "Escape") {
        clearSelection();
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        if (selectedLayerIds.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_MM_LARGE : NUDGE_MM;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        nudgeLayers(selectedLayerIds, dx, dy);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedLayerIds, removeLayers, duplicateLayers, nudgeLayers, clearSelection, undo, redo]);
}
