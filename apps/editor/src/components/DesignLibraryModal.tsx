import { useEffect, useState, type MouseEvent } from "react";
import { Save, FilePlus, FolderOpen, Trash2, Loader2 } from "lucide-react";
import type { Design } from "@card-studio/scene-schema";
import { designStorage, type DesignSummary } from "../designStorage";
import { apiErrorMessage } from "../api/client";
import { publishDesign } from "../api/apiDesignStorage";
import { VISIBILITIES, VISIBILITY_LABELS, type Visibility } from "../visibility";
import { Modal } from "./Modal";

interface DesignLibraryModalProps {
  design: Design;
  onRename: (name: string) => void;
  onSave: () => Promise<unknown>;
  onNew: () => void;
  onLoad: (design: Design) => void;
  onClose: () => void;
}

/**
 * Save/load UI over designStorage — backed by either localStorage or
 * backend/'s API depending on whether the shopper is signed in (see
 * designStorage.ts's doc comment and AccountButton.tsx). Every operation
 * here is async now that a real network call can be behind it, unlike
 * the localStorage-only version this was originally built against — the
 * loading/error states below exist because of that, not because the
 * localStorage path ever needed them. Deliberately name-and-list, not a
 * grid with thumbnails: generating a preview image per save is real extra
 * work (a canvas snapshot at save time, kept in sync with edits) that
 * isn't needed for the underlying feature to work.
 */
export function DesignLibraryModal({ design, onRename, onSave, onNew, onLoad, onClose }: DesignLibraryModalProps) {
  const [summaries, setSummaries] = useState<DesignSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => {
    setListLoading(true);
    setListError(null);
    designStorage
      .list()
      .then(setSummaries)
      .catch((e: unknown) => setListError(apiErrorMessage(e, "Couldn't load your saved designs — check your connection and try again.")))
      .finally(() => setListLoading(false));
  };

  // Only on mount — refresh() itself is called again explicitly after any
  // save/delete, not on every design/summaries state change.
  useEffect(() => {
    refresh();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await onSave();
      refresh();
    } catch (e) {
      setActionError(apiErrorMessage(e, "Couldn't save — check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (id: string) => {
    if (id === design.id) return;
    if (!window.confirm("Load this design? Any unsaved changes to the current one will be lost.")) return;
    setLoadingId(id);
    setActionError(null);
    try {
      const loaded = await designStorage.load(id);
      if (loaded) onLoad(loaded);
      else setActionError("That design couldn't be found — it may have been deleted elsewhere.");
    } catch (e) {
      setActionError(apiErrorMessage(e, "Couldn't load that design — check your connection and try again."));
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string, name: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setActionError(null);
    try {
      await designStorage.remove(id);
      refresh();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Couldn't delete — check your connection and try again."));
    }
  };

  const handleVisibility = async (id: string, visibility: Visibility, e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setActionError(null);
    try {
      await publishDesign(id, visibility);
      setSummaries((current) => current.map((s) => (s.id === id ? { ...s, visibility } : s)));
    } catch (err) {
      setActionError(apiErrorMessage(err, "Couldn't change that design's visibility."));
    }
  };

  const handleNew = () => {
    if (!window.confirm("Start a new blank design? Any unsaved changes to the current one will be lost.")) return;
    onNew();
  };

  return (
    <Modal
      title="Save / load design"
      onClose={onClose}
      toolbar={
        <>
          <input className="cs-input" value={design.name} onChange={(e) => onRename(e.target.value)} placeholder="Design name" style={{ flex: 1 }} />
          <button className="cs-btn" onClick={() => void handleSave()} disabled={saving} title="Save this design">
            {saving ? <Loader2 size={14} className="cs-spin" /> : <Save size={14} />} Save
          </button>
          <button className="cs-btn" onClick={handleNew} title="Start a new blank design">
            <FilePlus size={14} /> New
          </button>
        </>
      }
    >
      {actionError && <p style={{ color: "var(--cs-danger)", fontSize: 13, padding: "8px 16px", margin: 0 }}>{actionError}</p>}

      <div style={{ padding: 8 }}>
        {listLoading ? (
          <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
            <Loader2 size={14} className="cs-spin" /> Loading…
          </p>
        ) : listError ? (
          <p style={{ color: "var(--cs-danger)", fontSize: 13, padding: "6px 8px" }}>{listError}</p>
        ) : summaries.length === 0 ? (
          <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "6px 8px" }}>No saved designs yet — click Save above.</p>
        ) : (
          summaries.map((s) => {
            const isCurrent = s.id === design.id;
            return (
              <div
                key={s.id}
                data-testid="saved-design-row"
                onClick={() => void handleLoad(s.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 8px",
                  borderRadius: 6,
                  cursor: isCurrent ? "default" : "pointer",
                  background: isCurrent ? "var(--cs-accent-soft)" : "transparent",
                  marginBottom: 2,
                  opacity: loadingId === s.id ? 0.6 : 1,
                }}
              >
                {loadingId === s.id ? (
                  <Loader2 size={15} color="var(--cs-text-muted)" className="cs-spin" style={{ flex: "none" }} />
                ) : (
                  <FolderOpen size={15} color="var(--cs-text-muted)" style={{ flex: "none" }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                    {isCurrent && <span style={{ color: "var(--cs-text-muted)" }}> (current)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--cs-text-muted)" }}>{new Date(s.updatedAt).toLocaleString()}</div>
                </div>
                {/* Only when signed in: a localStorage design has nowhere
                    to be published to (see DesignSummary.visibility). */}
                {s.visibility && (
                  <select
                    className="cs-input"
                    value={s.visibility}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => void handleVisibility(s.id, e.target.value as Visibility, e)}
                    style={{ width: 110, flex: "none" }}
                    title="Who can see this design"
                    data-testid="design-visibility"
                  >
                    {VISIBILITIES.map((v) => (
                      <option key={v} value={v}>
                        {VISIBILITY_LABELS[v]}
                      </option>
                    ))}
                  </select>
                )}
                <button className="cs-icon-btn" title="Delete" onClick={(e) => void handleDelete(s.id, s.name, e)}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
