import type { ImportSourcePlugin } from "@card-studio/plugin-sdk";
import { SearchModal } from "./SearchModal.js";

/**
 * The reference ImportSourcePlugin implementation, and the concrete proof
 * that Scryfall integration is genuinely optional: this whole package can
 * be removed from an app's package.json and workspace, with zero changes
 * required in @card-studio/editor. Nothing outside this package imports
 * from Scryfall's API or ships Magic-the-Gathering-specific card-shape
 * assumptions — see scryfall.ts's mapping for where that lives.
 */
export const scryfallImportPlugin: ImportSourcePlugin = {
  id: "scryfall",
  label: "Scryfall (Magic: The Gathering)",
  description: "Search Scryfall's public card database and import a card's text and art directly.",
  SearchComponent: SearchModal,
};

export type { ScryfallCard, ScryfallCardFace, CardFields } from "./scryfall.js";
export { autocompleteCardNames, fetchCardByName, primaryCardFields } from "./scryfall.js";
