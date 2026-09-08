import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Design, createEmptyDesign, STANDARD_CARD_SIZE_MM } from "@card-studio/scene-schema";
import { DesignProvider } from "./store/DesignProvider";
import { createDesignStore, type DesignStore } from "./store/designStore";
import { DEFAULT_ENTITLEMENTS, type Entitlements } from "./entitlements";
import { resolveAiArtRequest, type AiArtResult } from "./aiArtBridge";
import type { GeneratedCardFields } from "./generatedCardFields";
import { App } from "./App";
// Imported as raw strings (not injected into document.head) because this
// element renders into a shadow root — a global <style> tag can't cross the
// shadow boundary, so the CSS has to be inlined inside it directly. This
// applies to @font-face too: a shadow root's own stylesheet can declare
// fonts and use them for text inside that shadow tree.
import styles from "./styles.css?inline";
import fontFaces from "./fonts.generated.css?inline";
import { preloadEmbeddedFonts } from "./loadEmbeddedFonts";
import { setAssetBase } from "./assetBase";
import { randomUUID } from "./uuid";

// frameAssets.ts/rarityAssets.ts/symbolAssets.ts build their URLs
// ("/frames/...", "/rarity/...", "/symbols/...") assuming this app is
// served from its own domain root — true for the standalone build, not
// for this one: moxproxies-website serves card-studio-embed.js from its
// own public/vendor/card-studio/, not the domain root, so those paths
// 404 there. import.meta.url is this module's own URL wherever it was
// actually loaded from, so its containing directory is exactly where
// the sibling fonts/frames/rarity/symbols/ directories (copied
// alongside this file at build time — see vite.embed.config.ts) live,
// regardless of what subpath the host serves it from. Runs once at
// module load, before connectedCallback (and therefore before any of
// those modules ever construct a URL).
// Vite warns that it can't resolve this at build time — correct, and the
// whole point: it has to stay a runtime expression, evaluated wherever
// the host page actually loaded this script from, not baked in here.
const ASSET_BASE = new URL(".", import.meta.url).href;
setAssetBase(ASSET_BASE);
// fonts.generated.css is plain generated CSS text, not JS — it can't
// read assetBase.ts's exported variable, so its "/fonts/..." references
// get rewritten directly here, the one place this raw CSS string is
// actually used (injected into the shadow root below).
const embeddedFontFaces = fontFaces.replaceAll('url("/fonts/', `url("${ASSET_BASE}fonts/`);

/**
 * <card-studio-editor> — the integration surface for moxproxies-website.
 *
 * Usage from the host page:
 *   <script type="module" src="https://studio.moxproxies.com/embed/card-studio-embed.js"></script>
 *   <card-studio-editor initial-design='{...}' can-edit-locked-content hide-local-design-library></card-studio-editor>
 *
 * The element dispatches a bubbling, composed "design-change" CustomEvent
 * (detail: the current Design JSON) on every edit, so the host page can
 * autosave or enable a "Save design" button without polling. It also
 * exposes `.getDesign()` for imperative reads (e.g. right before checkout).
 *
 * It also dispatches a bubbling, composed "fullscreen-change" CustomEvent
 * (detail: `{ fullscreen: boolean }`) whenever the toolbar's fullscreen/
 * lightbox toggle fires (App.tsx). The lightbox already sets an extremely
 * high z-index internally, but that only wins within whatever stacking
 * context the host page put this element in — a host with, say, a fixed/
 * sticky nav bar in a *different* stacking context with its own z-index
 * can still end up drawing that nav bar on top of the lightbox regardless.
 * Listen for this event and react on the host side (lower the nav's own
 * z-index, hide it, ...) for exactly as long as `detail.fullscreen` is
 * true.
 *
 * Auth/ownership are intentionally out of scope here: this element only
 * edits scene JSON in memory. Persisting a design against a logged-in
 * moxproxies-website user, uploading art, and requesting a print-quality
 * render are the host page's job, calling the render/API service with
 * whatever session token it already has.
 *
 * The one exception is `Entitlements.canEditLockedContent` (the "premium"
 * gate for contentLocked fields — artist/signature/the rarity symbol by
 * default; see schema.ts's LayerBase doc comments and README's "Field
 * locking" section) — this element takes it as a plain boolean, either
 * up front via the `can-edit-locked-content` boolean attribute (present =
 * true, read once at mount) or live via `.setEntitlements()`, for a host
 * that only knows the answer after an async auth/subscription check
 * resolves. Computing that boolean from an actual moxproxies-website
 * session/subscription is entirely the host page's job; this element
 * never sees a token or makes an auth call of its own.
 *
 * `hide-local-design-library` (boolean attribute, read once at mount,
 * present = true): hides the toolbar's own "Designs" button —
 * designStorage.ts's localStorage-backed save/load, which predates this
 * embed and has nothing to do with the host's own persistence. Set this
 * whenever the host page provides its own save UI (as moxproxies-website
 * now does), so there's exactly one "Save" a user can find, not two that
 * quietly do different things (one to the host's backend, one to just
 * that browser's localStorage).
 *
 * `Entitlements.canGenerateAiArt` (second premium gate, separate from
 * canEditLockedContent — same wiring: the `can-generate-ai-art` boolean
 * attribute at mount, or live via `.setEntitlements()`) controls whether
 * the toolbar's "AI Art" prompt is enabled. Actually generating an image
 * is a round trip through the host page, not this element: when the
 * shopper submits a prompt, the element dispatches a bubbling, composed
 * "ai-art-request" CustomEvent (detail: `{ requestId, prompt }`). The
 * host page's own JS listens for that, calls its own backend (which
 * injects framing/style/aspect-ratio instructions automatically, and
 * re-checks the account's premium status server-side — the attribute
 * above only gates the UI, it isn't itself an authorization check), and
 * calls `.completeAiArtRequest(requestId, { src })` (or `{ error }` on
 * failure) back on this element once it has a result. This element never
 * calls an image-generation API or holds a credential of its own — see
 * aiArtBridge.ts.
 *
 * `generated-fields` (JSON attribute, read once at mount): pre-populates
 * a brand-new design from moxproxies-website's AI card-generation wizard
 * — a chat flow, hosted entirely on the moxproxies-website side, that
 * uses Claude to turn a shopper's free-text prompt (plus a few clarifying
 * answers) into a structured set of card fields *before* this element is
 * ever mounted. The attribute's value is `{ fields: GeneratedCardFields,
 * frameAssetId?: string }` (see generatedCardFields.ts) — the same field
 * shape importFromScryfall already turns into layers (Toolbar.tsx's
 * applyGeneratedFields, generalized from what used to be Scryfall-import-
 * only logic), plus an optional frame to add first, since a wizard
 * building a design from nothing has to choose one itself, unlike
 * Scryfall import applying against whatever frame (if any) is already on
 * the canvas. Applied once, automatically, by a mount effect in
 * Toolbar.tsx — the resulting layers are this design's actual first
 * state, not a separate action the shopper has to trigger. Invalid JSON
 * (or a payload missing `fields.name`) is logged and ignored, same as an
 * invalid `initial-design`; don't pass both attributes on the same
 * element, `initial-design` always wins since a design already being
 * edited should never get silently reshuffled by wizard output meant for
 * a fresh one.
 */
export class CardStudioEditorElement extends HTMLElement {
  #root: Root | null = null;
  #store: DesignStore | null = null;

  connectedCallback() {
    if (this.#root) return; // already mounted

    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = `${styles}\n${embeddedFontFaces}`;
    shadow.appendChild(styleEl);
    // @font-face registration is document-global even when declared inside
    // a shadow root's stylesheet — safe to preload once the <style> above
    // is actually in the DOM.
    preloadEmbeddedFonts();

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = this.getAttribute("height") ?? "600px";
    shadow.appendChild(container);

    const initialDesign = this.#readInitialDesign();
    const initialEntitlements = this.#readInitialEntitlements();
    // initial-design always wins if both are somehow present — a design
    // already being edited should never get silently reshuffled by
    // wizard output meant for a fresh one.
    const pendingGeneratedCard = this.hasAttribute("initial-design") ? null : this.#readPendingGeneratedCard();
    this.#store = createDesignStore(
      initialDesign,
      initialEntitlements,
      this.hasAttribute("hide-local-design-library"),
      pendingGeneratedCard
    );
    this.#store.subscribe((state) => {
      this.dispatchEvent(
        new CustomEvent("design-change", { detail: state.design, bubbles: true, composed: true })
      );
    });

    this.#root = createRoot(container);
    this.#root.render(createElement(DesignProvider, { store: this.#store, children: createElement(App) }));
  }

  disconnectedCallback() {
    this.#root?.unmount();
    this.#root = null;
    this.#store = null;
  }

  /** Current design JSON, e.g. to persist right before checkout. */
  getDesign(): Design | null {
    return this.#store?.getState().design ?? null;
  }

  /** Updates what the current user is allowed to do with contentLocked
   * layers — call this any time after mount, e.g. once an async auth/
   * subscription check resolves (the `can-edit-locked-content` attribute
   * only covers what's known synchronously at mount). Takes effect
   * immediately: any contentLocked field's content input re-enables (or
   * disables) on the next render. */
  setEntitlements(entitlements: Entitlements): void {
    this.#store?.getState().setEntitlements(entitlements);
  }

  /** Resolves (or rejects, on `{ error }`) the AiArtModal request matching
   * `requestId` — call this once the host page's backend responds to the
   * "ai-art-request" event this element dispatched (see aiArtBridge.ts
   * and this class's doc comment). A requestId with no matching pending
   * request (e.g. the modal was already closed) is silently ignored. */
  completeAiArtRequest(requestId: string, result: AiArtResult): void {
    resolveAiArtRequest(requestId, result);
  }

  #readInitialDesign(): Design {
    const raw = this.getAttribute("initial-design");
    if (raw) {
      try {
        return Design.parse(JSON.parse(raw));
      } catch (err) {
        console.error("[card-studio] invalid initial-design attribute, starting blank.", err);
      }
    }
    return createEmptyDesign(randomUUID(), STANDARD_CARD_SIZE_MM);
  }

  #readInitialEntitlements(): Entitlements {
    return {
      ...DEFAULT_ENTITLEMENTS,
      canEditLockedContent: this.hasAttribute("can-edit-locked-content"),
      canGenerateAiArt: this.hasAttribute("can-generate-ai-art"),
    };
  }

  #readPendingGeneratedCard(): { fields: GeneratedCardFields; frameAssetId?: string } | null {
    const raw = this.getAttribute("generated-fields");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { fields?: GeneratedCardFields; frameAssetId?: string };
      if (!parsed.fields?.name) throw new Error("missing fields.name");
      return { fields: parsed.fields, frameAssetId: parsed.frameAssetId };
    } catch (err) {
      console.error("[card-studio] invalid generated-fields attribute, ignoring.", err);
      return null;
    }
  }
}

if (!customElements.get("card-studio-editor")) {
  customElements.define("card-studio-editor", CardStudioEditorElement);
}
