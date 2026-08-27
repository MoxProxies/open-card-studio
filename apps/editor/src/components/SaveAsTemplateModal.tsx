import { useMemo, useState } from "react";
import { Loader2, Lock, PencilLine, Unlock } from "lucide-react";
import type { Design } from "@card-studio/scene-schema";
import { apiErrorMessage } from "../api/client";
import { Modal } from "./Modal";
import { saveTemplate, type TemplateSummary, type TemplateVisibility } from "../api/templates";
import { summarizeTemplateLayers } from "../cardTemplates";
import { VISIBILITIES, VISIBILITY_HELP, VISIBILITY_LABELS } from "../visibility";

interface SaveAsTemplateModalProps {
  design: Design;
  /** Set when re-saving an existing template (its metadata prefills, and
   * the upsert lands on the same row) — unset for a brand-new one. */
  existing?: TemplateSummary;
  onSaved: (template: TemplateSummary) => void;
  onClose: () => void;
}

/**
 * "Save as template" — the authoring half of Phase 1 (see
 * docs/PRODUCT_VISION.md). Deliberately thin: the *layout* work already
 * happened in the editor, and which layers are fixed chrome vs. fill-in
 * slots is already recorded in each layer's locked/contentLocked flags
 * (root README, "Field locking"), so all this modal collects is the
 * publishing metadata. The breakdown below exists so an author sees what
 * those flags mean for whoever uses the template *before* publishing —
 * there's no separate "define a slot" mode to walk through, by design.
 */
export function SaveAsTemplateModal({ design, existing, onSaved, onClose }: SaveAsTemplateModalProps) {
  const [name, setName] = useState(existing?.name ?? design.name);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "));
  const [visibility, setVisibility] = useState<TemplateVisibility>(existing?.visibility ?? "private");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const breakdown = useMemo(() => summarizeTemplateLayers(design), [design]);

  const submit = async () => {
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved = await saveTemplate({
        // Re-saving keeps the same row; a new template gets its own id
        // here rather than reusing design.id, so the design and the
        // template it was published from stay separate records.
        id: existing?.id ?? crypto.randomUUID(),
        name: name.trim(),
        description: description.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8),
        visibility,
        design,
      });
      onSaved(saved);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save the template — check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // stacked: this opens on top of TemplateBrowserModal, so it takes the
    // higher z-index and owns Escape while it's up.
    <Modal
      title={existing ? "Update template" : "Save as template"}
      onClose={onClose}
      width="min(460px, 92vw)"
      stacked
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="cs-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="cs-btn cs-active" disabled={submitting} data-testid="template-save-submit">
            {submitting ? <Loader2 size={14} className="cs-spin" /> : null} {existing ? "Update" : "Save template"}
          </button>
        </>
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
        }}
      >
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 12,
            color: "var(--cs-text-muted)",
          }}
        >
          Name
          <input
            className="cs-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            autoFocus
            data-testid="template-name"
          />
        </label>

        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 12,
            color: "var(--cs-text-muted)",
          }}
        >
          Description
          <textarea
            className="cs-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this layout for, and what should someone fill in?"
            rows={3}
            data-testid="template-description"
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </label>

        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 12,
            color: "var(--cs-text-muted)",
          }}
        >
          Tags (comma separated, up to 8)
          <input
            className="cs-input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="fantasy, minimal, full-art"
            data-testid="template-tags"
          />
        </label>

        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 12,
            color: "var(--cs-text-muted)",
          }}
        >
          Visibility
          <select
            className="cs-input"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as TemplateVisibility)}
            data-testid="template-visibility"
          >
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="published">Published</option>
          </select>
          <span style={{ fontSize: 11 }}>{VISIBILITY_HELP[visibility]}</span>
        </label>

        {/* The whole "slot definition" UI, such as it is: a read-out of
            what this design's existing lock flags already mean. Edit
            them in the layer/properties panel, not here. */}
        <div
          style={{
            border: "1px solid var(--cs-border)",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
          data-testid="template-lock-breakdown"
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>What people can change</span>
          <span
            style={{
              fontSize: 12,
              color: "var(--cs-text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Lock size={13} /> {breakdown.chrome} fixed {breakdown.chrome === 1 ? "layer" : "layers"} — locked and content-locked
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--cs-text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <PencilLine size={13} /> {breakdown.slot} fill-in {breakdown.slot === 1 ? "slot" : "slots"} — locked in place, content editable
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--cs-text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Unlock size={13} /> {breakdown.free} unlocked {breakdown.free === 1 ? "layer" : "layers"} — freely movable
          </span>
          <span style={{ fontSize: 11, color: "var(--cs-text-muted)" }}>
            Lock a layer (and content-lock it) in the layers panel to fix it in your template; leave a locked layer's content unlocked to make it a fill-in
            slot.
          </span>
        </div>

        {visibility === "published" && (
          <p
            style={{
              fontSize: 11,
              color: "var(--cs-text-muted)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Published templates are community-made and credited to you by name — not official layouts of any existing card game. Don't publish artwork or a
            layout you don't have the right to share.
          </p>
        )}

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}
