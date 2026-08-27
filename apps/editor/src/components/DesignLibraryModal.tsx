import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";
import { Save, FilePlus, FolderOpen, Trash2, Loader2, Library, FileImage } from "lucide-react";
import type { Design } from "@card-studio/scene-schema";
import { designStorage, type DesignSummary } from "../designStorage";
import { apiErrorMessage } from "../api/client";
import { publishDesign } from "../api/apiDesignStorage";
import { getCurrentUser, subscribe } from "../api/auth";
import { type Visibility } from "../visibility";
import { Modal } from "./Modal";
import { ListRow } from "./ListRow";
import { VisibilitySelect } from "./VisibilitySelect";
import { CollectionsPanel } from "./CollectionsPanel";

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
  const [tab, setTab] = useState<"designs" | "collections">("designs");
  const user = useSyncExternalStore(subscribe, getCurrentUser);

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

  const handleVisibility = async (id: string, visibility: Visibility) => {
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
          <button className={`cs-btn${tab === "designs" ? " cs-active" : ""}`} onClick={() => setTab("designs")} data-testid="tab-designs">
            <FileImage size={14} /> Designs
          </button>
          <button className={`cs-btn${tab === "collections" ? " cs-active" : ""}`} onClick={() => setTab("collections")} data-testid="tab-collections">
            <Library size={14} /> Collections
          </button>
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <input className="cs-input" value={design.name} onChange={(e) => onRename(e.target.value)} placeholder="Design name" style={{ flex: 1 }} />
            <button className="cs-btn" onClick={() => void handleSave()} disabled={saving} title="Save this design">
              {saving ? <Loader2 size={14} className="cs-spin" /> : <Save size={14} />} Save
            </button>
            <button className="cs-btn" onClick={handleNew} title="Start a new blank design">
              <FilePlus size={14} /> New
            </button>
          </div>
        </>
      }
    >
      {tab === "collections" ? (
        <CollectionsPanel currentDesignId={design.id} currentDesignName={design.name} signedIn={Boolean(user)} />
      ) : (
        <>
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
              summaries.map((s) => (
                <ListRow
                  key={s.id}
                  testId="saved-design-row"
                  icon={loadingId === s.id ? <Loader2 size={15} className="cs-spin" /> : <FolderOpen size={15} />}
                  title={
                    <>
                      {s.name}
                      {s.id === design.id && <span style={{ color: "var(--cs-text-muted)" }}> (current)</span>}
                    </>
                  }
                  subtitle={new Date(s.updatedAt).toLocaleString()}
                  onClick={() => void handleLoad(s.id)}
                  active={s.id === design.id}
                  dimmed={loadingId === s.id}
                >
                  {/* Only when signed in: a localStorage design has nowhere
                      to be published to (see DesignSummary.visibility). */}
                  {s.visibility && (
                    <VisibilitySelect value={s.visibility} onChange={(v) => void handleVisibility(s.id, v)} testId="design-visibility" />
                  )}
                  <button className="cs-icon-btn" title="Delete" onClick={(e) => void handleDelete(s.id, s.name, e)}>
                    <Trash2 size={13} />
                  </button>
                </ListRow>
              ))
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
