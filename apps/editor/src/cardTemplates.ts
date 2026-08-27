import { Design } from "@card-studio/scene-schema";
import type { Layer } from "@card-studio/scene-schema";
import type { TemplateDetail } from "./api/templates";

/**
 * Community card templates — a whole saved *layout* published by a user
 * and reusable by anyone, backed by backend/'s `templates` table (see
 * api/templates.ts).
 *
 * Not to be confused with `textTemplates.ts`, which is the unrelated,
 * build-time text-field config synced out of `text-template-library/`
 * (where the "title" field sits on a classic MTG layout, what font it
 * uses, ...). The two deliberately stay separate systems: one ships
 * curated first-party assets by committing files and redeploying, the
 * other is database rows any signed-in user creates at runtime. See
 * docs/PRODUCT_VISION.md, "Keep this separate from the existing
 * file-based asset workflow."
 *
 * **There is no slot schema here, on purpose.** A template's fill-in
 * slots and its fixed chrome are expressed entirely by the two lock
 * booleans every layer already carries (`locked` / `contentLocked`, see
 * the root README's "Field locking") — see classifyTemplateLayer below
 * for the mapping. That's what makes a template "a Design plus
 * publishing metadata" rather than a second scene format.
 */

/** What a layer's two lock flags mean once the design is being used as a template. */
export type TemplateLayerRole =
  /** locked + contentLocked — decorative chrome (frame art, rarity symbol,
   * a background): whoever fills the template can neither move it nor
   * replace what it says. */
  | "chrome"
  /** locked, not contentLocked — a fill-in slot: position/size/font stay
   * exactly as the template author set them, the *value* is what the
   * person using the template is meant to change. */
  | "slot"
  /** not locked — freely movable. Legitimate for a template that wants to
   * leave something open, but worth surfacing to the author before
   * publishing, since it's also what an un-reviewed layer looks like. */
  | "free";

export function classifyTemplateLayer(layer: Layer): TemplateLayerRole {
  if (!layer.locked) return "free";

  return layer.contentLocked ? "chrome" : "slot";
}

export interface TemplateLayerBreakdown {
  chrome: number;
  slot: number;
  free: number;
}

/** Counts each role across a design — drives the "what will people be able
 * to change?" summary in SaveAsTemplateModal, so an author sees the
 * consequences of their lock flags before publishing rather than after. */
export function summarizeTemplateLayers(design: Design): TemplateLayerBreakdown {
  const breakdown: TemplateLayerBreakdown = { chrome: 0, slot: 0, free: 0 };
  for (const layer of design.layers) breakdown[classifyTemplateLayer(layer)] += 1;

  return breakdown;
}

/**
 * "Start a new design from this template": clone the template's layers
 * into a fresh Design with a new id, leaving every lock flag exactly as
 * the template's author set it.
 *
 * **Layer ids are kept, not regenerated.** They only have to be unique
 * *within* one design, and keeping them is what preserves the things
 * elsewhere in the editor that key off a specific id — the rarity/
 * set-symbol singleton (`RARITY_LAYER_ID`, rarityConfig.ts), each layer's
 * `groupId` pointing at a `Design.groups` entry, a text layer's
 * `fieldId`. Regenerating them would mean rewriting all of those
 * references for no benefit.
 *
 * Runs through Design.parse() for the same reason designStorage.load()
 * does: a template published by an older version of the editor still
 * opens cleanly, with any field added to the schema since defaulted in.
 */
export function designFromTemplate(template: TemplateDetail, name?: string): Design {
  return Design.parse({
    ...template.design,
    id: crypto.randomUUID(),
    name: name?.trim() || template.name,
    // Template lineage (which template a design came from, forking/
    // remixing) is explicitly out of scope for Phase 1 — see
    // docs/PRODUCT_VISION.md. This field is moxproxies-website's own
    // CardDesign link and has nothing to do with templates; a design
    // started from a template is a brand-new, unlinked one.
    sourceCardDesignId: null,
  });
}
