import { api } from "./client";
import type { Visibility } from "../visibility";
import type { ReactionState } from "./gamification";

export interface PostAuthor {
  id: number;
  name: string | null;
  username: string | null;
}

export interface PostSummary {
  id: string;
  title: string;
  /** What the post's URL is built from — stable across renames. */
  slug: string;
  category: string;
  categoryLabel: string;
  tags: string[];
  visibility: Visibility;
  excerpt: string;
  updatedAt: string;
  commentCount: number | null;
  author: PostAuthor;
  reactionCount: number;
  reacted: boolean;
}

export interface PostDetail extends PostSummary {
  body: string;
  revisionCount: number;
  isAuthor: boolean;
}

export interface PostComment {
  id: number;
  body: string;
  created_at: string;
  author: PostAuthor;
}

export interface PostRevision {
  id: number;
  title: string;
  body: string;
  saved_at: string;
}

type Row = Record<string, unknown> & Partial<ReactionState>;

const toSummary = (row: Row): PostSummary => ({
  id: row.id as string,
  title: row.title as string,
  slug: row.slug as string,
  category: row.category as string,
  categoryLabel: (row.category_label ?? row.category) as string,
  tags: (row.tags ?? []) as string[],
  visibility: row.visibility as Visibility,
  excerpt: (row.excerpt ?? "") as string,
  updatedAt: row.updated_at as string,
  commentCount: (row.comment_count ?? null) as number | null,
  author: row.author as PostAuthor,
  reactionCount: row.reaction_count ?? 0,
  reacted: row.reacted ?? false,
});

const toDetail = (row: Row): PostDetail => ({
  ...toSummary(row),
  body: (row.body ?? "") as string,
  revisionCount: (row.revision_count ?? 0) as number,
  isAuthor: (row.is_author ?? false) as boolean,
});

export interface BrowsePostsParams {
  q?: string;
  category?: string;
  tag?: string;
  sort?: "recent" | "popular";
}

export async function browsePosts(params: BrowsePostsParams = {}): Promise<PostSummary[]> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.category) query.set("category", params.category);
  if (params.tag?.trim()) query.set("tag", params.tag.trim());
  if (params.sort) query.set("sort", params.sort);
  const qs = query.toString();

  return (await api.get<Row[]>(`/api/posts${qs ? `?${qs}` : ""}`)).map(toSummary);
}

/** Your own posts, drafts included. */
export async function listMyPosts(): Promise<PostSummary[]> {
  return (await api.get<Row[]>("/api/my/posts")).map(toSummary);
}

export async function loadPost(slug: string): Promise<PostDetail> {
  return toDetail(await api.get<Row>(`/api/posts/${encodeURIComponent(slug)}`));
}

export interface SavePostInput {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  visibility: Visibility;
}

export async function savePost(input: SavePostInput): Promise<PostDetail> {
  const { id, ...body } = input;

  return toDetail(await api.put<Row>(`/api/posts/${id}`, body));
}

export async function deletePost(id: string): Promise<void> {
  await api.delete(`/api/posts/${id}`);
}

export async function loadComments(slug: string): Promise<PostComment[]> {
  return api.get(`/api/posts/${encodeURIComponent(slug)}/comments`);
}

export async function addComment(slug: string, body: string): Promise<PostComment> {
  return api.post(`/api/posts/${encodeURIComponent(slug)}/comments`, { body });
}

export async function deleteComment(id: number): Promise<void> {
  await api.delete(`/api/comments/${id}`);
}

export async function loadRevisions(id: string): Promise<PostRevision[]> {
  return api.get(`/api/posts/${id}/revisions`);
}

/** Mirrors backend config/knowledge_base.php. Kept here rather than
 * fetched: it's a handful of labels that change about never, and a whole
 * request to render a dropdown isn't worth it. */
export const POST_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "printing", label: "Printing" },
  { value: "cutting", label: "Cutting & finishing" },
  { value: "materials", label: "Card stock & materials" },
  { value: "design", label: "Design tips" },
  { value: "showcase", label: "Showcase" },
  { value: "general", label: "General" },
];
