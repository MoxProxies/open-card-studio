import { useEffect, useState } from "react";

/**
 * Phone-shaped viewport — the app's one breakpoint. Below it the shell
 * puts navigation in a bottom tab bar and the editor collapses its three
 * panes into a canvas plus a bottom sheet; above it, both lay out the way
 * a desktop app does. 768px is the usual tablet-portrait line: a tablet
 * gets the wide layout, which is what its width can carry.
 *
 * Lives in hooks/, not shell/, because the editor needs it too — an
 * embedded <card-studio-editor> on a phone has no shell but is just as
 * narrow.
 */
const NARROW = "(max-width: 767px)";

export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(NARROW).matches));

  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);

  return narrow;
}
