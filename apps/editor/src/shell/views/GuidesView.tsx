import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Search, Loader2, PenLine, MessageSquare, Users, FileText } from "lucide-react";
import { apiErrorMessage } from "../../api/client";
import { getCurrentUser, subscribe } from "../../api/auth";
import { browsePosts, listMyPosts, POST_CATEGORIES, type PostSummary } from "../../api/posts";
import { ListRow } from "../../components/ListRow";
import { ReactionButton } from "../../components/ReactionButton";
import { PostEditorModal } from "../../components/PostEditorModal";
import { PostReader } from "../../components/PostReader";
import { navigate, useRoute } from "../navStore";
import { Page } from "../Page";

/**
 * The community knowledge base. The index and one guide are the same
 * destination: opening a guide pushes its slug into the URL
 * (`#/guides/:slug`), so it can be linked to and the back button works.
 */
export function GuidesView() {
  const route = useRoute();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const canList = tab === "browse" || Boolean(user);

  const refresh = useCallback(() => {
    if (!canList) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (tab === "mine" ? listMyPosts() : browsePosts({ q: search, category: category || undefined }))
      .then(setPosts)
      .catch((e: unknown) => setError(apiErrorMessage(e, "Couldn't load guides — check your connection and try again.")))
      .finally(() => setLoading(false));
  }, [tab, search, category, canList]);

  useEffect(() => {
    const timer = setTimeout(refresh, 200);
    return () => clearTimeout(timer);
  }, [refresh, reloadToken]);

  if (route.slug) {
    return (
      <Page testId="page-guides" title="Guides">
        <PostReader
          slug={route.slug}
          onBack={() => navigate({ tab: "guides" })}
          onViewProfile={(username) => navigate({ tab: "profile", username })}
        />
      </Page>
    );
  }

  return (
    <>
      <Page
        testId="page-guides"
        title="Guides"
        subtitle="How to print, cut and source card stock at home — plus design tips from the community."
        toolbar={
          <>
            <button className={`cs-btn${tab === "browse" ? " cs-active" : ""}`} onClick={() => setTab("browse")} data-testid="guides-tab-browse">
              <Users size={14} /> Community
            </button>
            <button className={`cs-btn${tab === "mine" ? " cs-active" : ""}`} onClick={() => setTab("mine")} data-testid="guides-tab-mine">
              <FileText size={14} /> My guides
            </button>
            <div style={{ flex: 1 }} />
            <button className="cs-btn" onClick={() => setWriting(true)} disabled={!user} data-testid="guide-write" title={user ? "Write a guide" : "Sign in to write a guide"}>
              <PenLine size={14} /> Write a guide
            </button>
            {tab === "browse" && (
              <div style={{ display: "flex", gap: 8, width: "100%" }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <Search size={14} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--cs-text-muted)" }} />
                  <input
                    className="cs-input"
                    placeholder="Search guides…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ width: "100%", paddingLeft: 28 }}
                    data-testid="guides-search"
                  />
                </div>
                <select className="cs-input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 170 }} data-testid="guides-category">
                  <option value="">All categories</option>
                  {POST_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        }
      >
        {!canList ? (
          <p style={{ padding: "6px 8px", fontSize: 13, color: "var(--cs-text-muted)" }}>Sign in to see the guides you've written.</p>
        ) : loading ? (
          <p style={{ padding: "6px 8px", fontSize: 13, color: "var(--cs-text-muted)", display: "flex", gap: 6, alignItems: "center" }}>
            <Loader2 size={14} className="cs-spin" /> Loading…
          </p>
        ) : error ? (
          <p style={{ padding: "6px 8px", fontSize: 13, color: "var(--cs-danger)" }}>{error}</p>
        ) : posts.length === 0 ? (
          <p style={{ padding: "6px 8px", fontSize: 13, color: "var(--cs-text-muted)" }}>
            {tab === "mine" ? "You haven't written any guides yet." : "No guides match that search yet."}
          </p>
        ) : (
          posts.map((p) => (
            <ListRow
              key={p.id}
              testId="guide-row"
              title={p.title}
              subtitle={
                <>
                  {p.categoryLabel} · {p.author.name ?? "a community member"}
                  {p.visibility !== "published" && ` · ${p.visibility}`} · {p.excerpt}
                </>
              }
              onClick={() => navigate({ tab: "guides", slug: p.slug })}
            >
              {p.commentCount !== null && p.commentCount > 0 && (
                <span style={{ fontSize: 11, color: "var(--cs-text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                  <MessageSquare size={12} /> {p.commentCount}
                </span>
              )}
              <ReactionButton type="post" id={p.id} count={p.reactionCount} reacted={p.reacted} />
            </ListRow>
          ))
        )}
      </Page>

      {writing && (
        <PostEditorModal
          onSaved={(post) => {
            setWriting(false);
            navigate({ tab: "guides", slug: post.slug });
          }}
          onClose={() => setWriting(false)}
        />
      )}
    </>
  );
}
