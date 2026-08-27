import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { FRAME_ASSETS, FRAME_CATEGORIES, getFrameAssetUrl } from "../frameAssets";
import { Modal } from "./Modal";

interface FrameLibraryModalProps {
  onSelect: (assetId: string) => void;
  onClose: () => void;
}

/** Full browser for the frame catalog: a category dropdown and a search box
 * that filter concurrently, over a directory of frames synced from
 * frame-library/ (see scripts/sync-frame-library.mjs). */
export function FrameLibraryModal({ onSelect, onClose }: FrameLibraryModalProps) {
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return FRAME_ASSETS.filter((asset) => {
      if (category && asset.category !== category) return false;
      if (query && !asset.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [category, search]);

  return (
    <Modal
      title="Frame library"
      onClose={onClose}
      width="min(720px, 92vw)"
      toolbar={
        <>
          <select className="cs-input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 160 }}>
            <option value="">All folders</option>
            {FRAME_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {FRAME_ASSETS.find((a) => a.category === c)?.categoryLabel ?? c}
              </option>
            ))}
          </select>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={14} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--cs-text-muted)" }} />
            <input
              className="cs-input"
              placeholder="Search frames…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", paddingLeft: 28 }}
              autoFocus
            />
          </div>
        </>
      }
    >
      <div style={{ padding: 16 }}>
        {filtered.length === 0 ? (
          <p style={{ color: "var(--cs-text-muted)", fontSize: 13 }}>No frames match.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12 }}>
            {filtered.map((asset) => (
              <button
                key={asset.id}
                className="cs-swatch"
                onClick={() => onSelect(asset.id)}
                title={`${asset.categoryLabel} / ${asset.name}`}
                style={{ display: "flex", flexDirection: "column", gap: 4, padding: 6 }}
              >
                <div style={{ aspectRatio: "63 / 88", overflow: "hidden", borderRadius: 4, background: "var(--cs-surface-soft)" }}>
                  <img src={getFrameAssetUrl(asset.id)} alt={asset.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </div>
                <span
                  style={{ fontSize: 11, color: "var(--cs-text)", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {asset.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
