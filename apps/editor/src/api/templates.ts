import { Design } from "@card-studio/scene-schema";
import { api } from "./client";
import type { Visibility } from "../visibility";

/** Kept as a name for readability at call sites; the vocabulary itself is
 * shared with designs — see ../visibility.ts. */
export type TemplateVisibility = Visibility;

export interface TemplateAuthor {
  id: number;
  /** The public handle their profile is addressed by. */
  username: string | null;
  /** Null only when the backend returned a row without its author eagerly
   * loaded — every endpoint here loads it, since attributing a community
   * template to the member who made it isn't optional (see
   * docs/PRODUCT_VISION.md's liability section). */
  name: string | null;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  visibility: TemplateVisibility;
  usageCount: number;
  version: number;
  updatedAt: string;
  author: TemplateAuthor;
}

export interface TemplateDetail extends TemplateSummary {
  /** The scene-schema Design this template *is* — parsed, so a template
   * saved by an older version of the editor still loads (same
   * Design.parse() defaulting designStorage.ts relies on). */
  design: Design;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  visibility: TemplateVisibility;
  usage_count: number;
  version: number;
  updated_at: string;
  author: { id: number; name: string | null; username: string | null };
  design?: unknown;
}

const toSummary = (row: TemplateRow): TemplateSummary => ({
  id: row.id,
  name: row.name,
  description: row.description,
  tags: row.tags ?? [],
  visibility: row.visibility,
  usageCount: row.usage_count,
  version: row.version,
  updatedAt: row.updated_at,
  author: row.author,
});

export interface BrowseParams {
  q?: string;
  tag?: string;
  sort?: "recent" | "popular";
  limit?: number;
}

/**
 * The public gallery of published templates — no auth needed (see
 * routes/api.php's comment on why browsing and using a template
 * deliberately works signed out).
 */
export async function browseTemplates(params: BrowseParams = {}): Promise<TemplateSummary[]> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.tag?.trim()) query.set("tag", params.tag.trim());
  if (params.sort) query.set("sort", params.sort);
  if (params.limit) query.set("limit", String(params.limit));

  const queryString = query.toString();
  const rows = await api.get<TemplateRow[]>(`/api/templates/browse${queryString ? `?${queryString}` : ""}`);

  return rows.map(toSummary);
}

/** "My templates" — every visibility, auth required. */
export async function listMyTemplates(): Promise<TemplateSummary[]> {
  const rows = await api.get<TemplateRow[]>("/api/templates");

  return rows.map(toSummary);
}

export async function loadTemplate(id: string): Promise<TemplateDetail> {
  const row = await api.get<TemplateRow>(`/api/templates/${id}`);

  return { ...toSummary(row), design: Design.parse(row.design) };
}

export interface SaveTemplateInput {
  id: string;
  name: string;
  description: string;
  tags: string[];
  visibility: TemplateVisibility;
  design: Design;
}

/** Upsert-by-id, exactly like apiDesignStorage.save() — the id is minted
 * client-side before the first save, so publishing a new template and
 * updating an existing one are the same call. */
export async function saveTemplate(input: SaveTemplateInput): Promise<TemplateSummary> {
  const row = await api.put<TemplateRow>(`/api/templates/${input.id}`, {
    name: input.name,
    description: input.description,
    tags: input.tags,
    visibility: input.visibility,
    design: input.design,
  });

  return toSummary(row);
}

/** Visibility on its own — flipping a template between private and
 * published from a list row shouldn't re-upload its whole design blob. */
export async function setTemplateVisibility(id: string, visibility: TemplateVisibility): Promise<TemplateSummary> {
  const row = await api.post<TemplateRow>(`/api/templates/${id}/publish`, { visibility });

  return toSummary(row);
}

export async function deleteTemplate(id: string): Promise<void> {
  await api.delete(`/api/templates/${id}`);
}

/**
 * Bumps the template's usage count. Deliberately fire-and-forget at the
 * call site: a counter failing to increment must never be the reason a
 * user doesn't get the design they just asked to start.
 */
export async function markTemplateUsed(id: string): Promise<void> {
  await api.post(`/api/templates/${id}/use`);
}
