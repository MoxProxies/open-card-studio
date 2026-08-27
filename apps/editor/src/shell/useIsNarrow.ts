import { useEffect, useState } from "react";

/**
 * Phone-shaped viewport. The one breakpoint the shell needs: below it,
 * navigation is a bottom tab bar; above it, a top nav bar the way a
 * website has one. 768px is the usual tablet-portrait line — a tablet
 * gets the website layout, which is what its width can carry.
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
