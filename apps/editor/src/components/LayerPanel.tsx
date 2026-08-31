import { useState, type CSSProperties, type DragEvent } from "react";
import { Frame, Type, Shapes, Image as ImageIcon, Trash2, Eye, EyeOff, Lock, Unlock, GripVertical, Folder, Ungroup, ChevronUp, ChevronDown, ChevronRight } from "lucide-react";
import type { Layer } from "@card-studio/scene-schema";
import { useDesignStore } from "../store/DesignProvider";

const TYPE_ICONS: Record<Layer["type"], typeof Frame> = {
  frame: Frame,
  text: Type,
  shape: Shapes,
  image: ImageIcon,
};

type Entry = { kind: "layer"; layer: Layer } | { kind: "group"; groupId: string; name: string; members: Layer[] };

/** Front-most (top of panel) first — the reverse of `layers`' back-to-front
 * z-order. Consecutive layers sharing a groupId become one group entry;
 * see LayerBase.groupId's doc comment for why grouped layers are expected
 * to already sit contiguous in `layers` (designStore.ts's groupLayers
 * enforces it when a group is created — this just trusts that invariant
 * rather than re-deriving it, so a groupId that somehow isn't contiguous
 * would render as more than one cluster with the same name instead of one). */
function buildEntries(layers: Layer[], groupNames: Map<string, string>): Entry[] {
  const display = [...layers].reverse();
  const entries: Entry[] = [];
  let i = 0;
  while (i < display.length) {
    const layer = display[i]!;
    const groupId = layer.groupId;
    if (groupId && groupNames.has(groupId)) {
      const members: Layer[] = [];
      while (i < display.length && display[i]!.groupId === groupId) {
        members.push(display[i]!);
        i++;
      }
      entries.push({ kind: "group", groupId, name: groupNames.get(groupId)!, members });
    } else {
      entries.push({ kind: "layer", layer });
      i++;
    }
  }
  return entries;
}

const entryRowId = (e: Entry) => (e.kind === "group" ? `group:${e.groupId}` : e.layer.id);
const iconBtnStyle = { width: 20, height: 20, flex: "none" };

/** `width` is a number for the desktop resizable column and "100%" when
 * the panel fills the editor's mobile bottom sheet (App.tsx). */
export function LayerPanel({ width }: { width: number | string }) {
  const layers = useDesignStore((s) => s.design.layers);
  const groups = useDesignStore((s) => s.design.groups);
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds);
  const selectOnly = useDesignStore((s) => s.selectOnly);
  const toggleSelect = useDesignStore((s) => s.toggleSelect);
  const setSelection = useDesignStore((s) => s.setSelection);
  const removeLayers = useDesignStore((s) => s.removeLayers);
  const commitLayerChange = useDesignStore((s) => s.commitLayerChange);
  const commitLayerChanges = useDesignStore((s) => s.commitLayerChanges);
  const reorderLayers = useDesignStore((s) => s.reorderLayers);
  const ungroupLayers = useDesignStore((s) => s.ungroupLayers);
  const deleteGroup = useDesignStore((s) => s.deleteGroup);
  const renameGroup = useDesignStore((s) => s.renameGroup);

  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ rowId: string; position: "before" | "after" } | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  // View-only, like showSafeArea/showBleed in the store — which groups are
  // expanded doesn't need to survive a reload, and it's local to this one
  // panel, so plain component state is enough (no need to thread it
  // through the design store).
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const toggleCollapsed = (groupId: string) =>
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  const groupNames = new Map(groups.map((g) => [g.id, g.name]));
  const entries = buildEntries(layers, groupNames);

  // Drag-and-drop reorders *entries* (a standalone layer, or a whole group
  // block moved as one unit), then flattens back to a full layer id list —
  // display order (front-most first) reversed back to z-order (back-to-
  // front) — for reorderLayers. Within-group member order isn't
  // drag-reorderable (the small up/down buttons on member rows below cover
  // that instead); only top-level entries are.
  const handleDrop = () => {
    if (!draggingRowId || !dropTarget) return;
    const fromIndex = entries.findIndex((e) => entryRowId(e) === draggingRowId);
    if (fromIndex === -1) return;
    const next = [...entries];
    const [moved] = next.splice(fromIndex, 1);
    const targetIndex = next.findIndex((e) => entryRowId(e) === dropTarget.rowId);
    if (targetIndex === -1) return;
    const insertAt = dropTarget.position === "before" ? targetIndex : targetIndex + 1;
    next.splice(insertAt, 0, moved!);
    const displayIds = next.flatMap((e) => (e.kind === "layer" ? [e.layer.id] : e.members.map((m) => m.id)));
    reorderLayers([...displayIds].reverse());
    setDraggingRowId(null);
    setDropTarget(null);
  };

  const dragHandleProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      setDraggingRowId(id);
    },
    onDragEnd: () => {
      setDraggingRowId(null);
      setDropTarget(null);
    },
  });

  const rowDropProps = (id: string) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!draggingRowId || draggingRowId === id) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const position: "before" | "after" = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
      setDropTarget({ rowId: id, position });
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      handleDrop();
    },
  });

  const dropIndicatorStyle = (id: string): CSSProperties =>
    dropTarget?.rowId === id
      ? dropTarget.position === "before"
        ? { boxShadow: "inset 0 2px 0 var(--cs-accent)" }
        : { boxShadow: "inset 0 -2px 0 var(--cs-accent)" }
      : {};

  // The button fallback for top-level reordering (touch browsers don't fire
  // HTML5 drag events without a polyfill, so dragHandleProps below is
  // mouse-only) — mirrors moveMemberWithinGroup's swap-and-flatten shape,
  // just over `entries` instead of one group's `members`.
  const moveEntry = (rowId: string, direction: "up" | "down") => {
    const idx = entries.findIndex((e) => entryRowId(e) === rowId);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || swapWith < 0 || swapWith >= entries.length) return;
    const next = [...entries];
    [next[idx], next[swapWith]] = [next[swapWith]!, next[idx]!];
    const displayIds = next.flatMap((e) => (e.kind === "layer" ? [e.layer.id] : e.members.map((m) => m.id)));
    reorderLayers([...displayIds].reverse());
  };

  const moveMemberWithinGroup = (members: Layer[], layerId: string, direction: "up" | "down") => {
    const idx = members.findIndex((m) => m.id === layerId);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || swapWith < 0 || swapWith >= members.length) return;
    const newMembers = [...members];
    [newMembers[idx], newMembers[swapWith]] = [newMembers[swapWith]!, newMembers[idx]!];
    const displayIds = [...layers].reverse().map((l) => l.id);
    const memberIdSet = new Set(members.map((m) => m.id));
    let mi = 0;
    const newDisplayIds = displayIds.map((id) => (memberIdSet.has(id) ? newMembers[mi++]!.id : id));
    reorderLayers([...newDisplayIds].reverse());
  };

  const commitGroupRename = (groupId: string) => {
    renameGroup(groupId, editingName.trim() || "Group");
    setEditingGroupId(null);
  };

  return (
    <div
      className="cs-root"
      style={{ width, flex: "none", minWidth: 0, borderLeft: "1px solid var(--cs-border)", padding: 8, overflowY: "auto", overflowX: "hidden" }}
    >
      <h3 className="cs-heading" style={{ fontSize: 14, fontWeight: 600, margin: "4px 0 8px" }}>Layers</h3>
      {entries.map((entry, entryIndex) => {
        const rowId = entryRowId(entry);
        const isFirstEntry = entryIndex === 0;
        const isLastEntry = entryIndex === entries.length - 1;

        if (entry.kind === "layer") {
          const layer = entry.layer;
          const isSelected = selectedLayerIds.includes(layer.id);
          const TypeIcon = TYPE_ICONS[layer.type];
          return (
            <div
              key={rowId}
              data-testid="layer-row"
              data-layer-id={layer.id}
              onClick={(e) => (e.shiftKey ? toggleSelect(layer.id) : selectOnly(layer.id))}
              {...rowDropProps(rowId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "5px 6px",
                borderRadius: 6,
                marginBottom: 2,
                cursor: "pointer",
                background: isSelected ? "var(--cs-accent-soft)" : "transparent",
                fontSize: 13,
                ...dropIndicatorStyle(rowId),
              }}
            >
              <span {...dragHandleProps(rowId)} style={{ display: "flex", flex: "none", cursor: "grab", color: "var(--cs-text-muted)" }} title="Drag to reorder">
                <GripVertical size={13} />
              </span>
              <TypeIcon size={14} color="var(--cs-text-muted)" style={{ flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{layer.name}</span>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title="Move up"
                disabled={isFirstEntry}
                onClick={(e) => {
                  e.stopPropagation();
                  moveEntry(rowId, "up");
                }}
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title="Move down"
                disabled={isLastEntry}
                onClick={(e) => {
                  e.stopPropagation();
                  moveEntry(rowId, "down");
                }}
              >
                <ChevronDown size={14} />
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title={layer.visible ? "Hide" : "Show"}
                onClick={(e) => {
                  e.stopPropagation();
                  commitLayerChange(layer.id, { visible: !layer.visible });
                }}
              >
                {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title={layer.locked ? "Unlock" : "Lock"}
                onClick={(e) => {
                  e.stopPropagation();
                  commitLayerChange(layer.id, { locked: !layer.locked });
                }}
              >
                {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  removeLayers([layer.id]);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        }

        const { groupId, name, members } = entry;
        const memberIds = members.map((m) => m.id);
        const isGroupSelected = memberIds.every((id) => selectedLayerIds.includes(id));
        const allVisible = members.every((m) => m.visible);
        const allLocked = members.every((m) => m.locked);
        const isEditing = editingGroupId === groupId;
        const isCollapsed = collapsedGroupIds.has(groupId);

        return (
          <div key={rowId} style={{ marginBottom: 2, ...dropIndicatorStyle(rowId) }} {...rowDropProps(rowId)}>
            <div
              data-testid="layer-group-row"
              data-group-id={groupId}
              onClick={(e) => {
                if (e.shiftKey) {
                  setSelection(isGroupSelected ? selectedLayerIds.filter((id) => !memberIds.includes(id)) : [...new Set([...selectedLayerIds, ...memberIds])]);
                } else {
                  setSelection(memberIds);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "5px 6px",
                borderRadius: 6,
                cursor: "pointer",
                background: isGroupSelected ? "var(--cs-accent-soft)" : "transparent",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span {...dragHandleProps(rowId)} style={{ display: "flex", flex: "none", cursor: "grab", color: "var(--cs-text-muted)" }} title="Drag to reorder">
                <GripVertical size={13} />
              </span>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title={isCollapsed ? "Expand group" : "Collapse group"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(groupId);
                }}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              <Folder size={14} color="var(--cs-text-muted)" style={{ flex: "none" }} />
              {isEditing ? (
                <input
                  className="cs-input"
                  autoFocus
                  value={editingName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => commitGroupRename(groupId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitGroupRename(groupId);
                    if (e.key === "Escape") setEditingGroupId(null);
                  }}
                  style={{ flex: 1, minWidth: 0, fontWeight: 600 }}
                />
              ) : (
                <span
                  style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingGroupId(groupId);
                    setEditingName(name);
                  }}
                  title="Double-click to rename"
                >
                  {name}
                </span>
              )}
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title="Move up"
                disabled={isFirstEntry}
                onClick={(e) => {
                  e.stopPropagation();
                  moveEntry(rowId, "up");
                }}
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title="Move down"
                disabled={isLastEntry}
                onClick={(e) => {
                  e.stopPropagation();
                  moveEntry(rowId, "down");
                }}
              >
                <ChevronDown size={14} />
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title={allVisible ? "Hide group" : "Show group"}
                onClick={(e) => {
                  e.stopPropagation();
                  commitLayerChanges(memberIds.map((id) => ({ id, patch: { visible: !allVisible } })));
                }}
              >
                {allVisible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title={allLocked ? "Unlock group" : "Lock group"}
                onClick={(e) => {
                  e.stopPropagation();
                  commitLayerChanges(memberIds.map((id) => ({ id, patch: { locked: !allLocked } })));
                }}
              >
                {allLocked ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title="Ungroup (keeps the layers)"
                onClick={(e) => {
                  e.stopPropagation();
                  ungroupLayers(groupId);
                }}
              >
                <Ungroup size={13} />
              </button>
              <button
                className="cs-icon-btn"
                style={iconBtnStyle}
                title="Delete group and its layers"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteGroup(groupId);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>

            {!isCollapsed && members.map((layer, mi) => {
              const isSelected = selectedLayerIds.includes(layer.id);
              const TypeIcon = TYPE_ICONS[layer.type];
              return (
                <div
                  key={layer.id}
                  data-testid="layer-row"
                  data-layer-id={layer.id}
                  onClick={(e) => (e.shiftKey ? toggleSelect(layer.id) : selectOnly(layer.id))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    padding: "5px 6px 5px 18px",
                    borderRadius: 6,
                    marginTop: 2,
                    cursor: "pointer",
                    background: isSelected ? "var(--cs-accent-soft)" : "transparent",
                    fontSize: 13,
                  }}
                >
                  <TypeIcon size={14} color="var(--cs-text-muted)" style={{ flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{layer.name}</span>
                  <button
                    className="cs-icon-btn"
                    style={iconBtnStyle}
                    title="Move up in group"
                    disabled={mi === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveMemberWithinGroup(members, layer.id, "up");
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    className="cs-icon-btn"
                    style={iconBtnStyle}
                    title="Move down in group"
                    disabled={mi === members.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveMemberWithinGroup(members, layer.id, "down");
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    className="cs-icon-btn"
                    style={iconBtnStyle}
                    title={layer.visible ? "Hide" : "Show"}
                    onClick={(e) => {
                      e.stopPropagation();
                      commitLayerChange(layer.id, { visible: !layer.visible });
                    }}
                  >
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    className="cs-icon-btn"
                    style={iconBtnStyle}
                    title={layer.locked ? "Unlock" : "Lock"}
                    onClick={(e) => {
                      e.stopPropagation();
                      commitLayerChange(layer.id, { locked: !layer.locked });
                    }}
                  >
                    {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                  <button
                    className="cs-icon-btn"
                    style={iconBtnStyle}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLayers([layer.id]);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      {layers.length === 0 && <p style={{ color: "var(--cs-text-muted)", fontSize: 12 }}>No layers yet.</p>}
    </div>
  );
}
