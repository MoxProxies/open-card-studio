import { create } from "zustand";
import type { Design, Layer, LayerGroup } from "@card-studio/scene-schema";
import { type Entitlements, DEFAULT_ENTITLEMENTS } from "../entitlements";
import type { GeneratedCardFields } from "../generatedCardFields";
import { randomUUID } from "../uuid";

const HISTORY_LIMIT = 50;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

function applyPatch(design: Design, id: string, patch: Partial<Layer>): Design {
  return {
    ...design,
    layers: design.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
  };
}

function applyPatches(design: Design, entries: Array<{ id: string; patch: Partial<Layer> }>): Design {
  const patchMap = new Map(entries.map((e) => [e.id, e.patch]));
  return {
    ...design,
    layers: design.layers.map((l) => (patchMap.has(l.id) ? ({ ...l, ...patchMap.get(l.id) } as Layer) : l)),
  };
}

function cloneLayerWithOffset(layer: Layer, offsetMm: number): Layer {
  return { ...layer, id: randomUUID(), name: `${layer.name} copy`, x: layer.x + offsetMm, y: layer.y + offsetMm };
}

/** Where a newly added single layer goes in z-order: directly above (in
 * front of) the topmost currently-selected layer, rather than always at
 * the very top of the whole stack — lets "add a text layer" while a
 * specific background image is selected land right above just that
 * image, not above everything else already stacked on top of it. Falls
 * back to appending at the very top when nothing's selected (the only
 * behavior before this existed). Purely a z-order position — the new
 * layer doesn't inherit the reference layer's groupId, even if it's
 * grouped. */
function insertAboveSelection(layers: Layer[], newLayer: Layer, selectedIds: string[]): Layer[] {
  let topIndex = -1;
  layers.forEach((l, i) => {
    if (selectedIds.includes(l.id)) topIndex = i;
  });
  if (topIndex === -1) return [...layers, newLayer];
  return [...layers.slice(0, topIndex + 1), newLayer, ...layers.slice(topIndex + 1)];
}

/** Tags every layer whose id is in `layerIds` with `groupId`, first moving
 * them contiguous in z-order (near the topmost original member's
 * position) if they aren't already — see LayerBase.groupId's doc comment
 * for why grouped layers are expected to sit contiguous in `layers`.
 * Fewer than two ids resolving to real layers is a no-op (returns `layers`
 * unchanged) — nothing meaningful to group. Pure; caller decides whether
 * to also register the group in Design.groups (skip that if this was a
 * no-op). */
function groupContiguous(layers: Layer[], layerIds: string[], groupId: string): Layer[] {
  const idsSet = new Set(layerIds);
  const members = layers.filter((l) => idsSet.has(l.id));
  if (members.length < 2) return layers;
  const grouped = members.map((l) => ({ ...l, groupId }) as Layer);
  const remaining = layers.filter((l) => !idsSet.has(l.id));
  const topMemberIndex = Math.max(...layers.map((l, i) => (idsSet.has(l.id) ? i : -1)));
  const insertAt = layers.slice(0, topMemberIndex + 1).filter((l) => !idsSet.has(l.id)).length;
  return [...remaining.slice(0, insertAt), ...grouped, ...remaining.slice(insertAt)];
}

export interface DesignState {
  design: Design;
  past: Design[];
  future: Design[];
  /** Snapshot captured at the start of an in-progress continuous edit (e.g. typing), pending commitLiveEdit(). */
  pendingSnapshot: Design | null;
  selectedLayerIds: string[];
  /** View-only UI preference, not part of the design or undo history. */
  showSafeArea: boolean;
  /** View-only UI preference, not part of the design or undo history. False
   * masks the bleed margin (rounded to a die-cut-style corner radius) so
   * the canvas previews how the card looks once trimmed — see
   * CanvasStage's BLEED_MASK_CORNER_RADIUS_MM. Doesn't affect the print
   * export (services/render always renders the full bleed box from the
   * design JSON, never this view flag), only this client-side quick-proof
   * canvas — same as the cut-line/safe-area guides, which already bake
   * into that export today. */
  showBleed: boolean;
  /** What the current user is allowed to do with contentLocked layers —
   * see entitlements.ts. View-only, not part of the design or undo
   * history (who's allowed to edit what isn't a property of the design
   * itself) — set at store creation from whatever the host page knows
   * (embed.ts's `can-edit-locked-content` attribute) and updatable live
   * via setEntitlements (embed.ts's `setEntitlements()` method), e.g.
   * once an async auth check resolves after mount. */
  entitlements: Entitlements;
  /** True when the host page already provides its own save/persistence
   * UI (e.g. moxproxies-website's own "Save" button, which POSTs to its
   * own backend — see card-studio's README, "How this is meant to
   * connect to moxproxies-website") and Card Studio's own localStorage-
   * based "Designs" button (designStorage.ts/DesignLibraryModal.tsx)
   * should stay hidden rather than sit next to it as a second, easily
   * confused "save" that silently only persists to that one browser.
   * Set once at store creation from embed.ts's `hide-local-design-
   * library` attribute; false (the toolbar button shows, as it always
   * has) for the standalone dev entry point (main.tsx), which has no
   * other persistence to defer to. */
  hideLocalDesignLibrary: boolean;
  /** Canvas view transform (view-only, not part of the design or undo
   * history). zoom 1 = the editor's native EDITOR_DPI resolution; pan is in
   * screen pixels, applied to the pan/zoom Group, not the Stage itself. */
  zoom: number;
  panX: number;
  panY: number;

  /** A design's worth of AI-generated field values (moxproxies-website's
   * AI card-generation wizard — see embed.ts's `generated-fields`
   * attribute), waiting to be applied by Toolbar.tsx's one-time mount
   * effect via applyGeneratedFields. Set once at store creation, same as
   * initialDesign/initialEntitlements; not itself part of the design or
   * undo history, since applying it *produces* the design's actual first
   * undo-history entry. Consumed and cleared (clearPendingGeneratedCard)
   * the moment that effect runs — never re-applied if the design later
   * reloads or a component remounts. */
  pendingGeneratedCard: { fields: GeneratedCardFields; frameAssetId?: string } | null;
  clearPendingGeneratedCard: () => void;

  toggleSafeArea: () => void;
  toggleBleed: () => void;
  setEntitlements: (entitlements: Entitlements) => void;
  /** Sets zoom, optionally keeping a screen-space point (e.g. the cursor)
   * stationary by adjusting pan to compensate. */
  setZoom: (zoom: number, focal?: { x: number; y: number }) => void;
  setPan: (x: number, y: number) => void;
  panBy: (dxScreenPx: number, dyScreenPx: number) => void;

  selectOnly: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;

  /** Inserts one new layer directly above the topmost currently-selected
   * layer in z-order (see insertAboveSelection), or at the very top of
   * the stack if nothing's selected. Used by every "add a single layer"
   * toolbar action (Frame/Text/Shape/Image, the rarity dropdown). */
  addLayer: (layer: Layer) => void;
  /** Adds multiple layers as a single undo step (e.g. "add all text
   * fields") — always appended at the very top, unlike addLayer;
   * multi-layer adds aren't "insert above the selection" today. */
  addLayers: (layers: Layer[]) => void;
  /** Adds new layers and, in the same undo step, groups them (optionally
   * together with already-existing layers, e.g. a rarity symbol added on
   * an earlier click) per `groupDefs` — each entry's `layerIds` names every
   * member of that group, new and/or pre-existing. A group definition
   * that resolves to fewer than two real layers is silently skipped (see
   * groupContiguous). Used by "Add all fields"'s default groupings. */
  addLayersWithGroups: (newLayers: Layer[], groupDefs: Array<{ name: string; layerIds: string[] }>) => void;
  /** Replaces the whole layer array in one undo step, selecting `selectIds`
   * — for operations needing specific z-order control addLayers's
   * always-append can't give (e.g. Scryfall import slotting art beneath an
   * existing frame while adding text fields on top, together). Optional
   * `groupDefs` — same shape/semantics as addLayersWithGroups's (each
   * resolved via groupContiguous against the *replaced* array, silently
   * skipped if it resolves to fewer than two real layers) — for callers
   * that also need default groupings applied as part of that same undo
   * step, e.g. Scryfall import mirroring "Add all fields"'s groupings but
   * only for whichever fields the imported card actually had values for. */
  replaceLayers: (layers: Layer[], selectIds: string[], groupDefs?: Array<{ name: string; layerIds: string[] }>) => void;
  removeLayers: (ids: string[]) => void;
  duplicateLayers: (ids: string[]) => void;
  moveLayer: (id: string, direction: "up" | "down") => void;
  /** General-purpose free reordering (drag-and-drop in the layer panel) —
   * rebuilds `layers` to match `newOrderIds` exactly. A no-op (state
   * unchanged, no history entry) if the id set doesn't match the design's
   * current layers, e.g. a stale drag after some other change. */
  reorderLayers: (newOrderIds: string[]) => void;
  nudgeLayers: (ids: string[], dxMm: number, dyMm: number) => void;
  renameDesign: (name: string) => void;
  /** Wholesale-replaces the design (loading a saved one, or starting a
   * fresh one) — clears undo/redo history and selection along with it,
   * same as opening a different document in any other editor. Not itself
   * undoable (there's nothing to return *to* once history is cleared);
   * see DesignLibraryModal.tsx. */
  loadDesign: (design: Design) => void;

  /** Groups >= 2 layers under a new named LayerGroup, moving them
   * contiguous in z-order first (near the topmost selected layer's
   * original position) — see LayerBase.groupId's doc comment for why
   * contiguity matters. Selects the grouped layers. No-op if fewer than
   * two ids resolve to real layers. */
  groupLayers: (layerIds: string[], name: string) => void;
  /** Dissolves a group (clears groupId on its members) without deleting
   * them. */
  ungroupLayers: (groupId: string) => void;
  /** Deletes a group *and* every layer currently in it. */
  deleteGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;

  /** One discrete, undoable change (drag end, transform end, a single control commit). */
  commitLayerChange: (id: string, patch: Partial<Layer>) => void;
  commitLayerChanges: (entries: Array<{ id: string; patch: Partial<Layer> }>) => void;

  /** For continuous edits (typing, slider drag): live-updates with no history entry,
   * bracketed by beginLiveEdit()/commitLiveEdit() to record exactly one undo step. */
  beginLiveEdit: () => void;
  updateLayerLive: (id: string, patch: Partial<Layer>) => void;
  commitLiveEdit: () => void;

  undo: () => void;
  redo: () => void;
}

export function createDesignStore(
  initialDesign: Design,
  initialEntitlements: Entitlements = DEFAULT_ENTITLEMENTS,
  hideLocalDesignLibrary: boolean = false,
  pendingGeneratedCard: { fields: GeneratedCardFields; frameAssetId?: string } | null = null
) {
  return create<DesignState>((set) => ({
    design: initialDesign,
    past: [],
    future: [],
    pendingSnapshot: null,
    selectedLayerIds: [],
    showSafeArea: true,
    showBleed: true,
    entitlements: initialEntitlements,
    hideLocalDesignLibrary,
    zoom: 1,
    panX: 0,
    panY: 0,
    pendingGeneratedCard,

    clearPendingGeneratedCard: () => set({ pendingGeneratedCard: null }),
    toggleSafeArea: () => set((state) => ({ showSafeArea: !state.showSafeArea })),
    toggleBleed: () => set((state) => ({ showBleed: !state.showBleed })),
    setEntitlements: (entitlements) => set({ entitlements }),

    setZoom: (zoom, focal) =>
      set((state) => {
        const clamped = clampZoom(zoom);
        if (!focal) return { zoom: clamped };
        // Keep the model-space point currently under `focal` stationary on
        // screen: solve for the new pan given the same local point at the
        // new scale.
        const localX = (focal.x - state.panX) / state.zoom;
        const localY = (focal.y - state.panY) / state.zoom;
        return {
          zoom: clamped,
          panX: focal.x - localX * clamped,
          panY: focal.y - localY * clamped,
        };
      }),
    setPan: (x, y) => set({ panX: x, panY: y }),
    panBy: (dxScreenPx, dyScreenPx) => set((state) => ({ panX: state.panX + dxScreenPx, panY: state.panY + dyScreenPx })),

    selectOnly: (id) => set({ selectedLayerIds: id ? [id] : [] }),
    toggleSelect: (id) =>
      set((state) => ({
        selectedLayerIds: state.selectedLayerIds.includes(id)
          ? state.selectedLayerIds.filter((sid) => sid !== id)
          : [...state.selectedLayerIds, id],
      })),
    setSelection: (ids) => set({ selectedLayerIds: ids }),
    clearSelection: () => set({ selectedLayerIds: [] }),

    addLayer: (layer) =>
      set((state) => ({
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
        design: { ...state.design, layers: insertAboveSelection(state.design.layers, layer, state.selectedLayerIds) },
        selectedLayerIds: [layer.id],
      })),

    addLayers: (layers) =>
      set((state) => ({
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
        design: { ...state.design, layers: [...state.design.layers, ...layers] },
        selectedLayerIds: layers.map((l) => l.id),
      })),

    replaceLayers: (layers, selectIds, groupDefs) =>
      set((state) => {
        let nextLayers = layers;
        const groups: LayerGroup[] = [...state.design.groups];
        for (const def of groupDefs ?? []) {
          const groupId = randomUUID();
          const next = groupContiguous(nextLayers, def.layerIds, groupId);
          if (next === nextLayers) continue;
          nextLayers = next;
          groups.push({ id: groupId, name: def.name });
        }
        return {
          past: [...state.past, state.design].slice(-HISTORY_LIMIT),
          future: [],
          design: { ...state.design, layers: nextLayers, groups },
          selectedLayerIds: selectIds,
        };
      }),

    removeLayers: (ids) =>
      set((state) => ({
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
        design: { ...state.design, layers: state.design.layers.filter((l) => !ids.includes(l.id)) },
        selectedLayerIds: state.selectedLayerIds.filter((id) => !ids.includes(id)),
      })),

    duplicateLayers: (ids) =>
      set((state) => {
        const clones = state.design.layers.filter((l) => ids.includes(l.id)).map((l) => cloneLayerWithOffset(l, 4));
        return {
          past: [...state.past, state.design].slice(-HISTORY_LIMIT),
          future: [],
          design: { ...state.design, layers: [...state.design.layers, ...clones] },
          selectedLayerIds: clones.map((c) => c.id),
        };
      }),

    moveLayer: (id, direction) =>
      set((state) => {
        const layers = [...state.design.layers];
        const index = layers.findIndex((l) => l.id === id);
        if (index === -1) return state;
        const swapWith = direction === "up" ? index + 1 : index - 1;
        if (swapWith < 0 || swapWith >= layers.length) return state;
        [layers[index], layers[swapWith]] = [layers[swapWith]!, layers[index]!];
        return { past: [...state.past, state.design].slice(-HISTORY_LIMIT), future: [], design: { ...state.design, layers } };
      }),

    reorderLayers: (newOrderIds) =>
      set((state) => {
        const byId = new Map(state.design.layers.map((l) => [l.id, l]));
        const layers = newOrderIds.map((id) => byId.get(id)).filter((l): l is Layer => l !== undefined);
        if (layers.length !== state.design.layers.length) return state;
        return { past: [...state.past, state.design].slice(-HISTORY_LIMIT), future: [], design: { ...state.design, layers } };
      }),

    nudgeLayers: (ids, dxMm, dyMm) =>
      set((state) => {
        // Arrow-key nudge respects `locked` the same as canvas dragging
        // does (LayerNode.tsx's `draggable`) — a locked layer among a
        // multi-selection just doesn't move while its unlocked
        // selection-mates do.
        const entries = state.design.layers
          .filter((l) => ids.includes(l.id) && !l.locked)
          .map((l) => ({ id: l.id, patch: { x: l.x + dxMm, y: l.y + dyMm } }));
        if (entries.length === 0) return state;
        return {
          past: [...state.past, state.design].slice(-HISTORY_LIMIT),
          future: [],
          design: applyPatches(state.design, entries),
        };
      }),

    renameDesign: (name) =>
      set((state) => ({
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
        design: { ...state.design, name },
      })),

    loadDesign: (design) => set({ design, past: [], future: [], pendingSnapshot: null, selectedLayerIds: [] }),

    groupLayers: (layerIds, name) =>
      set((state) => {
        const groupId = randomUUID();
        const layers = groupContiguous(state.design.layers, layerIds, groupId);
        if (layers === state.design.layers) return state;
        return {
          past: [...state.past, state.design].slice(-HISTORY_LIMIT),
          future: [],
          design: { ...state.design, layers, groups: [...state.design.groups, { id: groupId, name }] },
          selectedLayerIds: layerIds,
        };
      }),

    addLayersWithGroups: (newLayers, groupDefs) =>
      set((state) => {
        let layers = [...state.design.layers, ...newLayers];
        const groups: LayerGroup[] = [...state.design.groups];
        for (const def of groupDefs) {
          const groupId = randomUUID();
          const next = groupContiguous(layers, def.layerIds, groupId);
          if (next === layers) continue;
          layers = next;
          groups.push({ id: groupId, name: def.name });
        }
        return {
          past: [...state.past, state.design].slice(-HISTORY_LIMIT),
          future: [],
          design: { ...state.design, layers, groups },
          selectedLayerIds: newLayers.map((l) => l.id),
        };
      }),

    ungroupLayers: (groupId) =>
      set((state) => ({
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
        design: {
          ...state.design,
          layers: state.design.layers.map((l) => (l.groupId === groupId ? ({ ...l, groupId: undefined } as Layer) : l)),
          groups: state.design.groups.filter((g) => g.id !== groupId),
        },
      })),

    deleteGroup: (groupId) =>
      set((state) => {
        const removedIds = new Set(state.design.layers.filter((l) => l.groupId === groupId).map((l) => l.id));
        return {
          past: [...state.past, state.design].slice(-HISTORY_LIMIT),
          future: [],
          design: {
            ...state.design,
            layers: state.design.layers.filter((l) => l.groupId !== groupId),
            groups: state.design.groups.filter((g) => g.id !== groupId),
          },
          selectedLayerIds: state.selectedLayerIds.filter((id) => !removedIds.has(id)),
        };
      }),

    renameGroup: (groupId, name) =>
      set((state) => ({
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
        design: { ...state.design, groups: state.design.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) },
      })),

    commitLayerChange: (id, patch) =>
      set((state) => ({
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
        design: applyPatch(state.design, id, patch),
      })),

    commitLayerChanges: (entries) =>
      set((state) => ({
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
        design: applyPatches(state.design, entries),
      })),

    beginLiveEdit: () => set((state) => (state.pendingSnapshot ? state : { pendingSnapshot: state.design })),
    updateLayerLive: (id, patch) => set((state) => ({ design: applyPatch(state.design, id, patch) })),
    commitLiveEdit: () =>
      set((state) => {
        if (!state.pendingSnapshot) return state;
        return { past: [...state.past, state.pendingSnapshot].slice(-HISTORY_LIMIT), future: [], pendingSnapshot: null };
      }),

    undo: () =>
      set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous) return state;
        const liveIds = new Set(previous.layers.map((l) => l.id));
        return {
          design: previous,
          past: state.past.slice(0, -1),
          future: [state.design, ...state.future],
          selectedLayerIds: state.selectedLayerIds.filter((id) => liveIds.has(id)),
        };
      }),

    redo: () =>
      set((state) => {
        const next = state.future[0];
        if (!next) return state;
        const liveIds = new Set(next.layers.map((l) => l.id));
        return {
          design: next,
          past: [...state.past, state.design],
          future: state.future.slice(1),
          selectedLayerIds: state.selectedLayerIds.filter((id) => liveIds.has(id)),
        };
      }),
  }));
}

export type DesignStore = ReturnType<typeof createDesignStore>;
