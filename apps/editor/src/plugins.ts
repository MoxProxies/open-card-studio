import { PluginManager } from "@card-studio/plugin-sdk";
import { scryfallImportPlugin } from "@card-studio/plugin-scryfall-import";
import { createDefaultAssetPack } from "@card-studio/plugin-asset-pack-default";
import { FRAME_ASSETS, getFrameAssetUrl } from "./frameAssets";
import { RARITY_ASSETS, getRarityAssetUrl } from "./rarityAssets";

/**
 * The app's one PluginManager instance, registered at module load — every
 * component that needs to know about import sources or asset packs reads
 * from this same object (see Toolbar.tsx's `pluginManager.getActive...()`
 * calls) rather than each owning its own registry.
 *
 * This is also the entire "how do I remove Scryfall" answer: delete the
 * `registerImportSource(scryfallImportPlugin)` line below (and the
 * @card-studio/plugin-scryfall-import dependency), and the app still
 * builds and runs — the Import toolbar button just stops rendering
 * (Toolbar.tsx only shows it when `getActiveImportSource()` returns
 * something). No other file needs to change.
 *
 * A build that wants a *different* import source instead — a different
 * game's card database, a local file importer, anything satisfying
 * ImportSourcePlugin — registers that here instead, or alongside it.
 */
export const pluginManager = new PluginManager();

pluginManager.registerImportSource(scryfallImportPlugin);

// The bundled frame/rarity catalogs, wrapped as an AssetPackPlugin. See
// createDefaultAssetPack's doc comment (plugin-asset-pack-default/src/
// index.ts) for why this factory takes the catalog data as arguments
// instead of owning it — the underlying image files are also needed
// unbundled by services/render, so apps/editor stays their one owner.
pluginManager.registerAssetPack(
  createDefaultAssetPack({
    frames: FRAME_ASSETS,
    rarities: RARITY_ASSETS,
    resolveFrameUrl: (frame) => getFrameAssetUrl(frame.id) ?? "",
    resolveRarityUrl: (rarity) => getRarityAssetUrl(rarity.id) ?? "",
  })
);
