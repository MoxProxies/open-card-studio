<?php

namespace App\Http\Controllers\Api;

use App\Models\CardDesign;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Every action here scopes to $request->user(), never a raw
 * CardDesign::find(), so one user can never read, overwrite, or delete
 * another's row by guessing an id. `design` is stored and returned
 * completely opaque (see the migration's doc comment) — this controller
 * never inspects its internal shape.
 *
 * There's no separate "create" endpoint: the frontend's DesignStorage.save()
 * (apiDesignStorage.ts) always already has an id — a client-generated
 * UUID, same as the localStorage-backed implementation's upsert-by-id
 * behavior — so `upsert()` below is the only write path, whether this is
 * a design's first save or its fiftieth.
 */
class CardDesignController extends OwnedContentController
{
    protected function owned(Request $request): HasMany
    {
        return $request->user()->cardDesigns();
    }

    protected static function model(): string
    {
        return CardDesign::class;
    }

    public function index(Request $request)
    {
        return response()->json($this->owned($request)->latest('updated_at')->get()->map->toSummary());
    }

    public function show(Request $request, string $id)
    {
        return response()->json($this->owned($request)->findOrFail($id));
    }

    public function upsert(Request $request, string $id)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'design' => ['required', 'array'],
            'visibility' => ['sometimes', Rule::in(CardDesign::VISIBILITIES)],
        ]);

        CardDesign::abortIfOwnedByAnotherUser($request, $id, 'design');

        $cardDesign = CardDesign::updateOrCreate(
            ['id' => $id, 'user_id' => $request->user()->id],
            $data,
        );

        return response()->json($cardDesign);
    }
}
