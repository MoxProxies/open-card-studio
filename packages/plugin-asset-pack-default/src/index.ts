import type { AssetPackFrame, AssetPackPlugin, AssetPackRarity } from "@card-studio/plugin-sdk";

/**
 * Wraps the editor's existing bundled frame/rarity catalogs as an
 * AssetPackPlugin. Deliberately a factory, not a self-contained package
 * that ships its own asset files: the catalogs and the images they
 * reference already live in apps/editor/public (synced from
 * frame-library/, rarity-library/ at the repo root — see the root
 * README's "Adding frames" section) and are also needed unbundled by
 * services/render for print rendering, so this package doesn't duplicate
 * them. apps/editor/src/plugins.ts is the only caller, and supplies the
 * concrete catalog data + URL resolvers it already has.
 *
 * A community asset pack replacing this one doesn't have this
 * constraint — it can bundle its own images however it likes, as long as
 * it satisfies the same AssetPackPlugin shape.
 */
export function createDefaultAssetPack(options: {
  frames: AssetPackFrame[];
  rarities: AssetPackRarity[];
  resolveFrameUrl: (frame: AssetPackFrame) => string;
  resolveRarityUrl: (rarity: AssetPackRarity) => string;
}): AssetPackPlugin {
  return {
    id: "default",
    label: "Default (classic trading-card frames)",
    description: "The card-studio built-in frame and rarity set.",
    frames: options.frames,
    rarities: options.rarities,
    resolveFrameUrl: options.resolveFrameUrl,
    resolveRarityUrl: options.resolveRarityUrl,
  };
}
