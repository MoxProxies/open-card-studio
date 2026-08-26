import type { ComponentType } from "react";

/**
 * The plain-data shape a plugin (or a host page embedding the editor)
 * hands to the core editor to pre-populate a card. Nothing in this shape
 * is specific to any one data source or game — a Scryfall import plugin,
 * an AI-generation host integration, and a hand-rolled CSV importer all
 * produce the same shape, and the editor's `applyGeneratedFields` only
 * ever consumes this. This is the entire surface a third-party import
 * plugin has to satisfy; it never needs to know anything about layers,
 * Konva, or the design schema.
 */
export interface GeneratedCardFields {
  name: string;
  manaCost?: string;
  typeLine?: string;
  rulesText?: string;
  flavorText?: string;
  powerToughness?: string;
  artist?: string;
  /** An id from the active asset pack's rarity catalog, if any. */
  rarity?: string;
  /** A data: URI or any fetchable URL — becomes the art layer's `src` as-is. */
  imageSrc?: string;
}

/**
 * A plugin that lets a shopper pull card data in from somewhere external
 * (an API, a file, a barcode scan — whatever) instead of typing every
 * field by hand. This is the extension point the core editor's built-in
 * "Import" toolbar button delegates to; core ships with zero import
 * plugins registered by default, so a build with none installed still
 * works end to end, just without an Import button.
 *
 * `@card-studio/plugin-scryfall-import` is the reference implementation —
 * it wraps Scryfall's public API behind exactly this contract, and can be
 * deleted from an app's dependency tree with no core code changes.
 */
export interface ImportSourcePlugin {
  /** Stable, unique across all registered plugins (e.g. "scryfall"). */
  id: string;
  /** Shown in the source picker if more than one import plugin is active. */
  label: string;
  description?: string;
  /**
   * Renders the plugin's own search/browse/upload UI as a modal. The
   * plugin owns its entire interaction — network calls, file pickers,
   * pagination, whatever — and only ever has to call back with a finished
   * GeneratedCardFields value (or close without one).
   */
  SearchComponent: ComponentType<ImportSourceSearchProps>;
}

export interface ImportSourceSearchProps {
  onImport: (fields: GeneratedCardFields) => void;
  onClose: () => void;
}

/** A single frame (card border/template) an asset pack contributes. */
export interface AssetPackFrame {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  /** Resolvable by the pack's own `resolveFrameUrl`. */
  fileName: string;
}

/** A single rarity symbol an asset pack contributes. */
export interface AssetPackRarity {
  id: string;
  label: string;
  fileName: string;
}

/**
 * A themeable bundle of the visual assets a card design is built from —
 * frames, rarity symbols, mana/cost symbols, fonts. Swapping the active
 * pack is how a fork replaces MTG-styled visuals (or any other IP-
 * specific look) with an original theme, without touching editor code.
 *
 * @card-studio/plugin-asset-pack-default wraps this app's existing
 * frame-library/rarity-library/symbol-library/font-library exactly this
 * way, so it's provable end to end — but note the core render pipeline
 * (LayerNode.tsx, renderDesign.ts, rulesFlavorFit.ts) doesn't resolve
 * assets *through* the active pack yet; it still reads the default
 * pack's catalogs directly. Making every render path pack-aware is
 * tracked as follow-up work (see README's "Plugin system" section) —
 * this interface is the target shape that work converges on, registered
 * now so a second pack can start being built against a stable contract.
 */
export interface AssetPackPlugin {
  id: string;
  label: string;
  description?: string;
  frames: AssetPackFrame[];
  rarities: AssetPackRarity[];
  /** Resolves a frame's fileName (within its category) to a fetchable URL. */
  resolveFrameUrl: (frame: AssetPackFrame) => string;
  /** Resolves a rarity's fileName to a fetchable URL. */
  resolveRarityUrl: (rarity: AssetPackRarity) => string;
}

export type CardStudioPlugin = ImportSourcePlugin | AssetPackPlugin;
