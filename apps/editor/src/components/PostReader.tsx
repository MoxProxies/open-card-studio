import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Loader2, MessageSquare, Trash2, Flag, PenLine, History } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { getCurrentUser, subscribe } from "../api/auth";
import { addComment, deleteComment, deletePost, loadComments, loadPost, loadRevisions, type PostComment, type PostDetail, type PostRevision } from "../api/posts";
import { Markdown } from "../markdown";
import { ReactionButton } from "./ReactionButton";
import { ReportModal } from "./ReportModal";
import { PostEditorModal } from "./PostEditorModal";

/** One guide, its comments, and — for its author — edit history and the
 * controls to change or delete it. */
export function PostReader({ slug, onBack, onViewProfile }: { slug: string; onBack: () => void; onViewProfile: (username: string) => void }) {
  const viewer = useSyncExternalStore(subscribe, getCurrentUser);
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [revisions, setRevisions] = useState<PostRevision[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState<{ type: "post" | "comment"; id: string; label: string } | null>(null);

  const refresh = useCallback(() => {
    // Drop any open history panel: after an edit it would still be showing
    // the revision list from before that edit, which is exactly the moment
    // it's most misleading. Reopening refetches.
    setRevisions(null);
    loadPost(slug)
      .then(setPost)
      .catch((e: unknown) => setError(apiErrorMessage(e, "Couldn't load that guide.")));
    loadComments(slug).then(setComments).catch(() => setComments([]));
  }, [slug]);

  useEffect(refresh, [refresh]);

  const submitComment = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const posted = await addComment(slug, draft.trim());
      setComments((c) => [...c, posted]);
      setDraft("");
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't post that comment."));
    } finally {
      setBusy(false);
    }
  };

  const removeComment = async (id: number) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await deleteComment(id);
      setComments((c) => c.filter((x) => x.id !== id));
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't delete that comment."));
    }
  };

  if (error && !post) return <p style={{ padding: 16, fontSize: 13, color: "var(--cs-danger)" }}>{error}</p>;
  if (!post) {
    return (
      <p style={{ padding: 16, fontSize: 13, color: "var(--cs-text-muted)", display: "flex", gap: 6, alignItems: "center" }}>
        <Loader2 size={14} className="cs-spin" /> Loading…
      </p>
    );
  }

  return (
    <div style={{ padding: "8px 8px 24px" }} data-testid="post-reader">
      <button className="cs-btn" onClick={onBack} style={{ marginBottom: 12 }} data-testid="post-back">
        <ArrowLeft size={14} /> All guides
      </button>

      <article style={{ padding: "0 8px" }}>
        <h2 className="cs-heading" style={{ fontSize: 22, fontWeight: 600, margin: "0 0 4px" }} data-testid="post-heading">
          {post.title}
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--cs-text-muted)" }}>
          {post.categoryLabel} · by{" "}
          {post.author.username ? (
            <button
              onClick={() => onViewProfile(post.author.username!)}
              style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--cs-accent)", cursor: "pointer" }}
              data-testid="post-author"
            >
              {post.author.name ?? post.author.username}
            </button>
          ) : (
            (post.author.name ?? "a community member")
          )}{" "}
          · updated {new Date(post.updatedAt).toLocaleDateString()}
          {post.visibility !== "published" && ` · ${post.visibility}`}
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          <ReactionButton type="post" id={post.id} count={post.reactionCount} reacted={post.reacted} />
          {post.isAuthor ? (
            <>
              <button className="cs-btn" onClick={() => setEditing(true)} data-testid="post-edit">
                <PenLine size={14} /> Edit
              </button>
              <button
                className="cs-btn"
                data-testid="post-history"
                onClick={() => (revisions ? setRevisions(null) : loadRevisions(post.id).then(setRevisions).catch(() => setRevisions([])))}
              >
                <History size={14} /> History ({post.revisionCount})
              </button>
              <button
                className="cs-btn"
                data-testid="post-delete"
                onClick={async () => {
                  if (!window.confirm(`Delete "${post.title}"? Its comments go with it.`)) return;
                  await deletePost(post.id);
                  onBack();
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </>
          ) : (
            viewer && (
              <button className="cs-btn" onClick={() => setReporting({ type: "post", id: post.id, label: `“${post.title}”` })} data-testid="post-report">
                <Flag size={14} /> Report
              </button>
            )
          )}
        </div>

        {revisions && (
          <div style={{ border: "1px solid var(--cs-border)", borderRadius: 8, padding: 12, marginBottom: 14 }} data-testid="post-revisions">
            <strong style={{ fontSize: 12 }}>Edit history</strong>
            {revisions.length === 0 ? (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--cs-text-muted)" }}>No edits yet — this is the original.</p>
            ) : (
              revisions.map((r) => (
                <details key={r.id} style={{ marginTop: 8, fontSize: 12 }}>
                  <summary style={{ cursor: "pointer", color: "var(--cs-text-muted)" }}>Before {new Date(r.saved_at).toLocaleString()}</summary>
                  <div style={{ marginTop: 6, opacity: 0.85 }}>
                    <Markdown source={r.body} />
                  </div>
                </details>
              ))
            )}
          </div>
        )}

        <Markdown source={post.body} />
      </article>

      <section style={{ marginTop: 24, padding: "0 8px" }} data-testid="post-comments">
        <h3 className="cs-heading" style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <MessageSquare size={14} /> Comments ({comments.length})
        </h3>

        {comments.map((c) => (
          <div key={c.id} style={{ borderTop: "1px solid var(--cs-border)", padding: "8px 0", display: "flex", gap: 8 }} data-testid="comment">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "var(--cs-text-muted)" }}>
                {c.author.name ?? "someone"} · {new Date(c.created_at).toLocaleString()}
              </div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{c.body}</div>
            </div>
            {viewer && (viewer.id === c.author.id || post.isAuthor) && (
              <button className="cs-icon-btn" title="Delete" onClick={() => void removeComment(c.id)} data-testid="comment-delete">
                <Trash2 size={13} />
              </button>
            )}
            {viewer && viewer.id !== c.author.id && (
              <button className="cs-icon-btn" title="Report" onClick={() => setReporting({ type: "comment", id: String(c.id), label: "this comment" })}>
                <Flag size={13} />
              </button>
            )}
          </div>
        ))}

        {viewer ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            <textarea
              className="cs-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="Add a comment…"
              data-testid="comment-draft"
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
            <button className="cs-btn" onClick={() => void submitComment()} disabled={busy || !draft.trim()} style={{ alignSelf: "flex-start" }} data-testid="comment-submit">
              {busy ? <Loader2 size={14} className="cs-spin" /> : <MessageSquare size={14} />} Comment
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: "var(--cs-text-muted)", marginTop: 10 }}>Sign in to join the discussion.</p>
        )}

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 13 }}>{error}</p>}
      </section>

      {editing && <PostEditorModal existing={post} onSaved={() => { setEditing(false); refresh(); }} onClose={() => setEditing(false)} />}
      {reporting && <ReportModal type={reporting.type} id={reporting.id} label={reporting.label} onClose={() => setReporting(null)} />}
    </div>
  );
}
