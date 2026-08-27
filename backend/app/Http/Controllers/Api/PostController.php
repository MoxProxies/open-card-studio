<?php

namespace App\Http\Controllers\Api;

use App\Models\Post;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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

        $post = Post::updateOrCreate(
            ['id' => $id, 'user_id' => $request->user()->id],
            $data + ['tags' => $existing?->tags ?? []],
        );

        return response()->json($post->refresh()->load('user:id,name,username')->toDetail(), $existing ? 200 : 201);
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
