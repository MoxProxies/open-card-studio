import { useEffect, useRef } from "react";

/**
 * The open-modal stack. Two consumers:
 *
 * - `useKeyboardShortcuts` stands down entirely while anything is open:
 *   with a dialog up, Escape means "close it", Delete means "delete the
 *   character I just typed", and the arrow keys mean "move the caret" —
 *   none of them should reach the canvas.
 * - Each modal's own Escape handler checks it's the *topmost* before
 *   closing, so one press on a dialog stacked over another (the report
 *   dialog over a profile, save-as-template over the gallery) closes one
 *   layer rather than both.
 *
 * The stack is read at event time rather than through React state on
 * purpose. A modal re-subscribing its window listener on every render is
 * what caused the original bug here: the shortcut hook's clearSelection()
 * re-rendered the toolbar synchronously *during* the keydown dispatch,
 * the listener was removed and re-added mid-dispatch, and a listener
 * removed mid-dispatch is never called — so the first Escape on a freshly
 * opened dialog did nothing at all.
 */
const stack: number[] = [];
let nextId = 1;

export function isModalOpen(): boolean {
  return stack.length > 0;
}

function isTopmost(id: number): boolean {
  return stack[stack.length - 1] === id;
}

/**
 * Counts this modal as open while it's mounted, and returns a predicate
 * for "am I the one on top right now" — stable across renders, so a
 * listener can register once and still get a live answer.
 */
export function useRegisterModal(): () => boolean {
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = nextId++;

  useEffect(() => {
    const id = idRef.current;
    stack.push(id);
    return () => {
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
    };
  }, []);

  return useRef(() => isTopmost(idRef.current)).current;
}
