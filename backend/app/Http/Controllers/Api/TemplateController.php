<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Template;
use Illuminate\Http\Request;

/**
 * CRUD + publishing for community-authored card templates.
 *
 * A Template is a Design plus publishing metadata (see the Template model
 * and docs/PRODUCT_VISION.md, "The architectural centerpiece") — so, like
 * CardDesignController, this controller stores and returns the `design`
 * column completely opaque and never inspects its internal shape. Which
 * layers a template treats as fixed chrome and which as fill-in slots is
 * carried by the layers' own locked/contentLocked flags inside that blob;
 * there is deliberately no slot schema for the backend to validate.
 *
 * Two listing paths, deliberately separate rather than one endpoint with
 * a flag:
 *  - index()  — "my templates", auth-scoped to $request->user(), every
 *               visibility, the management view.
 *  - browse() — the public gallery: published rows from every user, no
 *               auth required (a discovery index, same reasoning as
 *               PluginController::index — you should be able to look
 *               before you sign up).
 * Everything that writes is auth-scoped; nothing here can read, overwrite,
 * or delete another account's private row.
 */
class TemplateController extends Controller
{
    /** Hard ceiling on a browse page, whatever `limit` asks for. */
    private const MAX_BROWSE_LIMIT = 100;

    public function index(Request $request)
    {
        $templates = $request->user()
            ->templates()
            ->visibleToPublic()
            ->with('user:id,name')
            ->latest('updated_at')
            ->get();

        return response()->json($templates->map->toSummary());
    }

    /**
     * The public gallery. `q` searches name + description, `tag` filters to
     * one tag, `sort` is recent (default) or popular. Only `published`
     * rows ever appear here: `unlisted` is reachable by id (a link its
     * author shared) but never listed, and `private` is owner-only.
     */
    public function browse(Request $request)
    {
        $params = $request->validate([
            'q' => ['sometimes', 'nullable', 'string', 'max:100'],
            'tag' => ['sometimes', 'nullable', 'string', 'max:32'],
            'sort' => ['sometimes', 'string', 'in:recent,popular'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_BROWSE_LIMIT],
        ]);

        $query = Template::query()
            ->where('visibility', 'published')
            ->visibleToPublic()
            ->with('user:id,name');

        if ($search = trim((string) ($params['q'] ?? ''))) {
            // escape LIKE wildcards so a literal % or _ in a search box
            // doesn't silently become "match anything".
            $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search);
            $query->where(function ($q) use ($escaped) {
                $q->where('name', 'like', "%{$escaped}%")
                    ->orWhere('description', 'like', "%{$escaped}%");
            });
        }

        if ($tag = trim((string) ($params['tag'] ?? ''))) {
            // tags are stored normalized (lowercased/trimmed — see
            // normalizeTags below), so an exact JSON-contains match is
            // enough and needs no per-row scanning.
            $query->whereJsonContains('tags', mb_strtolower($tag));
        }

        $query = ($params['sort'] ?? 'recent') === 'popular'
            ? $query->orderByDesc('usage_count')->orderByDesc('updated_at')
            : $query->latest('updated_at');

        $templates = $query->limit($params['limit'] ?? 50)->get();

        return response()->json($templates->map->toSummary());
    }

    /**
     * One template including its design blob — what "new design from this
     * template" fetches. Readable without auth when published or unlisted;
     * a private row is owner-only, and a miss 404s rather than 403s so this
     * can't be used to probe which ids exist.
     */
    public function show(Request $request, string $id)
    {
        $template = Template::visibleToPublic()->with('user:id,name')->find($id);

        // ->user('sanctum') rather than ->user(): this route sits outside
        // the auth:sanctum group (published templates are public), so
        // there's no guard already resolved on the request — naming the
        // guard is what makes a bearer token that *was* sent still count.
        $viewer = $request->user('sanctum');
        $isOwner = $viewer && $template && $template->user_id === $viewer->id;

        abort_if(! $template || (! $isOwner && ! in_array($template->visibility, ['published', 'unlisted'], true)), 404);

        return response()->json($template->toDetail());
    }

    /**
     * Create or update — PUT-upsert-by-id for the same reason
     * CardDesignController::upsert is: the editor mints the id itself
     * (crypto.randomUUID()) before the first save, so "save as template"
     * and "update my template" are the same call.
     */
    public function upsert(Request $request, string $id)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'tags' => ['sometimes', 'array', 'max:8'],
            'tags.*' => ['string', 'max:32'],
            'visibility' => ['sometimes', 'string', 'in:private,unlisted,published'],
            'design' => ['required', 'array'],
        ]);

        $existing = Template::abortIfOwnedByAnotherUser($request, $id, 'template');

        if (array_key_exists('tags', $data)) {
            $data['tags'] = $this->normalizeTags($data['tags']);
        }

        // Bump the version only when the layout itself actually changed —
        // fixing a typo in the description shouldn't read to anyone as a
        // new revision of the template. Nothing migrates designs already
        // made from an older version (explicitly out of scope for Phase 1,
        // see PRODUCT_VISION.md); this is a marker for humans.
        if ($existing && $existing->design !== $data['design']) {
            $data['version'] = $existing->version + 1;
        }

        $template = Template::updateOrCreate(
            ['id' => $id, 'user_id' => $request->user()->id],
            $data + ['tags' => $existing?->tags ?? []],
        );

        // refresh() so a freshly-created row reports the columns the
        // *database* defaulted (usage_count, version, moderation_state)
        // rather than the nulls an in-memory model has for them — a create
        // response should describe the row that now exists, not just the
        // fields the request happened to send.
        return response()->json($template->refresh()->load('user:id,name')->toDetail(), $existing ? 200 : 201);
    }

    /**
     * Visibility on its own, so flipping a template between private and
     * published from a list row doesn't mean re-uploading its whole design
     * blob just to change one string.
     */
    public function publish(Request $request, string $id)
    {
        $data = $request->validate([
            'visibility' => ['required', 'string', 'in:private,unlisted,published'],
        ]);

        $template = $request->user()->templates()->visibleToPublic()->findOrFail($id);
        $template->update($data);

        return response()->json($template->load('user:id,name')->toSummary());
    }

    public function destroy(Request $request, string $id)
    {
        $request->user()->templates()->where('id', $id)->delete();

        return response()->noContent();
    }

    /**
     * "A new design was started from this template" — the usage/fork count
     * from PRODUCT_VISION's Phase 1 scope. Unauthenticated on purpose:
     * browsing and using a published template doesn't require an account
     * (the resulting design saves to localStorage until you sign in), and
     * a count that silently ignored every signed-out use would be worse
     * than useless. Rate-limited in routes/api.php rather than gated,
     * since the only thing an abuser gains is a wrong number on their own
     * template.
     */
    public function use(Request $request, string $id)
    {
        $template = Template::visibleToPublic()
            ->whereIn('visibility', ['published', 'unlisted'])
            ->findOrFail($id);

        $template->increment('usage_count');

        return response()->json(['id' => $template->id, 'usage_count' => $template->usage_count]);
    }

    /**
     * Free-text tags, trimmed/lowercased/deduped and stripped of empties —
     * deliberately not validated against a curated list of styles or
     * franchises (see PRODUCT_VISION.md's liability section for why a
     * hardcoded enum is the wrong shape). Normalizing at write time is
     * what lets browse() filter with a plain whereJsonContains.
     */
    private function normalizeTags(array $tags): array
    {
        $normalized = array_map(fn ($tag) => mb_strtolower(trim((string) $tag)), $tags);

        return array_values(array_unique(array_filter($normalized, fn ($tag) => $tag !== '')));
    }
}
