import { useState } from "react";
import { Loader2, Eye, PenLine } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { savePost, POST_CATEGORIES, type PostDetail } from "../api/posts";
import { VISIBILITIES, VISIBILITY_HELP, VISIBILITY_LABELS } from "../visibility";
import { Markdown } from "../markdown";
import { Modal } from "./Modal";

/**
 * Write or edit a guide. A dialog rather than a destination on purpose:
 * writing is a task you finish and dismiss, not somewhere you browse.
 *
 * The preview toggle renders through the same Markdown component the
 * published post uses, so what you see here is what readers get.
 */
export function PostEditorModal({ existing, onSaved, onClose }: { existing?: PostDetail; onSaved: (post: PostDetail) => void; onClose: () => void }) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [category, setCategory] = useState(existing?.category ?? "general");
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "));
  const [visibility, setVisibility] = useState(existing?.visibility ?? "private");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      setError("A guide needs a title and something in the body.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await savePost({
          id: existing?.id ?? crypto.randomUUID(),
          title: title.trim(),
          body,
          category,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8),
          visibility,
        })
      );
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save that guide — check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  const label = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--cs-text-muted)" };

  return (
    <Modal
      title={existing ? "Edit guide" : "Write a guide"}
      onClose={onClose}
      width="min(720px, 94vw)"
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="cs-btn" onClick={() => setPreview((p) => !p)} data-testid="post-preview-toggle">
            {preview ? <PenLine size={14} /> : <Eye size={14} />} {preview ? "Write" : "Preview"}
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="cs-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="cs-btn cs-active" disabled={saving} data-testid="post-save">
            {saving ? <Loader2 size={14} className="cs-spin" /> : null} Save
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
        <label style={label}>
          Title
          <input className="cs-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How I cut cards at home" data-testid="post-title" />
          {existing && <span style={{ fontSize: 11 }}>The link stays /{existing.slug} — renaming won't break links people already shared.</span>}
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={{ ...label, flex: 1, minWidth: 160 }}>
            Category
            <select className="cs-input" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="post-category">
              {POST_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ ...label, flex: 1, minWidth: 160 }}>
            Visibility
            <select className="cs-input" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} data-testid="post-visibility">
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 11 }}>{VISIBILITY_HELP[visibility]}</span>
          </label>
        </div>

        <label style={label}>
          Tags (comma separated)
          <input className="cs-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="inkjet, matte, budget" data-testid="post-tags" />
        </label>

        <label style={label}>
          Body — markdown: # headings, **bold**, *italic*, `code`, - lists, &gt; quotes, [links](url)
          {preview ? (
            <div
              style={{ border: "1px solid var(--cs-border)", borderRadius: 8, padding: 12, minHeight: 240, background: "var(--cs-surface)", color: "var(--cs-text)" }}
              data-testid="post-preview"
            >
              <Markdown source={body} />
            </div>
          ) : (
            <textarea
              className="cs-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              placeholder={"# What you'll need\n\n- A guillotine cutter\n- Matte 300gsm stock"}
              data-testid="post-body"
              style={{ resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, lineHeight: 1.5 }}
            />
          )}
        </label>

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}
