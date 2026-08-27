<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CardDesign;
use Illuminate\Http\Request;

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
class CardDesignController extends Controller
{
    public function index(Request $request)
    {
        return $request->user()->cardDesigns()->latest('updated_at')->get(['id', 'name', 'updated_at']);
    }

    public function show(Request $request, string $id)
    {
        $cardDesign = $request->user()->cardDesigns()->findOrFail($id);

        return $cardDesign;
    }

    public function upsert(Request $request, string $id)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'design' => ['required', 'array'],
            'visibility' => ['sometimes', 'string', 'in:private,unlisted,public'],
        ]);

        CardDesign::abortIfOwnedByAnotherUser($request, $id, 'design');

        $cardDesign = CardDesign::updateOrCreate(
            ['id' => $id, 'user_id' => $request->user()->id],
            $data,
        );

        return response()->json($cardDesign);
    }

    public function destroy(Request $request, string $id)
    {
        $request->user()->cardDesigns()->where('id', $id)->delete();

        return response()->noContent();
    }
}
