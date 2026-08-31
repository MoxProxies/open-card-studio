<?php

namespace App\Http\Controllers\Api;

use App\Models\Template;
use App\Support\BadgeRules;
use App\Support\Notifier;
use App\Support\PointsLedger;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

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
class TemplateController extends OwnedContentController
{
    /** Hard ceiling on a browse page, whatever `limit` asks for. */
    private const MAX_BROWSE_LIMIT = 100;

    protected function owned(Request $request): HasMany
    {
        return $request->user()->templates();
    }

    protected static function model(): string
    {
        return Template::class;
    }

    public function index(Request $request)
    {
        $templates = $this->owned($request)
            ->visibleToPublic()
            ->with(['user:id,name,username', 'forkedFrom.user:id,name,username'])
            ->withCount(['reactions', 'forks'])
            ->latest('updated_at')
            ->get();

        $viewer = $request->user();

        return response()->json($templates->map(fn ($template) => $template->toSummary() + $template->reactionState($viewer)));
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

        $query = Template::query()->published()->with(['user:id,name,username', 'forkedFrom.user:id,name,username']);

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
            // "Most used" ranks by uses first, then by reactions — a
            // template people both use and like outranks one they only use.
            ? $query->orderByDesc('usage_count')->orderByDesc('reactions_count')->orderByDesc('updated_at')
            : $query->latest('updated_at');

        $templates = $query->withCount(['reactions', 'forks'])->limit($params['limit'] ?? 50)->get();
        $viewer = $request->user('sanctum');

        return response()->json($templates->map(fn ($template) => $template->toSummary() + $template->reactionState($viewer)));
    }

    /**
     * One template including its design blob — what "new design from this
     * template" fetches. Readable without auth when published or unlisted;
     * a private row is owner-only, and a miss 404s rather than 403s so this
     * can't be used to probe which ids exist.
     */
    public function show(Request $request, string $id)
    {
        $template = Template::visibleToPublic()->with(['user:id,name,username', 'forkedFrom.user:id,name,username'])->withCount('forks')->find($id);

        // ->user('sanctum') rather than ->user(): this route sits outside
        // the auth:sanctum group (published templates are public), so
        // there's no guard already resolved on the request — naming the
        // guard is what makes a bearer token that *was* sent still count.
        $viewer = $request->user('sanctum');
        $isOwner = $viewer && $template && $template->user_id === $viewer->id;

        abort_if(! $template || (! $isOwner && ! $template->isPubliclyReadable()), 404);

        return response()->json($template->toDetail() + $template->reactionState($viewer));
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
            'visibility' => ['sometimes', Rule::in(Template::VISIBILITIES)],
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
        return response()->json($template->refresh()->load('user:id,name,username')->toDetail(), $existing ? 200 : 201);
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
        $template = Template::publiclyReadable()->findOrFail($id);

        $template->increment('usage_count');

        // Points only for a signed-in use, deduped per (template, user):
        // this endpoint is deliberately open (see its doc comment above),
        // and an anonymous award would be farmable by anyone with a loop.
        // The usage *count* still moves either way.
        if (($user = $request->user('sanctum')) && $template->user && $template->user_id !== $user->id) {
            PointsLedger::award($template->user, 'template_used', $template, "used:{$template->id}:{$user->id}");
            BadgeRules::evaluate($template->user);
        }

        return response()->json(['id' => $template->id, 'usage_count' => $template->usage_count]);
    }

    /**
     * Remix: a copy of someone else's layout, owned by you, credited to
     * them.
     *
     * A full copy, not a reference — the design blob is duplicated, so
     * editing a remix can't reach back into the original and deleting the
     * original can't break the remix (the lineage link nulls out instead;
     * see the migration). That's also why this is a different thing from
     * "new design from template": a remix is a *template* you can keep
     * editing and publish in turn, while `use` produces a one-off design.
     *
     * It lands **private**. Publishing someone else's layout under your
     * own name the instant you press a button is the failure mode worth
     * designing out; making it public is a second, deliberate step.
     */
    public function fork(Request $request, string $id)
    {
        $source = Template::publiclyReadable()->with('user:id,name,username')->findOrFail($id);
        $user = $request->user();

        // Forking your own template is just duplicating it, which is a
        // reasonable thing to want and needs no special case.
        $fork = Template::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'name' => Str::limit($source->name.' (remix)', 255, ''),
            'description' => $source->description,
            'tags' => $source->tags,
            // Template::, not Publishable:: — a trait constant is
            // reached through the class that uses the trait.
            'visibility' => Template::PRIVATE,
            'design' => $source->design,
            'version' => 1,
        ]);

        // Assigned rather than mass-assigned: lineage is the app's to
        // state, not something a request payload gets to claim — the
        // same rule usage_count and moderation_state follow.
        $fork->forked_from_id = $source->id;
        $fork->save();

        // Deduped per (source, remixer): remixing the same template twice
        // is one piece of news about one person's interest.
        Notifier::notify($source->user, 'remix', $user, $source, ['title' => $source->name], "remix:{$source->id}:{$user->id}");

        // refresh() so database defaults (usage_count, moderation_state)
        // are in the response — a just-created model doesn't carry them.
        return response()->json($fork->refresh()->load('user:id,name,username', 'forkedFrom.user:id,name,username')->toDetail(), 201);
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
