import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, LayoutTemplate, Flag, FileImage, Library, Star, ChevronDown, Heart, FileText } from "lucide-react";
import type { Design } from "@card-studio/scene-schema";
import { apiErrorMessage } from "../api/client";
import { getCurrentUser } from "../api/auth";
import { loadProfile, type ProfilePage, type PublicProfile } from "../api/profiles";
import { loadTemplate, markTemplateUsed } from "../api/templates";
import type { ReactableType } from "../api/gamification";
import { designFromTemplate } from "../cardTemplates";
import { ReportModal } from "./ReportModal";
import { ReactionButton } from "./ReactionButton";
import { ProfileStats } from "./ProfileStats";
import { setFeatured } from "../api/gamification";

export interface ProfilePanelProps {
  username: string;
  /** Same contract as the template browser's — hands back a fresh Design to load. */
  onUseTemplate: (design: Design) => void;
  /** Render prop — the title depends on loaded data, so the wrapper gets
   * it alongside the body. See TemplatesPanel. */
  children: (slots: { title: string; body: ReactNode }) => ReactNode;
}

type TabKey = "featured" | "templates" | "collections" | "designs";

const TAB_ICON: Record<TabKey, ReactNode> = {
  featured: <Star size={16} />,
  templates: <LayoutTemplate size={16} />,
  collections: <Library size={16} />,
  designs: <FileImage size={16} />,
};

/**
 * Someone's public profile: who they are, and everything they've
 * published. Reached by clicking an author's name in the template gallery
 * (or your own from the profile editor), which is the point — a community
 * template is credited to a person, and the credit has to lead somewhere.
 *
 * Only published content appears; the backend's `published` scope decides
 * that, not this component.
 */
export function ProfilePanel({ username, onUseTemplate, children }: ProfilePanelProps) {
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ type: "template" | "user" | "collection"; id: string; label: string } | null>(null);
  // Null until the visitor (or a "you just featured something" action)
  // picks one explicitly — until then the active tab is computed fresh
  // from whatever the profile actually has published, see defaultTab().
  const [tabOverride, setTabOverride] = useState<TabKey | null>(null);
  const viewer = getCurrentUser();

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setError(null);
    setTabOverride(null);
    loadProfile(username)
      .then((p) => !cancelled && setPage(p))
      .catch((e: unknown) => !cancelled && setError(apiErrorMessage(e, "Couldn't load that profile. Check your connection and try again.")));
    return () => {
      cancelled = true;
    };
  }, [username]);

  const useTemplate = async (id: string, name: string) => {
    if (!window.confirm(`Start a new design from "${name}"? Any unsaved changes to the current one will be lost.`)) return;
    setBusyId(id);
    try {
      const template = await loadTemplate(id);
      void markTemplateUsed(id).catch(() => {});
      onUseTemplate(designFromTemplate(template));
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't open that template."));
    } finally {
      setBusyId(null);
    }
  };

  const isSelf = viewer?.username === username;

  /** Featuring is level-gated server-side; a refusal comes back as a
   * message worth showing rather than a silent no-op. Successfully
   * featuring something jumps to the Featured tab so the result is
   * immediately visible, rather than left wherever the click happened. */
  const toggleFeatured = async (type: "template" | "design" | "collection", id: string, featured: boolean) => {
    setError(null);
    try {
      await setFeatured(type, id, featured);
      setPage(await loadProfile(username));
      if (featured) setTabOverride("featured");
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't change that."));
    }
  };

  // Every tab always exists except Featured, which is opt-in curation and
  // only worth a tab once something is actually on the shelf.
  const tabs = useMemo(() => {
    if (!page) return [] as Array<{ key: TabKey; label: string; count: number }>;
    const all: Array<{ key: TabKey; label: string; count: number; optional?: boolean }> = [
      { key: "featured", label: "Featured", count: page.featured.length, optional: true },
      { key: "templates", label: "Templates", count: page.templates.length },
      { key: "collections", label: "Collections", count: page.collections.length },
      { key: "designs", label: "Designs", count: page.designs.length },
    ];
    return all.filter((t) => !t.optional || t.count > 0);
  }, [page]);

  const defaultTab = useMemo<TabKey>(() => {
    const withContent = tabs.find((t) => t.count > 0);
    return withContent?.key ?? "templates";
  }, [tabs]);

  const activeTab = tabOverride ?? defaultTab;

  return (
    <>
      {children({
        title: page ? `${page.profile.name} (@${page.profile.username})` : "Profile",
        body: (
          <>
        {error ? (
          <p style={{ color: "var(--cs-danger)", fontSize: 15, padding: 16 }}>{error}</p>
        ) : !page ? (
          <p style={{ color: "var(--cs-text-muted)", fontSize: 15, padding: 16, display: "flex", alignItems: "center", gap: 6 }}>
            <Loader2 size={17} className="cs-spin" /> Loading…
          </p>
        ) : (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <ProfileAvatar profile={page.profile} size={68} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <h2
                    className="cs-heading"
                    style={{ margin: 0, fontSize: 21, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    data-testid="profile-display-name"
                  >
                    {page.profile.name}
                  </h2>
                  <ChevronDown size={18} aria-hidden style={{ flex: "none", color: "var(--cs-text-muted)" }} />
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 14, color: "var(--cs-text-muted)" }}>@{page.profile.username}</p>

                <div style={{ margin: "8px 0 0" }}>
                  <LevelPill stats={page.stats} />
                </div>

                {page.profile.bio ? (
                  <p style={{ margin: "10px 0 0", fontSize: 15, whiteSpace: "pre-wrap" }} data-testid="profile-bio-text">
                    {page.profile.bio}
                  </p>
                ) : (
                  <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--cs-text-muted)" }}>No bio yet.</p>
                )}
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--cs-text-muted)" }}>
                  Joined {new Date(page.profile.joined_at).toLocaleDateString()}
                </p>
              </div>

              {viewer && !isSelf && (
                <button
                  className="cs-icon-btn"
                  title="Report this account"
                  data-testid="report-user"
                  onClick={() => setReporting({ type: "user", id: String(page.profile.id), label: `@${page.profile.username}` })}
                >
                  <Flag size={17} />
                </button>
              )}
            </div>

            <ProfileStats stats={page.stats} badges={page.badges} />

            {/* The one highlighted metric this app can actually back up —
                total reactions received across everything published,
                already summed server-side into stats.reactions_received.
                No credits/currency exists here, so there's nothing to
                fabricate: this simply doesn't render when the number is
                zero. */}
            {page.stats.reactions_received > 0 && (
              <div
                data-testid="profile-highlight"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: "var(--cs-accent-soft)",
                  border: "1px solid var(--cs-accent)",
                }}
              >
                <Heart size={22} style={{ flex: "none", color: "var(--cs-accent)" }} fill="var(--cs-accent)" />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <strong style={{ fontSize: 20, lineHeight: 1.2 }}>{page.stats.reactions_received}</strong>
                  <span style={{ fontSize: 13, color: "var(--cs-text-muted)" }}>
                    reaction{page.stats.reactions_received === 1 ? "" : "s"} received across everything published
                  </span>
                </div>
              </div>
            )}

            <div className="cs-tb">
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }} data-testid="profile-tabs">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    className={`cs-tb-chip${activeTab === t.key ? " cs-active" : ""}`}
                    onClick={() => setTabOverride(t.key)}
                    data-testid={`profile-tab-${t.key}`}
                    style={{ flex: "none" }}
                  >
                    {TAB_ICON[t.key]} {t.label} ({t.count})
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 14 }}>
                {activeTab === "featured" && (
                  <div data-testid="profile-featured">
                    {page.featured.length === 0 ? (
                      <EmptyState text="Nothing featured yet." />
                    ) : (
                      <div className="cs-tb-grid">
                        {page.featured.map((f, i) => (
                          <div key={`${f.type}-${f.id}`} data-testid="featured-row" className="cs-tb-card">
                            <div className={`cs-tb-thumb cs-tb-thumb-${i % 5}`}>
                              {featuredIcon(f.type)}
                              <div className="cs-tb-thumb-fav">
                                <ReactionButton type={f.type} id={f.id} count={f.reaction_count ?? 0} reacted={f.reacted ?? false} />
                              </div>
                            </div>
                            <div className="cs-tb-card-body">
                              <div className="cs-tb-title">{f.name}</div>
                              <div className="cs-tb-meta" style={{ textTransform: "capitalize" }}>
                                {f.type}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "templates" && (
                  <div data-testid="profile-templates">
                    {page.templates.length === 0 ? (
                      <EmptyState text="Nothing published yet." />
                    ) : (
                      <div className="cs-tb-grid">
                        {page.templates.map((t, i) => (
                          <div key={t.id} data-testid="profile-row" className="cs-tb-card" style={{ opacity: busyId === t.id ? 0.6 : 1 }}>
                            <div className={`cs-tb-thumb cs-tb-thumb-${i % 5}`}>
                              <LayoutTemplate size={32} strokeWidth={1.5} />
                              <div className="cs-tb-thumb-fav">
                                <ReactionButton type="template" id={t.id} count={t.reactionCount} reacted={t.reacted} />
                              </div>
                            </div>
                            <div className="cs-tb-card-body">
                              <div className="cs-tb-title">{t.name}</div>
                              <div className="cs-tb-meta">
                                used {t.usageCount}× {t.tags.length ? `· ${t.tags.join(", ")}` : ""}
                              </div>
                              <div className="cs-tb-actions">
                                {isSelf && (
                                  <button
                                    className="cs-tb-icon-ghost"
                                    title={t.featured ? "Remove from your featured shelf" : "Feature this on your profile"}
                                    data-testid="feature-toggle"
                                    style={t.featured ? { color: "var(--cs-accent)", borderColor: "var(--cs-accent)" } : undefined}
                                    onClick={() => void toggleFeatured("template", t.id, !t.featured)}
                                  >
                                    <Star size={16} fill={t.featured ? "currentColor" : "none"} />
                                  </button>
                                )}
                                <div style={{ flex: 1 }} />
                                <button
                                  className="cs-tb-btn-primary"
                                  onClick={() => void useTemplate(t.id, t.name)}
                                  disabled={busyId === t.id}
                                  data-testid="profile-use-template"
                                >
                                  {busyId === t.id ? <Loader2 size={17} className="cs-spin" /> : <LayoutTemplate size={17} />} Use
                                </button>
                                {viewer && !isSelf && (
                                  <button
                                    className="cs-tb-icon-ghost"
                                    title="Report this template"
                                    onClick={() => setReporting({ type: "template", id: t.id, label: `“${t.name}”` })}
                                  >
                                    <Flag size={16} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "collections" && (
                  <div data-testid="profile-collections">
                    {page.collections.length === 0 ? (
                      <EmptyState text="Nothing published yet." />
                    ) : (
                      <div className="cs-tb-grid">
                        {page.collections.map((c, i) => (
                          <div key={c.id} data-testid="profile-row" className="cs-tb-card">
                            <div className={`cs-tb-thumb cs-tb-thumb-${i % 5}`}>
                              <Library size={32} strokeWidth={1.5} />
                            </div>
                            <div className="cs-tb-card-body">
                              <div className="cs-tb-title">{c.name}</div>
                              {c.description && <div className="cs-tb-meta">{c.description}</div>}
                              <div className="cs-tb-meta">
                                {c.designCount ?? 0} design{c.designCount === 1 ? "" : "s"}
                              </div>
                              {viewer && !isSelf && (
                                <div className="cs-tb-actions">
                                  <div style={{ flex: 1 }} />
                                  <button
                                    className="cs-tb-icon-ghost"
                                    title="Report this collection"
                                    onClick={() => setReporting({ type: "collection", id: c.id, label: `“${c.name}”` })}
                                  >
                                    <Flag size={16} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "designs" && (
                  <div data-testid="profile-designs">
                    {page.designs.length === 0 ? (
                      <EmptyState text="Nothing published yet." />
                    ) : (
                      <div className="cs-tb-grid">
                        {page.designs.map((d, i) => (
                          <div key={d.id} data-testid="profile-row" className="cs-tb-card">
                            <div className={`cs-tb-thumb cs-tb-thumb-${i % 5}`}>
                              <FileImage size={32} strokeWidth={1.5} />
                            </div>
                            <div className="cs-tb-card-body">
                              <div className="cs-tb-title">{d.name}</div>
                              <div className="cs-tb-meta">{new Date(d.updated_at).toLocaleDateString()}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
          </>
        ),
      })}

      {reporting && <ReportModal type={reporting.type} id={reporting.id} label={reporting.label} onClose={() => setReporting(null)} />}
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p style={{ margin: 0, fontSize: 15, color: "var(--cs-text-muted)", padding: "20px 4px" }}>{text}</p>;
}

function featuredIcon(type: ReactableType) {
  switch (type) {
    case "template":
      return <LayoutTemplate size={32} strokeWidth={1.5} />;
    case "collection":
      return <Library size={32} strokeWidth={1.5} />;
    case "post":
      return <FileText size={32} strokeWidth={1.5} />;
    default:
      return <FileImage size={32} strokeWidth={1.5} />;
  }
}

/** A compact, accent-colored pill under the name — the "plan/tier badge"
 * a lot of profile pages carry, mapped to what this app actually has: no
 * subscription tiers, but a real level everyone earns by using it. */
function LevelPill({ stats }: { stats: ProfilePage["stats"] }) {
  return (
    <span
      data-testid="profile-level-pill"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 13,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 999,
        color: "var(--cs-accent)",
        background: "var(--cs-accent-soft)",
        border: "1px solid var(--cs-accent)",
      }}
    >
      <Star size={12} fill="currentColor" /> Level {stats.level} · {stats.level_name}
    </span>
  );
}

const AVATAR_COLORS = ["#ab8457", "#5c7f74", "#7c5d95", "#a85b4a", "#4f6690"];

function avatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** A circular avatar — the real photo when one's set, otherwise a
 * colored circle with the account's initial, colored deterministically
 * from their handle so the same person always gets the same color. */
function ProfileAvatar({ profile, size }: { profile: PublicProfile; size: number }) {
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flex: "none", background: "var(--cs-surface-soft)" }}
      />
    );
  }

  const initial = (profile.name || profile.username || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden
      data-testid="profile-avatar-fallback"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: avatarColor(profile.username || profile.name || "?"),
        color: "#fff",
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        fontFamily: "var(--cs-font-heading)",
      }}
    >
      {initial}
    </div>
  );
}
