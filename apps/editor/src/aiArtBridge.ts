import { randomUUID } from "./uuid";

export interface AiArtResult {
  src?: string;
  error?: string;
}

interface PendingRequest {
  resolve: (src: string) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, PendingRequest>();

/**
 * Dispatches a bubbling, composed "ai-art-request" CustomEvent (detail:
 * `{ requestId, prompt }`) from `target` and returns a Promise that
 * resolves once the host page calls CardStudioEditorElement's
 * completeAiArtRequest() (embed.ts) back with a matching requestId.
 *
 * `target` can be any node inside this app's shadow tree, not necessarily
 * the custom element itself — composed:true crosses the shadow boundary
 * regardless of which node it's dispatched from, and the event is
 * retargeted to <card-studio-editor> for listeners outside the shadow
 * root, same as embed.ts's "design-change"/"fullscreen-change". This
 * package never calls an image-generation API itself: the host page owns
 * the actual OpenAI (or whatever) call and any premium-account check
 * beyond the synchronous `Entitlements.canGenerateAiArt` gate that
 * decided whether to show the prompt UI at all.
 *
 * No timeout here deliberately — a slow generation call is the host's
 * problem to bound or not, not this package's to guess a deadline for.
 */
export function requestAiArt(target: EventTarget, prompt: string): Promise<string> {
  const requestId = randomUUID();
  return new Promise<string>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    target.dispatchEvent(
      new CustomEvent("ai-art-request", { detail: { requestId, prompt }, bubbles: true, composed: true })
    );
  });
}

/** Called by CardStudioEditorElement.completeAiArtRequest() (embed.ts)
 * once the host's backend has responded. A requestId with no matching
 * pending request (already resolved, or the modal was closed and the
 * caller stopped awaiting it) is silently ignored. */
export function resolveAiArtRequest(requestId: string, result: AiArtResult): void {
  const request = pending.get(requestId);
  if (!request) return;
  pending.delete(requestId);

  if (result.src) request.resolve(result.src);
  else request.reject(new Error(result.error ?? "AI art generation failed."));
}
