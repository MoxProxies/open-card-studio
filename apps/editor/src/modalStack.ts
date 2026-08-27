import { useEffect } from "react";

/**
 * How many modals are currently open. `useKeyboardShortcuts` checks this
 * and stands down while any dialog is up: with a modal open, Escape means
 * "close it", Delete means "delete the character I just typed", and arrow
 * keys mean "move the caret" — none of them should be reaching the canvas
 * to clear a selection, delete a layer, or nudge one.
 *
 * That isn't only a niceness fix. Escape used to be swallowed entirely the
 * first time it was pressed on a freshly-opened dialog: the shortcut
 * hook's clearSelection() ran first, the store update re-rendered the
 * toolbar synchronously, and the modal's own window listener got torn down
 * and re-added *during* the same event dispatch — and a listener removed
 * mid-dispatch never gets called. Not competing for the key at all is the
 * fix that can't come back.
 */
let openCount = 0;

export function isModalOpen(): boolean {
  return openCount > 0;
}

/** Counts this modal as open for as long as it's mounted. */
export function useRegisterModal(): void {
  useEffect(() => {
    openCount += 1;
    return () => {
      openCount -= 1;
    };
  }, []);
}
