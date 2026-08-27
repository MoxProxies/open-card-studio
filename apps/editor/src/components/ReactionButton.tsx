import { useState } from "react";
import { Heart } from "lucide-react";
import { toggleReaction, type ReactableType } from "../api/gamification";
import { getCurrentUser } from "../api/auth";

/**
 * The one like button, for every content type — designs, templates,
 * collections, and knowledge-base posts when those exist. That's the
 * whole reason reactions are a single polymorphic table: one endpoint,
 * one component, N content types.
 *
 * Optimistic: the count moves immediately and rolls back if the request
 * fails, because a like that waits on a round-trip feels broken. That
 * makes `data-reacted` say nothing about what actually reached the
 * server, and the `busy` guard below silently drops a second click while
 * the first is in flight — so `data-busy` is on the element too, as the
 * only outside signal that a toggle has settled (see helpers.mjs's
 * toggleLike).
 */
export function ReactionButton({
  type,
  id,
  count,
  reacted,
  onChange,
}: {
  type: ReactableType;
  id: string;
  count: number;
  reacted: boolean;
  onChange?: (state: { reacted: boolean; reaction_count: number }) => void;
}) {
  const [state, setState] = useState({ reacted, count });
  const [busy, setBusy] = useState(false);
  const signedIn = Boolean(getCurrentUser());

  const toggle = async () => {
    if (!signedIn || busy) return;
    const previous = state;
    const optimistic = { reacted: !state.reacted, count: state.count + (state.reacted ? -1 : 1) };
    setState(optimistic);
    setBusy(true);
    try {
      const result = await toggleReaction(type, id);
      setState({ reacted: result.reacted, count: result.reaction_count });
      onChange?.(result);
    } catch {
      setState(previous);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`cs-icon-btn${state.reacted ? " cs-active" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        void toggle();
      }}
      disabled={!signedIn}
      data-testid="reaction-button"
      data-reacted={state.reacted}
      data-busy={busy}
      title={signedIn ? (state.reacted ? "Remove your like" : "Like this") : "Sign in to like this"}
      style={{ gap: 4, width: "auto", padding: "0 6px" }}
    >
      <Heart size={13} fill={state.reacted ? "currentColor" : "none"} />
      <span style={{ fontSize: 11 }} data-testid="reaction-count">
        {state.count}
      </span>
    </button>
  );
}
