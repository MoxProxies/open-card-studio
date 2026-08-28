import { useEffect, useState, type ReactNode } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { deleteUpload, loadUploads, uploadImage, type Upload } from "../api/uploads";

export interface ArtPanelProps {
  /** Adds the image to the design. Absent in a browsing-only context
   * (the Library tab), where the panel is just storage management. */
  onUse?: (upload: Upload) => void;
  /** Render prop — chrome-free, same as TemplatesPanel: the shell wraps
   * it in a Page, the editor wraps it in a Modal, and neither needs its
   * own copy of the grid. */
  children: (slots: { toolbar: ReactNode; body: ReactNode }) => ReactNode;
}

const formatBytes = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Everything this account has uploaded.
 *
 * A grid rather than the name-and-list every other panel uses, because
 * unlike a saved design an image already *is* its own thumbnail — there's
 * nothing to generate and nothing to keep in sync.
 *
 * Reuse is the point: art uploaded once can go into any number of
 * designs, and picking it here costs nothing, where re-uploading the same
 * file would at least burn a round trip (the backend dedupes by checksum,
 * so it wouldn't cost quota).
 */
export function ArtPanel({ onUse, children }: ArtPanelProps) {
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [usage, setUsage] = useState({ used: 0, quota: 0 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    loadUploads()
      .then(({ uploads: rows, used_bytes, quota_bytes }) => {
        setUploads(rows);
        setUsage({ used: used_bytes, quota: quota_bytes });
      })
      .catch((problem: unknown) => setError(apiErrorMessage(problem, "Couldn't load your art.")));

  useEffect(() => {
    void refresh();
  }, []);

  const add = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      await uploadImage(file, "art");
      await refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That upload didn't work.");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (upload: Upload) => {
    // Deleting is not undoable and the image may be in a design already —
    // which the backend can't tell us, since a design references it by
    // URL rather than through a join table.
    if (!window.confirm("Delete this image? Designs already using it will show a gap where it was.")) return;
    setBusyId(upload.id);
    try {
      await deleteUpload(upload.id);
      await refresh();
    } catch (problem: unknown) {
      setError(apiErrorMessage(problem, "Couldn't delete that."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {children({
        toolbar: (
          <>
            <label className="cs-btn" style={{ cursor: "pointer" }} data-testid="art-upload">
              {uploading ? <Loader2 size={14} className="cs-spin" /> : <ImageUp size={14} />} Upload art
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void add(file);
                }}
              />
            </label>
            {usage.quota > 0 && (
              <span style={{ fontSize: 11, color: "var(--cs-text-muted)", alignSelf: "center" }} data-testid="art-usage">
                {formatBytes(usage.used)} of {formatBytes(usage.quota)} used
              </span>
            )}
          </>
        ),
        body: (
          <div style={{ padding: 8 }}>
            {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, margin: "0 0 8px" }}>{error}</p>}

            {uploads === null && !error && <p style={{ fontSize: 13, color: "var(--cs-text-muted)", margin: 0 }}>Loading…</p>}

            {uploads?.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--cs-text-muted)", margin: 0 }} data-testid="art-empty">
                Nothing here yet. Anything you upload — here or from the editor — is kept for reuse in any design.
              </p>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }} data-testid="art-grid">
              {uploads?.map((upload) => (
                <div
                  key={upload.id}
                  data-testid="art-item"
                  data-upload-id={upload.id}
                  style={{
                    border: "1px solid var(--cs-border)",
                    borderRadius: 8,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    opacity: busyId === upload.id ? 0.5 : 1,
                  }}
                >
                  <div style={{ aspectRatio: "1", background: "var(--cs-surface-soft)", display: "flex" }}>
                    <img
                      src={upload.url}
                      alt=""
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "contain", cursor: onUse ? "pointer" : "default" }}
                      onClick={() => onUse?.(upload)}
                      data-testid="art-thumb"
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", fontSize: 10, color: "var(--cs-text-muted)" }}>
                    <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {upload.width}×{upload.height} · {formatBytes(upload.bytes)}
                    </span>
                    {onUse && (
                      <button className="cs-btn" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => onUse(upload)} data-testid="art-use">
                        Use
                      </button>
                    )}
                    <button
                      className="cs-icon-btn"
                      title="Delete this image"
                      disabled={busyId === upload.id}
                      onClick={() => void remove(upload)}
                      data-testid="art-delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
      })}
    </>
  );
}
