<?php

namespace App\Http\Controllers\Api;

use App\Models\CardDesign;
use App\Models\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Collections — see the Collection model. publish() and destroy() come
 * from OwnedContentController unchanged; what's specific to this type is
 * membership (add/remove/reorder a design) and the fact that a published
 * collection may still contain private designs, which only its owner sees.
 */
class CollectionController extends OwnedContentController
{
    protected function owned(Request $request): HasMany
    {
        return $request->user()->collections();
    }

    protected static function model(): string
    {
        return Collection::class;
    }

    public function index(Request $request)
    {
        $collections = $this->owned($request)
            ->visibleToPublic()
            ->withCount(['cardDesigns as design_count'])
            ->with('user:id,name,username')
            ->latest('updated_at')
            ->get();

        return response()->json($collections->map->toSummary());
    }

    /** Public when published or unlisted; owner-only otherwise. Same
     * shape, and same 404-don't-leak-existence rule, as a template. */
    public function show(Request $request, string $id)
    {
        $collection = Collection::visibleToPublic()
            ->with(['user:id,name,username', 'cardDesigns'])
            ->find($id);

        $viewer = $request->user('sanctum');
        $isOwner = $viewer && $collection && $collection->user_id === $viewer->id;

        abort_if(! $collection || (! $isOwner && ! $collection->isPubliclyReadable()), 404);

        return response()->json($collection->toDetail($isOwner));
    }

    public function upsert(Request $request, string $id)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'visibility' => ['sometimes', Rule::in(Collection::VISIBILITIES)],
        ]);

        $existing = Collection::abortIfOwnedByAnotherUser($request, $id, 'collection');

        $collection = Collection::updateOrCreateOwned($request, $id, $data, 'collection');

        return response()->json(
            $collection->refresh()->load(['user:id,name,username', 'cardDesigns'])->toDetail(true),
            $existing ? 200 : 201
        );
    }

    /**
     * Put one of your designs in one of your collections. Both sides are
     * owner-scoped: you can't file someone else's design, and you can't
     * file into someone else's collection. Idempotent — re-adding moves it
     * rather than duplicating (the pivot's unique index would reject that
     * anyway).
     */
    public function addDesign(Request $request, string $id, string $designId)
    {
        $data = $request->validate(['position' => ['sometimes', 'integer', 'min:0']]);

        $collection = $this->owned($request)->visibleToPublic()->findOrFail($id);
        $design = $request->user()->cardDesigns()->findOrFail($designId);

        $collection->cardDesigns()->syncWithoutDetaching([
            $design->id => ['position' => $data['position'] ?? $collection->cardDesigns()->count()],
        ]);

        // touch() so the collection's updated_at reflects the change —
        // otherwise "recently updated" ordering ignores membership edits.
        $collection->touch();

        return response()->json($collection->load('cardDesigns')->toDetail(true));
    }

    public function removeDesign(Request $request, string $id, string $designId)
    {
        $collection = $this->owned($request)->findOrFail($id);
        $collection->cardDesigns()->detach($designId);
        $collection->touch();

        return response()->json($collection->load('cardDesigns')->toDetail(true));
    }
}
