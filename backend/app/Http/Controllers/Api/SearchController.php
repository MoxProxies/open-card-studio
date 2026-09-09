<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Post;
use App\Models\Template;
use Illuminate\Http\Request;

/**
 * The global search bar's one endpoint: published templates, published
 * guides, and — only for the requester themself — their own library.
 *
 * Deliberately boring: a case-insensitive LIKE against name/description
 * (templates) or title/body (guides) or name (designs), each capped at a
 * handful of rows. No full-text index, no ranking, no fuzzy matching — a
 * simple, tunable, explainable approach beats a clever one, and this is
 * the same substring match TemplateController::browse() and
 * PostController::browse() already do, just fanned out across three
 * tables and trimmed to preview size.
 *
 * Public route (see routes/api.php), same reasoning as browse(): a guest
 * can search templates and guides just like they can browse them. But
 * `designs` is never populated for a guest — a design is someone's
 * private library, and this endpoint must not let a signed-out caller
 * learn anything about it. Unauthenticated requests get `"designs": []`
 * rather than the key being omitted, so the frontend can always index it
 * without an existence check.
 */
class SearchController extends Controller
{
    /** A search-bar preview, not a listing page — same idea as TemplateController::MAX_BROWSE_LIMIT, just smaller. */
    private const PER_TYPE_LIMIT = 8;

    public function index(Request $request)
    {
        $params = $request->validate([
            'q' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);

        $q = trim((string) ($params['q'] ?? ''));

        if ($q === '') {
            return response()->json(['templates' => [], 'guides' => [], 'designs' => []]);
        }

        // Escape LIKE wildcards, same as TemplateController::browse and
        // PostController::browse — a literal % or _ typed into the search
        // box shouldn't silently become "match anything".
        $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);

        $viewer = $request->user('sanctum');

        $templates = Template::query()->published()
            ->with(['user:id,name,username', 'forkedFrom.user:id,name,username'])
            ->where(fn ($query) => $query->where('name', 'like', "%{$escaped}%")->orWhere('description', 'like', "%{$escaped}%"))
            ->withCount(['reactions', 'forks'])
            ->latest('updated_at')
            ->limit(self::PER_TYPE_LIMIT)
            ->get();

        $guides = Post::query()->published()
            ->with('user:id,name,username')
            ->where(fn ($query) => $query->where('title', 'like', "%{$escaped}%")->orWhere('body', 'like', "%{$escaped}%"))
            ->withCount(['reactions', 'comments'])
            ->latest('updated_at')
            ->limit(self::PER_TYPE_LIMIT)
            ->get();

        // ->cardDesigns(), never CardDesign::query() — the same
        // owner-scoping every write path in this codebase uses (see
        // CardDesignController's doc comment), so one account can never
        // surface another's designs here regardless of visibility.
        $designs = $viewer
            ? $viewer->cardDesigns()
                ->where('name', 'like', "%{$escaped}%")
                ->latest('updated_at')
                ->limit(self::PER_TYPE_LIMIT)
                ->get()
            : collect();

        return response()->json([
            'templates' => $templates->map(fn ($template) => $template->toSummary() + $template->reactionState($viewer)),
            'guides' => $guides->map(fn ($post) => $post->toSummary() + $post->reactionState($viewer)),
            'designs' => $designs->map->toSummary(),
        ]);
    }
}
