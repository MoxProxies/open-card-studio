<?php

namespace App\Http\Controllers\Api;

use App\Models\Post;
use App\Support\DuplicateKey;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The community knowledge base. publish() and destroy() come from
 * OwnedContentController; what's specific here is the slug (a post is
 * addressed by one, not by its uuid), the category filter, and writing an
 * edit-history row before every change.
 */
class PostController extends OwnedContentController
{
    private const MAX_LIMIT = 50;

    protected function owned(Request $request): HasMany
    {
        return $request->user()->posts();
    }

    protected static function model(): string
    {
        return Post::class;
    }

    /** The public index. Anyone can read it, signed in or not. */
    public function browse(Request $request)
    {
        $params = $request->validate([
            'q' => ['sometimes', 'nullable', 'string', 'max:100'],
            'category' => ['sometimes', 'nullable', Rule::in(array_keys(config('knowledge_base.categories')))],
            'tag' => ['sometimes', 'nullable', 'string', 'max:32'],
            'sort' => ['sometimes', Rule::in(['recent', 'popular'])],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_LIMIT],
        ]);

        $query = Post::query()->published()->with('user:id,name,username')->withCount(['reactions', 'comments']);

        if ($search = trim((string) ($params['q'] ?? ''))) {
            $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search);
            $query->where(fn ($q) => $q->where('title', 'like', "%{$escaped}%")->orWhere('body', 'like', "%{$escaped}%"));
        }

        if ($category = $params['category'] ?? null) {
            $query->where('category', $category);
        }

        if ($tag = trim((string) ($params['tag'] ?? ''))) {
            $query->whereJsonContains('tags', mb_strtolower($tag));
        }

        $query = ($params['sort'] ?? 'recent') === 'popular'
            ? $query->orderByDesc('reactions_count')->orderByDesc('updated_at')
            : $query->latest('updated_at');

        $viewer = $request->user('sanctum');
        $posts = $query->limit($params['limit'] ?? 25)->get();

        return response()->json($posts->map(fn ($post) => $post->toSummary() + $post->reactionState($viewer)));
    }

    /** By slug, not id — a post's URL is its slug. */
    public function show(Request $request, string $slug)
    {
        $post = Post::visibleToPublic()->with('user:id,name,username')->withCount(['reactions', 'comments', 'revisions'])->where('slug', $slug)->first();

        $viewer = $request->user('sanctum');
        $isOwner = $viewer && $post && $post->user_id === $viewer->id;

        abort_if(! $post || (! $isOwner && ! $post->isPubliclyReadable()), 404);

        return response()->json($post->toDetail() + $post->reactionState($viewer) + ['is_author' => $isOwner]);
    }

    public function upsert(Request $request, string $id)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string', 'max:50000'],
            'category' => ['sometimes', Rule::in(array_keys(config('knowledge_base.categories')))],
            'tags' => ['sometimes', 'array', 'max:8'],
            'tags.*' => ['string', 'max:32'],
            'visibility' => ['sometimes', Rule::in(Post::VISIBILITIES)],
        ]);

        $existing = Post::abortIfOwnedByAnotherUser($request, $id, 'post');

        if ($existing) {
            // Snapshot the version being replaced *before* overwriting it —
            // see the PostRevision model for why this can't be added later.
            if ($existing->title !== $data['title'] || $existing->body !== $data['body']) {
                $existing->revisions()->create([
                    'user_id' => $request->user()->id,
                    'title' => $existing->title,
                    'body' => $existing->body,
                ]);
            }
        } else {
            // Generated once, from the first title, then never changed: a
            // renamed post keeps its URL rather than breaking every link.
            $data['slug'] = Post::uniqueSlug($data['title']);
        }

        if (array_key_exists('tags', $data)) {
            $data['tags'] = array_values(array_unique(array_filter(array_map(fn ($t) => mb_strtolower(trim((string) $t)), $data['tags']))));
        }

        $post = $this->upsertPost($request, $id, $data + ['tags' => $existing?->tags ?? []], $existing, $data['title']);

        return response()->json($post->refresh()->load('user:id,name,username')->toDetail(), $existing ? 200 : 201);
    }

    /**
     * The actual write behind upsert() above, guarded against two
     * different races that both surface as the same unique-index
     * collision on this one updateOrCreate() call:
     *
     *  - **The id.** abortIfOwnedByAnotherUser()'s existence check and
     *    this write aren't atomic, so two truly-simultaneous PUTs with
     *    the same client-generated id (a double-submit, a retried
     *    request) can both pass it and then both try to INSERT the same
     *    primary key — same race as OwnedByUser::updateOrCreateOwned()
     *    guards for Collection/Template/CardDesign. Post can't just use
     *    that helper, though: unlike those, a *new* post's write can also
     *    collide on...
     *  - **The slug.** Post::uniqueSlug()'s existence check has the exact
     *    same non-atomic shape, so two new posts whose titles slugify to
     *    the same value can both compute it as free and then both try to
     *    insert it — a different unique index on the same table, needing
     *    a different recovery (pick another slug, not treat it as an id
     *    collision).
     *
     * Which one it was has to be told apart from the exception message,
     * the same way saveWithUniqueUsername() tells a username collision
     * from any other. A slug collision only happens on the create path
     * ($existing === null); on an update, this can only be the id.
     */
    private function upsertPost(Request $request, string $id, array $data, ?Post $existing, string $title, int $maxAttempts = 5): Post
    {
        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                return Post::updateOrCreate(['id' => $id, 'user_id' => $request->user()->id], $data);
            } catch (QueryException $e) {
                if (! DuplicateKey::matches($e)) {
                    throw $e;
                }

                // DuplicateKey::reason() strips the query Laravel appends
                // to the message — the INSERT this came from always names
                // every column including "slug", so checking the raw
                // message would treat *any* collision on this table (e.g.
                // the id, below) as a slug collision just because that
                // column happened to be part of the same INSERT.
                if (! $existing && str_contains(DuplicateKey::reason($e), 'slug')) {
                    $data['slug'] = Post::uniqueSlug($title);

                    continue;
                }

                // Not a slug collision, so it has to be the id: the
                // database is what actually knows which request landed
                // first, so the loser retries as the UPDATE it should
                // have been all along, rather than surfacing the raw
                // collision as a 500.
                $row = Post::find($id);

                abort_if(! $row || $row->user_id !== $request->user()->id, 409, 'That post id belongs to another account.');

                // The winner's row already has its own slug, generated
                // from *its* create — this is an update now, and
                // Post::uniqueSlug()'s doc comment is explicit that a
                // slug is generated once and never changed afterwards.
                // $data may still be carrying the slug this request
                // computed for the create it lost, which must not
                // overwrite it.
                unset($data['slug']);

                $row->update($data);

                return $row;
            }
        }

        throw ValidationException::withMessages(['title' => ['Could not find a free URL for this post. Try again.']]);
    }

    /** Your own posts, every visibility. */
    public function index(Request $request)
    {
        $posts = $this->owned($request)->visibleToPublic()->with('user:id,name,username')->withCount('comments')->latest('updated_at')->get();

        return response()->json($posts->map->toSummary());
    }

    /**
     * The edit history. Owner-only for now: it exists for moderation, and
     * there's no staff role yet to expose it to (Phase 6). Making it
     * public would also let anyone read a paragraph an author thought
     * better of and deleted.
     */
    public function revisions(Request $request, string $id)
    {
        $post = $this->owned($request)->findOrFail($id);

        return response()->json($post->revisions()->get()->map->toArray());
    }
}
