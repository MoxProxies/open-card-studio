import { useEffect, useState } from "react";
import type Konva from "konva";
import type { RefObject } from "react";
import type { Layer } from "@card-studio/scene-schema";
import { Frame, Type, Shapes, ImageUp, Undo2, Redo2, Copy, Trash2, Download, Ruler, Search, Sparkles, Scissors, Save, Maximize2, Minimize2, LayoutTemplate } from "lucide-react";
import { useDesignStore } from "../store/DesignProvider";
import { PRINT_DPI, createEmptyDesign, STANDARD_CARD_SIZE_MM } from "@card-studio/scene-schema";
import { exportStageToPngDataUrl } from "../export";
import { FrameLibraryModal } from "./FrameLibraryModal";
import { TextTemplateMenu } from "./TextTemplateMenu";
import { AiArtModal } from "./AiArtModal";
import { DesignLibraryModal } from "./DesignLibraryModal";
import { TemplateBrowserModal } from "./TemplateBrowserModal";
import { AccountButton } from "./AccountButton";
import { getTextTemplates, type TextFieldTemplate } from "../textTemplates";
import { RARITY_ASSETS, getRarityAssetUrl } from "../rarityAssets";
import { RARITY_DISPLAY_ORDER, RARITY_LAYER_ID, RARITY_SYMBOL_BOX, RARITY_DEFAULT_LOCKED, RARITY_DEFAULT_CONTENT_LOCKED } from "../rarityConfig";
import { DEFAULT_FONT_FAMILY } from "../config";
import { pluginManager } from "../plugins";
import { designStorage } from "../designStorage";
import { resolveArtWindowMm } from "../frameArtWindow";
import { getFrameAsset } from "../frameAssets";
import { useActiveFrameCategory } from "../hooks/useActiveFrameCategory";
import { computeRulesFlavorPatch } from "../rulesFlavorFit";
import type { GeneratedCardFields } from "../generatedCardFields";

function newId(): string {
  return crypto.randomUUID();
}

const fmt = (mm: number) => Number(mm.toFixed(2)).toString();

export function Toolbar({
  stageRef,
  isFullscreen,
  onToggleFullscreen,
}: {
  stageRef: RefObject<Konva.Stage>;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const design = useDesignStore((s) => s.design);
  const addLayer = useDesignStore((s) => s.addLayer);
  const addLayers = useDesignStore((s) => s.addLayers);
  const addLayersWithGroups = useDesignStore((s) => s.addLayersWithGroups);
  const replaceLayers = useDesignStore((s) => s.replaceLayers);
  const commitLayerChange = useDesignStore((s) => s.commitLayerChange);
  const commitLayerChanges = useDesignStore((s) => s.commitLayerChanges);
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds);
  const duplicateLayers = useDesignStore((s) => s.duplicateLayers);
  const removeLayers = useDesignStore((s) => s.removeLayers);
  const undo = useDesignStore((s) => s.undo);
  const redo = useDesignStore((s) => s.redo);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const showSafeArea = useDesignStore((s) => s.showSafeArea);
  const toggleSafeArea = useDesignStore((s) => s.toggleSafeArea);
  const showBleed = useDesignStore((s) => s.showBleed);
  const toggleBleed = useDesignStore((s) => s.toggleBleed);
  const renameDesign = useDesignStore((s) => s.renameDesign);
  const loadDesign = useDesignStore((s) => s.loadDesign);
  const entitlements = useDesignStore((s) => s.entitlements);
  const hideLocalDesignLibrary = useDesignStore((s) => s.hideLocalDesignLibrary);
  const pendingGeneratedCard = useDesignStore((s) => s.pendingGeneratedCard);
  const clearPendingGeneratedCard = useDesignStore((s) => s.clearPendingGeneratedCard);
  const zoom = useDesignStore((s) => s.zoom);
  const panX = useDesignStore((s) => s.panX);
  const panY = useDesignStore((s) => s.panY);
  const [showFrameLibrary, setShowFrameLibrary] = useState(false);
  const [showImportSearch, setShowImportSearch] = useState(false);
  const [showAiArtModal, setShowAiArtModal] = useState(false);
  const [showDesignLibrary, setShowDesignLibrary] = useState(false);
  const [showTemplateBrowser, setShowTemplateBrowser] = useState(false);
  // Whichever ImportSourcePlugin the host app registered as active (see
  // src/plugins.ts) — undefined when none is installed, in which case the
  // Import button below doesn't render at all rather than doing nothing.
  const activeImportSource = pluginManager.getActiveImportSource();

  const centerBox = () => {
    const w = design.size.widthMm * 0.6;
    const h = design.size.heightMm * 0.2;
    return {
      x: (design.size.widthMm - w) / 2,
      y: (design.size.heightMm - h) / 2,
      width: w,
      height: h,
    };
  };

  const addFrame = (assetId: string) =>
    addLayer({
      id: newId(),
      name: "Frame",
      type: "frame",
      assetId,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      contentLocked: false,
      // New frames size to the full-bleed canvas, not just the cut/trim
      // dimensions — frame art needs to extend past the trim line, or the
      // printed card shows a background-color gap around the edge once
      // cut. See generate-placeholder-frames.mjs for how the built-in
      // frame art itself was authored to match.
      x: 0,
      y: 0,
      width: design.size.widthMm,
      height: design.size.heightMm,
    });

  const addText = () =>
    addLayer({
      id: newId(),
      name: "Text",
      type: "text",
      content: "New text",
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSizePt: 14,
      fontWeight: "normal",
      italic: false,
      color: "#111111",
      align: "left",
      lineHeight: 1.2,
      overflow: "shrink",
      shadowOffsetXPt: 0,
      shadowOffsetYPt: 0,
      shadowBlurPt: 1,
      shadowOpacity: 0.75,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      contentLocked: false,
      ...centerBox(),
    });

  // Text-field positions are relative to the cut/trim corner, not the
  // full-bleed canvas layers actually live in — offset by the same margin
  // the cut-line guide uses.
  const cutOffsetX = (design.size.widthMm - design.size.cutWidthMm) / 2;
  const cutOffsetY = (design.size.heightMm - design.size.cutHeightMm) / 2;

  // Which text-field config applies is driven by the design's current
  // frame: each frame-library/ category can have its own
  // text-template-library/<category>.json override (position/font/color
  // tuned to fit that frame), falling back to the base/default set when
  // no frame is present yet, or its category has no override of its own.
  const activeFrameCategory = useActiveFrameCategory();
  const textTemplates = getTextTemplates(activeFrameCategory);

  const templateToLayer = (template: TextFieldTemplate): Layer => ({
    id: newId(),
    name: template.label,
    type: "text",
    fieldId: template.id,
    content: template.defaultContent,
    fontFamily: template.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSizePt: template.fontSizePt,
    minFontSizePt: template.minFontSizePt,
    maxFontSizePt: template.maxFontSizePt,
    fontWeight: template.fontWeight,
    italic: template.isItalic,
    color: template.color,
    align: template.align,
    lineHeight: 1.15,
    overflow: "shrink",
    manaDigitScale: template.manaDigitScale,
    // Whether this field has a shadow at all — and, if so, its exact
    // look — is decided by the template, same as its color/font/size: a
    // title over busy full-art might want one, rules text over its own
    // parchment-colored box usually doesn't. template.shadow's presence
    // (and its color specifically) is the on/off switch; the rest each
    // independently fall back to schema.ts's TextLayer defaults so a
    // template only has to name a color to get sensible sizing for free.
    shadowColor: template.shadow?.color,
    shadowOffsetXPt: template.shadow?.offsetXPt ?? 0,
    shadowOffsetYPt: template.shadow?.offsetYPt ?? 0,
    shadowBlurPt: template.shadow?.blurPt ?? 1,
    shadowOpacity: template.shadow?.opacity ?? 0.75,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    // Whether this field starts position-locked and/or content-locked is
    // also a per-template, per-frame decision, same as everything else
    // above — see TextFieldTemplate.locked/contentLocked's doc comments
    // and README's "Field locking" section. Neither is set on most
    // shipped fields; artist/signature default both to true.
    locked: template.locked ?? false,
    contentLocked: template.contentLocked ?? false,
    x: cutOffsetX + template.x,
    y: cutOffsetY + template.y,
    width: template.width,
    height: template.height,
  });

  // Rules/flavor text share one automatically-sized boundary box (see
  // rulesFlavorFit.ts) instead of each having its own fixed one — adding
  // either re-fits the pair (or just the one, if the other isn't added
  // yet) against the design's current typeline/legal-row/power-toughness
  // layout. Folded into the same commit as the add itself where the
  // layer being added is the one that moved (the common case: adding the
  // first of the pair); the rarer case — adding the second when the
  // first already exists — needs a second, immediate commit, since
  // addLayer only ever adds the one new layer.
  const addTextField = (template: TextFieldTemplate) => {
    const layer = templateToLayer(template);
    const patches = computeRulesFlavorPatch({ ...design, layers: [...design.layers, layer] }, textTemplates);
    const ownPatch = patches?.find((p) => p.id === layer.id);
    addLayer(ownPatch ? ({ ...layer, ...ownPatch.patch } as Layer) : layer);
    const otherPatches = patches?.filter((p) => p.id !== layer.id) ?? [];
    if (otherPatches.length > 0) commitLayerChanges(otherPatches);
  };

  // The rarity-symbol image is a singleton, found-or-created by its fixed
  // id (RARITY_LAYER_ID) rather than tracked as separate UI state — see
  // rarityConfig.ts.
  const rarityLayer = design.layers.find((l): l is Extract<Layer, { type: "image" }> => l.type === "image" && l.id === RARITY_LAYER_ID);
  const currentRarityId = rarityLayer?.assetId ?? "";
  // Whether picking a rarity is gated the same way editing a
  // contentLocked text field's content is — checked even before a rarity
  // layer exists yet, using what it *would* default to
  // (RARITY_DEFAULT_CONTENT_LOCKED), so there's no "the first pick is
  // free, only changing it afterward is locked" inconsistency.
  const rarityContentLocked = rarityLayer ? rarityLayer.contentLocked : RARITY_DEFAULT_CONTENT_LOCKED;
  const rarityLocked = rarityContentLocked && !entitlements.canEditLockedContent;
  const orderedRarities = [...RARITY_ASSETS].sort((a, b) => {
    const ai = RARITY_DISPLAY_ORDER.indexOf(a.id);
    const bi = RARITY_DISPLAY_ORDER.indexOf(b.id);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const buildRarityLayer = (rarityId: string, url: string): Layer => ({
    id: RARITY_LAYER_ID,
    name: "Rarity Symbol",
    type: "image",
    assetId: rarityId,
    src: url,
    fit: "contain",
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    locked: RARITY_DEFAULT_LOCKED,
    contentLocked: RARITY_DEFAULT_CONTENT_LOCKED,
    x: cutOffsetX + RARITY_SYMBOL_BOX.x,
    y: cutOffsetY + RARITY_SYMBOL_BOX.y,
    width: RARITY_SYMBOL_BOX.width,
    height: RARITY_SYMBOL_BOX.height,
  });

  /**
   * "Add all fields" — every field the current template set has, plus a
   * default rarity-symbol layer if one isn't already present (so there's
   * something for "Typeline and rarity" to actually group, since rarity
   * isn't one of textTemplates' own fields — see rarityConfig.ts). Groups
   * three pairs by default: title+mana cost, typeline+rarity, rules+
   * flavour — everything else (nickname, P/T, artist, signature) stays
   * ungrouped. One undo step via addLayersWithGroups, which also covers
   * the "rarity already existed" case (its groupId gets set in place,
   * without needing a second history entry) — see designStore.ts.
   */
  const addAllTextFields = () => {
    const newFieldLayers = textTemplates.map(templateToLayer);
    const layerIdByFieldId = new Map(textTemplates.map((t, i) => [t.id, newFieldLayers[i]!.id]));

    let extraRarityLayer: Layer | null = null;
    if (!rarityLayer) {
      const defaultRarityId = RARITY_DISPLAY_ORDER[0];
      const url = defaultRarityId ? getRarityAssetUrl(defaultRarityId) : undefined;
      if (defaultRarityId && url) extraRarityLayer = buildRarityLayer(defaultRarityId, url);
    }
    const newLayers = extraRarityLayer ? [...newFieldLayers, extraRarityLayer] : newFieldLayers;

    const groupDefs: Array<{ name: string; layerIds: string[] }> = [];
    const titleId = layerIdByFieldId.get("title");
    const manaCostId = layerIdByFieldId.get("manaCost");
    if (titleId && manaCostId) groupDefs.push({ name: "Title and mana cost", layerIds: [titleId, manaCostId] });
    const typelineId = layerIdByFieldId.get("typeline");
    if (typelineId) groupDefs.push({ name: "Typeline and rarity", layerIds: [typelineId, RARITY_LAYER_ID] });
    const rulesId = layerIdByFieldId.get("rules");
    const flavorId = layerIdByFieldId.get("flavor");
    if (rulesId && flavorId) groupDefs.push({ name: "Rules and flavour", layerIds: [rulesId, flavorId] });

    // Fold rules/flavor's boundary-box fit (rulesFlavorFit.ts) into the
    // same layers this is about to commit, rather than a separate
    // follow-up commit — one undo step for "Add all fields", same as
    // before.
    const patches = computeRulesFlavorPatch({ ...design, layers: [...design.layers, ...newLayers] }, textTemplates);
    const patchedLayers = patches
      ? newLayers.map((l) => {
          const patch = patches.find((p) => p.id === l.id);
          return patch ? ({ ...l, ...patch.patch } as Layer) : l;
        })
      : newLayers;

    addLayersWithGroups(patchedLayers, groupDefs);
  };

  const setRarity = (rarityId: string) => {
    if (!rarityId) {
      if (rarityLayer) removeLayers([RARITY_LAYER_ID]);
      return;
    }
    const url = getRarityAssetUrl(rarityId);
    if (!url) return;
    if (rarityLayer) {
      commitLayerChange(RARITY_LAYER_ID, { assetId: rarityId, src: url });
      return;
    }
    addLayer(buildRarityLayer(rarityId, url));
  };

  // Reads the file as a data: URI rather than URL.createObjectURL's blob:
  // URL — a blob: URL is only a live reference into this tab's memory: it
  // stops resolving the moment the tab closes (or, in practice, far
  // sooner — nothing in this app ever explicitly keeps the underlying
  // Blob alive), so a design saved with one appears fine right up until
  // the next reload, at which point that layer's image silently
  // disappears, and services/render's server-side print export (which
  // fetches each layer's `src` from a separate process entirely) could
  // never have loaded it to begin with. A data: URI has neither problem
  // — it's the design's own data, same as an AI-generated art layer's
  // src (see AiArtModal.tsx / aiArtBridge.ts, which never had a blob:
  // URL option to begin with) — at the cost of bloating the saved design
  // JSON by the image's full encoded size, an accepted tradeoff here
  // since there's no S3/CORS story to solve for either origin otherwise.
  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
      reader.readAsDataURL(file);
    });

  const addImage = async (file: File) => {
    const src = await readFileAsDataUrl(file);
    // Default to the full-bleed canvas, edge to edge, same as "Add Frame"
    // — not a box aspect-fit to the image's own shape. Aspect-fitting used
    // to be the default (see git history) to stop random art crops from
    // getting squished into a fixed box, but it has its own failure mode:
    // any imported image whose aspect ratio isn't *exactly* the canvas's
    // (which is normal — different print pipelines round pixel dimensions
    // differently) gets letterboxed with a visible gap on one axis instead
    // of actually reaching the edge, which defeats the point for an image
    // that's already meant to be the whole full-bleed card. `fit: "cover"`
    // preserves the image's own aspect ratio without distortion (no
    // squish) while guaranteeing the box itself is always filled — any
    // mismatch is cropped, invisibly, rather than left as a gap. A smaller
    // art crop not meant to fill the whole card can still be resized down
    // afterward, same as always.
    addLayer({
      id: newId(),
      name: file.name,
      type: "image",
      src,
      fit: "cover",
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      contentLocked: false,
      x: 0,
      y: 0,
      width: design.size.widthMm,
      height: design.size.heightMm,
    });
  };

  // Field id -> value, mirroring the ids text-template-library/ fields use
  // (title/manaCost/typeline/rules/flavor/powerToughness/artist) so each
  // maps onto the matching resolved template. Nickname, signature, and
  // edition have no generated-field equivalent and are deliberately left
  // out — nothing to fill them with.
  const fieldValues = (fields: GeneratedCardFields): Record<string, string | undefined> => ({
    title: fields.name,
    manaCost: fields.manaCost || undefined,
    typeline: fields.typeLine || undefined,
    rules: fields.rulesText || undefined,
    flavor: fields.flavorText || undefined,
    powerToughness: fields.powerToughness || undefined,
    artist: fields.artist ? `Illus. ${fields.artist}` : undefined,
  });

  /**
   * Adds all the text fields (and art, and a rarity symbol) a
   * GeneratedCardFields value has data for, as one undo step — the single
   * entry point every producer of that shape funnels through: an
   * ImportSourcePlugin's SearchComponent (see src/plugins.ts and the
   * "Import" button below) and the AI card-generation wizard's
   * `generated-fields` payload (embed.ts / designStore.ts's
   * pendingGeneratedCard) alike. Only fields with an actual value get
   * added — no placeholder text for e.g. a card with no flavor text.
   * Applies the same default groupings as "Add all fields"
   * (addAllTextFields above) — title+mana cost, typeline+rarity,
   * rules+flavour — restricted to whichever pairs this card actually had
   * both members for.
   *
   * `frameAssetId`, when given, adds a brand-new frame layer of that
   * asset and lays fields out against *its* category — the AI wizard
   * builds a design from nothing, so it has to choose a frame itself.
   * Left undefined (an import plugin's case), fields apply against
   * whatever frame — if any — is already on the canvas, unchanged from
   * before this was generalized.
   */
  const applyGeneratedFields = (fields: GeneratedCardFields, frameAssetId?: string) => {
    const frameAsset = frameAssetId ? getFrameAsset(frameAssetId) : undefined;
    const targetCategory = frameAsset?.category ?? activeFrameCategory;
    const targetTemplates = frameAsset ? getTextTemplates(targetCategory) : textTemplates;
    const values = fieldValues(fields);

    const importedTemplates = targetTemplates.filter((template) => values[template.id]);
    const textLayers = importedTemplates.map((template) => ({ ...templateToLayer(template), content: values[template.id]! }));

    const frameLayer: Layer | undefined = frameAsset
      ? {
          id: newId(),
          name: "Frame",
          type: "frame",
          assetId: frameAsset.id,
          rotationDeg: 0,
          opacity: 1,
          visible: true,
          locked: false,
          contentLocked: false,
          x: 0,
          y: 0,
          width: design.size.widthMm,
          height: design.size.heightMm,
        }
      : undefined;

    // Sized to the frame's actual illustration window, not the full-bleed
    // card — unlike addImage's default (a full pre-made card scan, already
    // shaped like the whole card), this is just the illustration on its
    // own, a much more landscape aspect ratio than the card itself.
    // Stretching it full-bleed with `fit: "cover"` (the old behavior)
    // forced that landscape image through a tall, narrow box, cropping
    // away roughly half of it on the sides. `fit: "cover"` within the
    // actual (much closer-to-landscape) window still crops to fill —
    // that's unavoidable without knowing the source image's exact aspect
    // — but nowhere near as much, and the result actually lands where a
    // card's illustration goes instead of behind the whole frame.
    const artLayer: Layer | undefined = fields.imageSrc
      ? {
          id: newId(),
          name: `${fields.name} (art)`,
          type: "image",
          src: fields.imageSrc,
          fit: "cover",
          rotationDeg: 0,
          opacity: 1,
          visible: true,
          locked: false,
          contentLocked: false,
          ...resolveArtWindowMm(targetCategory, design.size),
        }
      : undefined;

    // Frame and art both belong *beneath* existing/new text — addLayers
    // always appends at the top, which can't express that, so this builds
    // the full array directly and commits it via replaceLayers.
    const layers = [...design.layers];
    if (frameLayer) layers.unshift(frameLayer);
    if (artLayer) {
      const frameIndex = layers.findIndex((l) => l.type === "frame");
      if (frameIndex === -1) layers.unshift(artLayer);
      else layers.splice(frameIndex + 1, 0, artLayer);
    }
    layers.push(...textLayers);

    if (fields.rarity && RARITY_ASSETS.some((r) => r.id === fields.rarity)) {
      const url = getRarityAssetUrl(fields.rarity)!;
      const existingRarityIndex = layers.findIndex((l) => l.id === RARITY_LAYER_ID);
      if (existingRarityIndex !== -1) {
        layers[existingRarityIndex] = { ...layers[existingRarityIndex]!, assetId: fields.rarity, src: url } as Layer;
      } else {
        layers.push(buildRarityLayer(fields.rarity, url));
      }
    }

    // Rules and flavor (see rulesFlavorFit.ts) get re-fit against the
    // typeline/legal-row/power-toughness fields this same call just
    // added, before committing — same reasoning as addAllTextFields
    // above, one undo step instead of two.
    const patches = computeRulesFlavorPatch({ ...design, layers }, targetTemplates);
    const finalLayers = patches
      ? layers.map((l) => {
          const patch = patches.find((p) => p.id === l.id);
          return patch ? ({ ...l, ...patch.patch } as Layer) : l;
        })
      : layers;

    // Same default groupings as "Add all fields" (addAllTextFields above),
    // restricted to whichever fields were actually supplied — e.g. no
    // flavor text means no "Rules and flavour" group, since there's only
    // one member to put in it. groupContiguous (designStore.ts) silently
    // skips any def that resolves to fewer than two real layers, so it's
    // safe to always include "Typeline and rarity" whenever typeline was
    // supplied: it just no-ops if no rarity layer (pre-existing, updated
    // in place, or added by this same call above) ends up in finalLayers.
    const layerIdByFieldId = new Map(importedTemplates.map((t, i) => [t.id, textLayers[i]!.id]));
    const groupDefs: Array<{ name: string; layerIds: string[] }> = [];
    const titleId = layerIdByFieldId.get("title");
    const manaCostId = layerIdByFieldId.get("manaCost");
    if (titleId && manaCostId) groupDefs.push({ name: "Title and mana cost", layerIds: [titleId, manaCostId] });
    const typelineId = layerIdByFieldId.get("typeline");
    if (typelineId) groupDefs.push({ name: "Typeline and rarity", layerIds: [typelineId, RARITY_LAYER_ID] });
    const rulesId = layerIdByFieldId.get("rules");
    const flavorId = layerIdByFieldId.get("flavor");
    if (rulesId && flavorId) groupDefs.push({ name: "Rules and flavour", layerIds: [rulesId, flavorId] });

    const selectIds = [...(frameLayer ? [frameLayer.id] : []), ...(artLayer ? [artLayer.id] : []), ...textLayers.map((l) => l.id)];
    replaceLayers(finalLayers, selectIds, groupDefs);
  };

  // Applies the AI card-generation wizard's payload (embed.ts's
  // `generated-fields` attribute) exactly once, using this very first
  // render's empty design/no-frame state — pendingGeneratedCard only
  // starts non-null when that attribute was present at mount, and
  // clearing it immediately after is what keeps this from ever firing
  // again (a design reload, a re-mount, StrictMode's dev-only double
  // invoke — none of those see a non-null value a second time).
  useEffect(() => {
    if (!pendingGeneratedCard) return;
    applyGeneratedFields(pendingGeneratedCard.fields, pendingGeneratedCard.frameAssetId);
    clearPendingGeneratedCard();
  }, [pendingGeneratedCard]);

  /**
   * Places a freshly-generated AI art image (AiArtModal.tsx, via
   * aiArtBridge.ts) into the frame's illustration window — same sizing
   * and same "beneath the frame" stacking as importFromScryfall's art
   * layer above, since it's filling the identical role, just from a
   * prompt instead of a real card's art_crop.
   */
  const addAiArtLayer = (src: string) => {
    const artLayer: Layer = {
      id: newId(),
      name: "AI Art",
      type: "image",
      src,
      fit: "cover",
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      contentLocked: false,
      ...resolveArtWindowMm(activeFrameCategory, design.size),
    };

    const frameIndex = design.layers.findIndex((l) => l.type === "frame");
    if (frameIndex === -1) {
      addLayer(artLayer);
    } else {
      const layers = [...design.layers];
      layers.splice(frameIndex, 0, artLayer);
      replaceLayers(layers, [artLayer.id]);
    }

    setShowAiArtModal(false);
  };

  const addShape = () =>
    addLayer({
      id: newId(),
      name: "Shape",
      type: "shape",
      shape: "rect",
      fill: "#93c5fd",
      strokeWidthMm: 0,
      cornerRadiusMm: 0,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      contentLocked: false,
      ...centerBox(),
    });

  const handleExport = () => {
    const stage = stageRef.current;
    if (!stage) return;
    // Cut-line/safe-area/snap guides, the marquee, and the Transformer's
    // selection handles are editor-only overlays, not part of the card —
    // toDataURL() below is a literal snapshot of whatever the Konva stage
    // currently renders, so they have to be hidden (and a synchronous
    // .draw() forced, since toDataURL composites from each layer's own
    // already-rendered canvas rather than redrawing from scratch — an
    // async/batched redraw wouldn't be reflected yet) for the duration of
    // the capture, then restored.
    const hidden = stage.find(".cs-export-hide");
    hidden.forEach((node) => node.visible(false));
    stage.draw();
    const dataUrl = exportStageToPngDataUrl(stage, design.size, PRINT_DPI, { panX, panY, zoom });
    hidden.forEach((node) => node.visible(true));
    stage.draw();

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${design.name || "card"}.png`;
    link.click();
  };

  return (
    <div className="cs-root" style={{ display: "flex", alignItems: "center", gap: 6, padding: 8, borderBottom: "1px solid var(--cs-border)" }}>
      <button className="cs-btn" onClick={() => setShowFrameLibrary(true)}>
        <Frame size={16} /> Frame
      </button>
      <button className="cs-btn" onClick={addText}>
        <Type size={16} /> Text
      </button>
      <TextTemplateMenu templates={textTemplates} onAdd={addTextField} onAddAll={addAllTextFields} />
      <button className="cs-btn" onClick={addShape}>
        <Shapes size={16} /> Shape
      </button>
      <label className="cs-btn" style={{ cursor: "pointer" }}>
        <ImageUp size={16} /> Image
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void addImage(file);
            e.target.value = "";
          }}
        />
      </label>
      <select
        className="cs-input"
        style={{ width: 130 }}
        value={currentRarityId}
        onChange={(e) => setRarity(e.target.value)}
        disabled={rarityLocked}
        title={
          rarityLocked
            ? "Content-locked by default — requires a premium account to change"
            : "Rarity symbol — prefills its position from RARITY_SYMBOL_BOX in rarityConfig.ts"
        }
      >
        <option value="">Rarity…</option>
        {orderedRarities.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      {activeImportSource && (
        <button className="cs-btn" onClick={() => setShowImportSearch(true)} title={activeImportSource.description ?? `Import from ${activeImportSource.label}`}>
          <Search size={16} /> Import
        </button>
      )}
      <button
        className="cs-btn"
        onClick={() => setShowAiArtModal(true)}
        disabled={!entitlements.canGenerateAiArt}
        title={
          entitlements.canGenerateAiArt
            ? "Generate an illustration from a text prompt"
            : "Premium feature — upgrade for AI art generation"
        }
      >
        <Sparkles size={16} /> AI Art
      </button>

      <div className="cs-divider" />

      <button className="cs-icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
        <Undo2 size={16} />
      </button>
      <button className="cs-icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
        <Redo2 size={16} />
      </button>
      <button
        className="cs-icon-btn"
        onClick={() => duplicateLayers(selectedLayerIds)}
        disabled={selectedLayerIds.length === 0}
        title="Duplicate (Ctrl/Cmd+D)"
      >
        <Copy size={16} />
      </button>
      <button
        className="cs-icon-btn"
        onClick={() => removeLayers(selectedLayerIds)}
        disabled={selectedLayerIds.length === 0}
        title="Delete (Del)"
      >
        <Trash2 size={16} />
      </button>

      <div style={{ flex: 1 }} />

      <button
        className={`cs-icon-btn${showSafeArea ? " cs-active" : ""}`}
        onClick={toggleSafeArea}
        title="Toggle safe-area guide — nothing critical should sit outside it"
      >
        <Ruler size={16} />
      </button>
      <button
        className={`cs-icon-btn${!showBleed ? " cs-active" : ""}`}
        onClick={toggleBleed}
        title={showBleed ? "Preview trimmed card — hides the bleed margin and rounds the corners" : "Show full bleed"}
      >
        <Scissors size={16} />
      </button>
      <button
        className={`cs-icon-btn${isFullscreen ? " cs-active" : ""}`}
        onClick={onToggleFullscreen}
        title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
      >
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>

      <span
        style={{ alignSelf: "center", color: "var(--cs-text-muted)", fontSize: 12, cursor: "help" }}
        title={
          `Cut (final card): ${fmt(design.size.cutWidthMm)}×${fmt(design.size.cutHeightMm)}mm\n` +
          `Full bleed (art must extend to here): ${fmt(design.size.widthMm)}×${fmt(design.size.heightMm)}mm\n` +
          `Safe area (toggle above): ${fmt(design.size.safeWidthMm)}×${fmt(design.size.safeHeightMm)}mm`
        }
      >
        Cut {fmt(design.size.cutWidthMm)}×{fmt(design.size.cutHeightMm)}mm · bleed to {fmt(design.size.widthMm)}×
        {fmt(design.size.heightMm)}mm
      </span>
      {!hideLocalDesignLibrary && (
        <button className="cs-btn" onClick={() => setShowDesignLibrary(true)} title="Save or load a design">
          <Save size={16} /> Designs
        </button>
      )}
      {/* Same `hideLocalDesignLibrary` gate as the Designs button and the
          account button: a host embedding this editor with its own
          persistence (moxproxies-website) manages its own content and has
          no use for this app's community template gallery either. */}
      {!hideLocalDesignLibrary && (
        <button className="cs-btn" onClick={() => setShowTemplateBrowser(true)} title="Start a design from a community template, or publish this one as a template">
          <LayoutTemplate size={16} /> Templates
        </button>
      )}
      {!hideLocalDesignLibrary && <AccountButton />}
      <button className="cs-btn" onClick={handleExport} title={`Export PNG at ${PRINT_DPI} DPI`}>
        <Download size={16} /> Export ({PRINT_DPI} DPI)
      </button>

      {showDesignLibrary && (
        <DesignLibraryModal
          design={design}
          onRename={renameDesign}
          onSave={() => designStorage.save(design)}
          onNew={() => {
            loadDesign(createEmptyDesign(crypto.randomUUID(), STANDARD_CARD_SIZE_MM));
            setShowDesignLibrary(false);
          }}
          onLoad={(loaded) => {
            loadDesign(loaded);
            setShowDesignLibrary(false);
          }}
          onClose={() => setShowDesignLibrary(false)}
        />
      )}

      {showTemplateBrowser && (
        <TemplateBrowserModal
          design={design}
          onUseTemplate={(fromTemplate) => {
            // Exactly what loading a saved design does — a design started
            // from a template is an ordinary Design from here on, with the
            // template's lock flags carried through as authored (see
            // cardTemplates.ts's designFromTemplate).
            loadDesign(fromTemplate);
            setShowTemplateBrowser(false);
          }}
          onClose={() => setShowTemplateBrowser(false)}
        />
      )}

      {showFrameLibrary && (
        <FrameLibraryModal
          onSelect={(assetId) => {
            addFrame(assetId);
            setShowFrameLibrary(false);
          }}
          onClose={() => setShowFrameLibrary(false)}
        />
      )}

      {showImportSearch && activeImportSource && (
        <activeImportSource.SearchComponent
          onImport={(fields) => {
            applyGeneratedFields(fields);
            setShowImportSearch(false);
          }}
          onClose={() => setShowImportSearch(false)}
        />
      )}

      {showAiArtModal && <AiArtModal onGenerated={addAiArtLayer} onClose={() => setShowAiArtModal(false)} />}
    </div>
  );
}
