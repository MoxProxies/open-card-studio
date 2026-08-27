import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, Library, Plus, FolderOpen, X } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import {
  addDesignToCollection,
  deleteCollection,
  listMyCollections,
  loadCollection,
  removeDesignFromCollection,
  saveCollection,
  setCollectionVisibility,
  type CollectionDetail,
  type CollectionSummary,
} from "../api/collections";
import type { Visibility } from "../visibility";
import { ListRow } from "./ListRow";
import { VisibilitySelect } from "./VisibilitySelect";

interface CollectionsPanelProps {
  /** The design open in the editor — "add to collection" files this one. */
  currentDesignId: string;
  currentDesignName: string;
  /** False when signed out: collections live on the account, so there's
   * nothing to show and the panel says so instead of erroring. */
  signedIn: boolean;
}

/**
 * The "Collections" tab of the design library — a binder/deck view over
 * the designs already saved to the account. Creating, renaming, publishing
 * and deleting a collection, plus filing the currently-open design into
 * one and taking it back out.
 *
 * A design has to be saved to the account before it can be filed, since
 * the membership pivot points at a real row — the button says so rather
 * than failing with a 404.
 */
export function CollectionsPanel({ currentDesignId, currentDesignName, signedIn }: CollectionsPanelProps) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [open, setOpen] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listMyCollections()
      .then(setCollections)
      .catch((e: unknown) => setError(apiErrorMessage(e, "Couldn't load your collections — check your connection and try again.")))
      .finally(() => setLoading(false));
  }, [signedIn]);

  useEffect(refresh, [refresh]);

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(apiErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const created = await saveCollection({ id: crypto.randomUUID(), name: newName.trim() || "New collection" });
      setNewName("");
      setCollections((c) => [{ ...created }, ...c]);
      setOpen(created);
    }, "Couldn't create that collection.");

  const openCollection = (id: string) => run(async () => setOpen(await loadCollection(id)), "Couldn't open that collection.");

  const changeVisibility = (id: string, visibility: Visibility) =>
    run(async () => {
      const updated = await setCollectionVisibility(id, visibility);
      setCollections((c) => c.map((x) => (x.id === id ? updated : x)));
      setOpen((o) => (o && o.id === id ? { ...o, visibility } : o));
    }, "Couldn't change that collection's visibility.");

  const remove = (c: CollectionSummary) =>
    run(async () => {
      if (!window.confirm(`Delete "${c.name}"? The designs in it aren't deleted.`)) return;
      await deleteCollection(c.id);
      setCollections((list) => list.filter((x) => x.id !== c.id));
      setOpen((o) => (o && o.id === c.id ? null : o));
    }, "Couldn't delete that collection.");

  const fileCurrent = (id: string) =>
    run(async () => {
      const updated = await addDesignToCollection(id, currentDesignId);
      setOpen(updated);
      setCollections((list) => list.map((x) => (x.id === id ? { ...x, designCount: updated.designs.length } : x)));
    }, "Couldn't add that design — save it to your account first.");

  const unfile = (collectionId: string, designId: string) =>
    run(async () => {
      const updated = await removeDesignFromCollection(collectionId, designId);
      setOpen(updated);
      setCollections((list) => list.map((x) => (x.id === collectionId ? { ...x, designCount: updated.designs.length } : x)));
    }, "Couldn't remove that design.");

  if (!signedIn) {
    return <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "14px 16px", margin: 0 }}>Sign in to group your designs into collections.</p>;
  }

  if (open) {
    const alreadyIn = open.designs.some((d) => d.id === currentDesignId);
    return (
      <div style={{ padding: 8 }} data-testid="collection-detail">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 10px" }}>
          <button className="cs-btn" onClick={() => setOpen(null)} data-testid="collection-back">
            ← All collections
          </button>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{open.name}</span>
          <VisibilitySelect value={open.visibility} onChange={(v) => void changeVisibility(open.id, v)} testId="collection-detail-visibility" />
        </div>

        <button
          className="cs-btn"
          style={{ margin: "0 8px 8px", width: "calc(100% - 16px)", justifyContent: "center" }}
          onClick={() => void fileCurrent(open.id)}
          disabled={busy || alreadyIn}
          data-testid="collection-add-current"
        >
          <Plus size={14} /> {alreadyIn ? `“${currentDesignName}” is in this collection` : `Add “${currentDesignName}”`}
        </button>

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, padding: "0 8px 8px", margin: 0 }}>{error}</p>}

        {open.designs.length === 0 ? (
          <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "6px 8px" }}>Nothing in here yet.</p>
        ) : (
          open.designs.map((d) => (
            <ListRow key={d.id} testId="collection-design" title={d.name} subtitle={new Date(d.updatedAt).toLocaleString()} icon={<FolderOpen size={15} />}>
              <button className="cs-icon-btn" title="Remove from this collection" onClick={() => void unfile(open.id, d.id)} data-testid="collection-remove-design">
                <X size={13} />
              </button>
            </ListRow>
          ))
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 8 }} data-testid="collections-list">
      <div style={{ display: "flex", gap: 8, padding: "4px 8px 10px" }}>
        <input
          className="cs-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New collection name"
          style={{ flex: 1 }}
          data-testid="collection-new-name"
        />
        <button className="cs-btn" onClick={() => void create()} disabled={busy} data-testid="collection-create">
          {busy ? <Loader2 size={14} className="cs-spin" /> : <Plus size={14} />} Create
        </button>
      </div>

      {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, padding: "0 8px 8px", margin: 0 }}>{error}</p>}

      {loading ? (
        <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={14} className="cs-spin" /> Loading…
        </p>
      ) : collections.length === 0 ? (
        <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "6px 8px" }}>No collections yet — name one above to start a binder.</p>
      ) : (
        collections.map((c) => (
          <ListRow
            key={c.id}
            testId="collection-row"
            icon={<Library size={15} />}
            title={c.name}
            subtitle={`${c.designCount ?? 0} design${c.designCount === 1 ? "" : "s"}`}
            onClick={() => void openCollection(c.id)}
          >
            <VisibilitySelect value={c.visibility} onChange={(v) => void changeVisibility(c.id, v)} testId="collection-visibility" />
            <button
              className="cs-icon-btn"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                void remove(c);
              }}
              data-testid="collection-delete"
            >
              <Trash2 size={13} />
            </button>
          </ListRow>
        ))
      )}
    </div>
  );
}
