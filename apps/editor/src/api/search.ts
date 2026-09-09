import { api } from "./client";
import { toTemplateSummary, type TemplateSummary } from "./templates";
import { toPostSummary, type PostSummary } from "./posts";
import { toDesignSummary } from "./apiDesignStorage";
import type { DesignSummary } from "../designStorage";

export interface SearchResults {
  templates: TemplateSummary[];
  guides: PostSummary[];
  /** Only ever non-empty for the requester's own library — see
   * backend/app/Http/Controllers/Api/SearchController.php's doc comment.
   * A guest always gets an empty array here, never an auth error. */
  designs: DesignSummary[];
}

const EMPTY_RESULTS: SearchResults = { templates: [], guides: [], designs: [] };

/**
 * The global search bar's one endpoint — published templates, published
 * guides, and (signed in only) the requester's own library, each row
 * shaped exactly like TemplateController::browse()/PostController::browse()
 * /card-designs' listing rows, so the existing summary mappers apply
 * unchanged. See GlobalSearch.tsx for the UI this backs.
 */
export async function globalSearch(q: string): Promise<SearchResults> {
  const trimmed = q.trim();
  if (!trimmed) return EMPTY_RESULTS;

  const data = await api.get<{
    templates: Parameters<typeof toTemplateSummary>[0][];
    guides: Parameters<typeof toPostSummary>[0][];
    designs: Parameters<typeof toDesignSummary>[0][];
  }>(`/api/search?q=${encodeURIComponent(trimmed)}`);

  return {
    templates: data.templates.map(toTemplateSummary),
    guides: data.guides.map(toPostSummary),
    designs: data.designs.map(toDesignSummary),
  };
}
