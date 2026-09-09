import { useEffect, useState } from "react";
import type { Design } from "@card-studio/scene-schema";
import { Sparkles, Plus, LayoutTemplate, ChevronRight, Loader2, RefreshCw, Users } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { browseTemplates, loadTemplate, markTemplateUsed, type TemplateSummary } from "../api/templates";
import { designFromTemplate } from "../cardTemplates";

export interface DesignInspirationProps {
  /** Starts a brand-new blank design, exactly the way the toolbar's own
   * "New" action does (Toolbar.tsx's DesignLibraryModal `onNew` /
   * LibraryView's `onNew`) — this screen calls it rather than building
   * its own copy of what a blank design is. */
  onStartBlank: () => void;
  /** Hands back a fresh Design cloned from the chosen template — same
   * contract TemplatesPanel's onUseTemplate already has. */
  onUseTemplate: (design: Design) => void;
  /** Opens an author's public profile — same attribution pattern as the
   * template gallery and a profile page use elsewhere in the app. */
  onViewProfile: (username: string) => void;
  /** Jumps to the full Templates tab, for anyone who wants more than the
   * curated strip below. */
  onBrowseAll: () => void;
}

/** How many templates the curated strip asks for. Generous enough to
 * scroll, not so many the gallery endpoint does needless work for a
 * screen that's meant to be a taste, not the whole catalog (that's what
 * "Browse all" and the Templates tab are for). */
const FEATURED_LIMIT = 14;

/** Deterministic gradient tint per card, cycled by position — same idea
 * as TemplatesPanel's `.cs-tb-thumb-N`, but a separate, richer palette so
 * this screen doesn't read as a re-skin of that one. */
const CARD_TINTS = [
  "linear-gradient(135deg, #6e60e0, #2f2a63)",
  "linear-gradient(135deg, #e2a13d, #8a4f1f)",
  "linear-gradient(135deg, #3fb0a6, #1d5c56)",
  "linear-gradient(135deg, #d9698f, #6d2b45)",
  "linear-gradient(135deg, #4f83c9, #253f66)",
  "linear-gradient(135deg, #b881d8, #4c2d6b)",
];

/** Same idea as CARD_TINTS, one step brighter, for the little avatar
 * bubble standing in for an author photo (template rows carry no avatar
 * image — see api/templates.ts's TemplateAuthor). */
const AVATAR_TINTS = ["#6e60e0", "#e2a13d", "#3fb0a6", "#d9698f", "#4f83c9", "#b881d8"];

function tintIndex(seed: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % length;
}

function initialsFor(name: string | null, username: string | null): string {
  const label = name?.trim() || username?.trim() || "?";
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

function Avatar({ id, name, username }: { id: string; name: string | null; username: string | null }) {
  const color = AVATAR_TINTS[tintIndex(id, AVATAR_TINTS.length)];
  return (
    <span
      className="cs-insp-avatar"
      style={{ background: color }}
      aria-hidden
    >
      {initialsFor(name, username)}
    </span>
  );
}

/**
 * The Design tab's landing screen: shown before a fresh, untouched design
 * has any content, in place of a blank canvas. A hero with the two ways
 * to start (blank, or from a template) and a horizontal-scrolling strip
 * of published community templates beneath it, in the spirit of a home
 * screen rather than a file browser — AppShell.tsx decides when this
 * shows and gets out of the way, this component only renders the content.
 *
 * Reuses the same data and the same "use a template" flow TemplatesPanel
 * already has (browseTemplates/loadTemplate/markTemplateUsed +
 * designFromTemplate) — this is a different presentation of that same
 * gallery for a different moment, not a second implementation of it.
 */
export function DesignInspiration({ onStartBlank, onUseTemplate, onViewProfile, onBrowseAll }: DesignInspirationProps) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTemplates(null);
    setError(null);
    browseTemplates({ sort: "popular", limit: FEATURED_LIMIT })
      .then((rows) => {
        if (cancelled) return;
        // Staff-featured templates lead the strip; everything else keeps
        // the endpoint's own popularity order (Array#sort is stable).
        setTemplates([...rows].sort((a, b) => Number(b.featured) - Number(a.featured)));
      })
      .catch((e: unknown) => !cancelled && setError(apiErrorMessage(e, "Couldn't load templates. Check your connection and try again.")));
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const useTemplate = async (summary: TemplateSummary) => {
    setBusyId(summary.id);
    setError(null);
    try {
      const template = await loadTemplate(summary.id);
      // Fire-and-forget, same as TemplatesPanel: a usage counter failing
      // must never cost someone the design they just asked to start.
      void markTemplateUsed(summary.id).catch(() => {});
      onUseTemplate(designFromTemplate(template));
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't open that template. Check your connection and try again."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="cs-insp" data-testid="design-inspiration">
      <div className="cs-insp-page">
        <div className="cs-insp-hero">
          <div className="cs-insp-eyebrow">
            <Sparkles size={14} /> Design Studio
          </div>
          <h1 className="cs-heading cs-insp-title">What will you create today?</h1>
          <p className="cs-insp-subtitle">
            Get a feel for what the community is making, then start a design of your own: a blank canvas, or a published layout as your starting point.
          </p>
          <div className="cs-insp-hero-actions">
            <button className="cs-insp-btn-primary" onClick={onStartBlank} data-testid="inspiration-start-blank">
              <Plus size={18} /> Start a blank design
            </button>
            <button className="cs-insp-btn-secondary" onClick={onBrowseAll} data-testid="inspiration-browse-all">
              <LayoutTemplate size={18} /> Browse all templates
            </button>
          </div>
        </div>

        <div className="cs-insp-section">
          <div className="cs-insp-section-head">
            <h2 className="cs-heading cs-insp-section-title">Featured templates</h2>
            <button className="cs-insp-see-all" onClick={onBrowseAll} data-testid="inspiration-see-all">
              See all <ChevronRight size={14} />
            </button>
          </div>

          {error ? (
            <div className="cs-insp-state" data-testid="inspiration-error">
              <p>{error}</p>
              <button className="cs-insp-btn-secondary" onClick={() => setReloadToken((n) => n + 1)}>
                <RefreshCw size={14} /> Try again
              </button>
            </div>
          ) : templates === null ? (
            <div className="cs-insp-carousel" aria-hidden data-testid="inspiration-loading">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="cs-insp-card cs-insp-card-skeleton">
                  <div className="cs-insp-card-thumb cs-insp-skeleton-block" />
                  <div className="cs-insp-card-body">
                    <div className="cs-insp-skeleton-line" style={{ width: "70%" }} />
                    <div className="cs-insp-skeleton-line" style={{ width: "45%" }} />
                  </div>
                </div>
              ))}
              <div className="cs-insp-state-inline">
                <Loader2 size={14} className="cs-spin" /> Loading inspiration…
              </div>
            </div>
          ) : templates.length === 0 ? (
            <div className="cs-insp-state" data-testid="inspiration-empty">
              <Users size={28} strokeWidth={1.5} />
              <p>No published templates yet. Be the first to share a layout once you've made something you like.</p>
            </div>
          ) : (
            <div className="cs-insp-carousel" data-testid="inspiration-carousel">
              {templates.map((t) => {
                const busy = busyId === t.id;
                return (
                  // A <div> with role="button", not a real <button>: the
                  // author credit inside it (TemplatesPanel's same
                  // attribution pattern) is its own clickable control, and
                  // a button can't nest another interactive element.
                  <div
                    key={t.id}
                    className="cs-insp-card"
                    role="button"
                    tabIndex={busy ? -1 : 0}
                    aria-disabled={busy}
                    onClick={() => !busy && void useTemplate(t)}
                    onKeyDown={(e) => {
                      if (!busy && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        void useTemplate(t);
                      }
                    }}
                    data-testid="inspiration-card"
                    title={`Start a new design from "${t.name}"`}
                    style={{ opacity: busy ? 0.7 : 1 }}
                  >
                    <div className="cs-insp-card-thumb" style={{ background: CARD_TINTS[tintIndex(t.id, CARD_TINTS.length)] }}>
                      {t.featured && (
                        <span className="cs-insp-card-badge">
                          <Sparkles size={11} /> Featured
                        </span>
                      )}
                      {busy ? <Loader2 size={28} className="cs-spin" /> : <LayoutTemplate size={30} strokeWidth={1.5} />}
                    </div>
                    <div className="cs-insp-card-body">
                      <div className="cs-insp-card-title">{t.name}</div>
                      <div className="cs-insp-card-meta">
                        used {t.usageCount}× {t.tags.length > 0 && `· ${t.tags[0]}`}
                      </div>
                      <div className="cs-insp-card-footer">
                        <Avatar id={String(t.author.id)} name={t.author.name} username={t.author.username} />
                        {t.author.username ? (
                          <button
                            className="cs-insp-author-link"
                            data-testid="inspiration-card-author"
                            title={`See everything ${t.author.name ?? "this author"} has published`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewProfile(t.author.username!);
                            }}
                          >
                            {t.author.name ?? t.author.username}
                          </button>
                        ) : (
                          <span className="cs-insp-author-link cs-insp-author-static">{t.author.name ?? "a community member"}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
