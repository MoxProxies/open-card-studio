import { useEffect, useState, type ReactNode } from "react";
import { Loader2, LayoutTemplate, Flag, FileImage, Library, Star } from "lucide-react";
import type { Design } from "@card-studio/scene-schema";
import { apiErrorMessage } from "../api/client";
import { getCurrentUser } from "../api/auth";
import { loadProfile, type ProfilePage } from "../api/profiles";
import { loadTemplate, markTemplateUsed } from "../api/templates";
import { designFromTemplate } from "../cardTemplates";
import { ListRow } from "./ListRow";
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
  const viewer = getCurrentUser();

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setError(null);
    loadProfile(username)
      .then((p) => !cancelled && setPage(p))
      .catch((e: unknown) => !cancelled && setError(apiErrorMessage(e, "Couldn't load that profile — check your connection and try again.")));
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
   * message worth showing rather than a silent no-op. */
  const toggleFeatured = async (type: "template" | "design" | "collection", id: string, featured: boolean) => {
    setError(null);
    try {
      await setFeatured(type, id, featured);
      setPage(await loadProfile(username));
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't change that."));
    }
  };

  return (
    <>
      {children({
        title: page ? `${page.profile.name} (@${page.profile.username})` : "Profile",
        body: (
          <>
        {error ? (
          <p style={{ color: "var(--cs-danger)", fontSize: 13, padding: 16 }}>{error}</p>
        ) : !page ? (
          <p style={{ color: "var(--cs-text-muted)", fontSize: 13, padding: 16, display: "flex", alignItems: "center", gap: 6 }}>
            <Loader2 size={14} className="cs-spin" /> Loading…
          </p>
        ) : (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {page.profile.avatar_url && (
                <img
                  src={page.profile.avatar_url}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", flex: "none", background: "var(--cs-surface-soft)" }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {page.profile.bio ? (
                  <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }} data-testid="profile-bio-text">
                    {page.profile.bio}
                  </p>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--cs-text-muted)" }}>No bio yet.</p>
                )}
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--cs-text-muted)" }}>
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
                  <Flag size={14} />
                </button>
              )}
            </div>

            <ProfileStats stats={page.stats} badges={page.badges} />

            {page.featured.length > 0 && (
              <Section icon={<Star size={13} />} title="Featured" count={page.featured.length} testId="profile-featured">
                {page.featured.map((f) => (
                  <ListRow key={`${f.type}-${f.id}`} testId="featured-row" title={f.name} subtitle={f.type}>
                    <ReactionButton type={f.type} id={f.id} count={f.reaction_count ?? 0} reacted={f.reacted ?? false} />
                  </ListRow>
                ))}
              </Section>
            )}

            <Section icon={<LayoutTemplate size={13} />} title="Published templates" count={page.templates.length} testId="profile-templates">
              {page.templates.map((t) => (
                <ListRow key={t.id} testId="profile-row" title={t.name} subtitle={`used ${t.usageCount}× ${t.tags.length ? `· ${t.tags.join(", ")}` : ""}`}>
                  <ReactionButton type="template" id={t.id} count={t.reactionCount} reacted={t.reacted} />
                  {isSelf && (
                    <button
                      className={`cs-icon-btn${t.featured ? " cs-active" : ""}`}
                      title={t.featured ? "Remove from your featured shelf" : "Feature this on your profile"}
                      data-testid="feature-toggle"
                      onClick={() => void toggleFeatured("template", t.id, !t.featured)}
                    >
                      <Star size={13} fill={t.featured ? "currentColor" : "none"} />
                    </button>
                  )}
                  <button className="cs-btn" onClick={() => void useTemplate(t.id, t.name)} disabled={busyId === t.id} data-testid="profile-use-template">
                    {busyId === t.id ? <Loader2 size={14} className="cs-spin" /> : <LayoutTemplate size={14} />} Use
                  </button>
                  {viewer && !isSelf && (
                    <button className="cs-icon-btn" title="Report this template" onClick={() => setReporting({ type: "template", id: t.id, label: `“${t.name}”` })}>
                      <Flag size={13} />
                    </button>
                  )}
                </ListRow>
              ))}
            </Section>

            <Section icon={<Library size={13} />} title="Published collections" count={page.collections.length} testId="profile-collections">
              {page.collections.map((c) => (
                <ListRow
                  key={c.id}
                  testId="profile-row"
                  title={c.name}
                  subtitle={`${c.designCount ?? 0} design${c.designCount === 1 ? "" : "s"}${c.description ? ` · ${c.description}` : ""}`}
                >
                  {viewer && !isSelf && (
                    <button className="cs-icon-btn" title="Report this collection" onClick={() => setReporting({ type: "collection", id: c.id, label: `“${c.name}”` })}>
                      <Flag size={13} />
                    </button>
                  )}
                </ListRow>
              ))}
            </Section>

            <Section icon={<FileImage size={13} />} title="Published designs" count={page.designs.length} testId="profile-designs">
              {page.designs.map((d) => (
                <ListRow key={d.id} testId="profile-row" title={d.name} subtitle={new Date(d.updated_at).toLocaleDateString()} />
              ))}
            </Section>
          </div>
        )}
          </>
        ),
      })}

      {reporting && <ReportModal type={reporting.type} id={reporting.id} label={reporting.label} onClose={() => setReporting(null)} />}
    </>
  );
}

function Section({ icon, title, count, testId, children }: { icon: React.ReactNode; title: string; count: number; testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId}>
      <h3 className="cs-heading" style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px", display: "flex", alignItems: "center", gap: 6 }}>
        {icon} {title} ({count})
      </h3>
      {count === 0 ? <p style={{ margin: 0, fontSize: 12, color: "var(--cs-text-muted)" }}>Nothing published yet.</p> : children}
    </div>
  );
}
