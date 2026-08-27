import { useCallback, useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";
import { X, Search, Loader2, Trash2, LayoutTemplate, Upload, Users } from "lucide-react";
import type { Design } from "@card-studio/scene-schema";
import { ApiError } from "../api/client";
import { getCurrentUser, subscribe } from "../api/auth";
import {
  browseTemplates,
  deleteTemplate,
  listMyTemplates,
  loadTemplate,
  markTemplateUsed,
  setTemplateVisibility,
  type TemplateSummary,
  type TemplateVisibility,
} from "../api/templates";
import { designFromTemplate } from "../cardTemplates";
import { SaveAsTemplateModal } from "./SaveAsTemplateModal";

interface TemplateBrowserModalProps {
  /** The design currently open in the editor — what "Save current design as template" publishes. */
  design: Design;
  /** Hands back a brand-new Design cloned from the chosen template; the
   * caller loads it into the store (same contract as DesignLibraryModal's onLoad). */
  onUseTemplate: (design: Design) => void;
  onClose: () => void;
}

type Tab = "browse" | "mine";

const VISIBILITY_LABEL: Record<TemplateVisibility, string> = {
  private: "Private",
  unlisted: "Unlisted",
  published: "Published",
};

/**
 * The browse/pick half of Phase 1 (see docs/PRODUCT_VISION.md): the
 * public gallery of published community templates, the signed-in user's
 * own templates, and the two actions that connect them to the editor —
 * "use this template" (clones it into a fresh design) and "save the
 * current design as a template".
 *
 * Browsing and using work signed out (the gallery endpoint needs no auth
 * — see routes/api.php); publishing and the "My templates" tab don't, and
 * say so rather than showing an empty list. Every row credits its author
 * by name, which is a requirement rather than a nicety: community
 * templates must never read as first-party or official (PRODUCT_VISION's
 * liability section).
 */
export function TemplateBrowserModal({ design, onUseTemplate, onClose }: TemplateBrowserModalProps) {
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [tab, setTab] = useState<Tab>("browse");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "popular">("recent");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [editing, setEditing] = useState<TemplateSummary | undefined>(undefined);
  // Bumped after a save/delete to re-run the list effect even when none of
  // the query inputs (tab/search/sort) changed — saving a second template
  // while already on the "My templates" tab still has to show up.
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => {
    setListLoading(true);
    setListError(null);
    const request = tab === "mine" ? listMyTemplates() : browseTemplates({ q: search, sort });
    request
      .then(setTemplates)
      .catch((e: unknown) => setListError(e instanceof ApiError ? e.message : "Couldn't load templates — check your connection and try again."))
      .finally(() => setListLoading(false));
  }, [tab, search, sort]);

  // "My templates" needs an account; don't fire a request that can only
  // 401 — the empty state below explains the sign-in requirement instead.
  const canList = tab === "browse" || Boolean(user);

  useEffect(() => {
    if (!canList) {
      setTemplates([]);
      setListLoading(false);
      return;
    }
    // Debounced so typing in the search box doesn't fire a request per
    // keystroke; the browse endpoint filters server-side (unlike the
    // frame library's fully client-side catalog filter).
    const timer = setTimeout(refresh, 200);
    return () => clearTimeout(timer);
  }, [refresh, canList, reloadToken]);

  useEffect(() => {
    // Escape closes the save dialog stacked on top of this one first —
    // both listen on window, so without this guard one press would close
    // both and throw away whatever the author had typed.
    if (showSaveModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, showSaveModal]);

  const handleUse = async (summary: TemplateSummary) => {
    if (!window.confirm(`Start a new design from "${summary.name}"? Any unsaved changes to the current one will be lost.`)) return;
    setBusyId(summary.id);
    setActionError(null);
    try {
      const template = await loadTemplate(summary.id);
      // Fire-and-forget: a usage counter failing must never cost someone
      // the design they just asked for (see markTemplateUsed's comment).
      void markTemplateUsed(summary.id).catch(() => {});
      onUseTemplate(designFromTemplate(template));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Couldn't open that template — check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleVisibility = async (id: string, visibility: TemplateVisibility) => {
    setActionError(null);
    try {
      const updated = await setTemplateVisibility(id, visibility);
      setTemplates((current) => current.map((t) => (t.id === id ? updated : t)));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Couldn't change that template's visibility.");
    }
  };

  const handleDelete = async (summary: TemplateSummary, e: MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${summary.name}"? Designs already made from it aren't affected.`)) return;
    setActionError(null);
    try {
      await deleteTemplate(summary.id);
      setReloadToken((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't delete that template.");
    }
  };

  return (
    <div
      className="cs-root"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "var(--cs-backdrop)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div
        data-testid="template-browser"
        style={{
          background: "var(--cs-surface)",
          borderRadius: 12,
          width: "min(640px, 92vw)",
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 50px var(--cs-shadow)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--cs-border)" }}>
          <h2 className="cs-heading" style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>Templates</h2>
          <button className="cs-icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--cs-border)", alignItems: "center", flexWrap: "wrap" }}>
          <button className={`cs-btn${tab === "browse" ? " cs-active" : ""}`} onClick={() => setTab("browse")} data-testid="template-tab-browse">
            <Users size={14} /> Community
          </button>
          <button className={`cs-btn${tab === "mine" ? " cs-active" : ""}`} onClick={() => setTab("mine")} data-testid="template-tab-mine">
            <LayoutTemplate size={14} /> My templates
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="cs-btn"
            data-testid="template-save-current"
            onClick={() => {
              setEditing(undefined);
              setShowSaveModal(true);
            }}
            disabled={!user}
            title={user ? "Publish the design you're editing as a reusable template" : "Sign in to save templates to your account"}
          >
            <Upload size={14} /> Save current design as template
          </button>
        </div>

        {tab === "browse" && (
          <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--cs-border)" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={14} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--cs-text-muted)" }} />
              <input
                className="cs-input"
                placeholder="Search community templates…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "100%", paddingLeft: 28 }}
                data-testid="template-search"
              />
            </div>
            <select className="cs-input" value={sort} onChange={(e) => setSort(e.target.value as "recent" | "popular")} style={{ width: 130 }}>
              <option value="recent">Newest</option>
              <option value="popular">Most used</option>
            </select>
          </div>
        )}

        {actionError && <p style={{ color: "var(--cs-danger)", fontSize: 13, padding: "8px 16px", margin: 0 }}>{actionError}</p>}

        <div style={{ padding: 8, overflowY: "auto", flex: 1 }}>
          {!canList ? (
            <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "6px 8px" }}>Sign in to see the templates you've saved.</p>
          ) : listLoading ? (
            <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <Loader2 size={14} className="cs-spin" /> Loading…
            </p>
          ) : listError ? (
            <p style={{ color: "var(--cs-danger)", fontSize: 13, padding: "6px 8px" }}>{listError}</p>
          ) : templates.length === 0 ? (
            <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: "6px 8px" }}>
              {tab === "mine"
                ? "You haven't saved any templates yet — lock the layers you want fixed, then use the button above."
                : "No published templates match that search yet."}
            </p>
          ) : (
            templates.map((t) => (
              <div
                key={t.id}
                data-testid="template-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 8px",
                  borderRadius: 6,
                  marginBottom: 2,
                  opacity: busyId === t.id ? 0.6 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                  {t.description && (
                    <div style={{ fontSize: 12, color: "var(--cs-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.description}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "var(--cs-text-muted)", marginTop: 2 }}>
                    {/* Attribution is deliberately always shown, never
                        conditional on a hover or a detail view — see this
                        component's doc comment. */}
                    by {t.author.name ?? "a community member"} · used {t.usageCount}×{t.version > 1 ? ` · v${t.version}` : ""}
                    {t.tags.length > 0 && ` · ${t.tags.join(", ")}`}
                  </div>
                </div>

                {tab === "mine" && (
                  <>
                    <select
                      className="cs-input"
                      value={t.visibility}
                      onChange={(e) => void handleVisibility(t.id, e.target.value as TemplateVisibility)}
                      style={{ width: 110 }}
                      title="Who can see this template"
                      data-testid="template-row-visibility"
                    >
                      {(Object.keys(VISIBILITY_LABEL) as TemplateVisibility[]).map((v) => (
                        <option key={v} value={v}>
                          {VISIBILITY_LABEL[v]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="cs-btn"
                      title="Replace this template's layout with the design you're editing"
                      onClick={() => {
                        setEditing(t);
                        setShowSaveModal(true);
                      }}
                    >
                      Update
                    </button>
                  </>
                )}

                <button className="cs-btn" onClick={() => void handleUse(t)} disabled={busyId === t.id} data-testid="template-use">
                  {busyId === t.id ? <Loader2 size={14} className="cs-spin" /> : <LayoutTemplate size={14} />} Use
                </button>

                {tab === "mine" && (
                  <button className="cs-icon-btn" title="Delete" onClick={(e) => void handleDelete(t, e)} data-testid="template-delete">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showSaveModal && (
        <SaveAsTemplateModal
          design={design}
          existing={editing}
          onSaved={() => {
            setShowSaveModal(false);
            setEditing(undefined);
            // Land the author on the list their new template is actually
            // in — a private template saved from the Community tab would
            // otherwise seem to have vanished.
            setTab("mine");
            setReloadToken((n) => n + 1);
          }}
          onClose={() => {
            setShowSaveModal(false);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
