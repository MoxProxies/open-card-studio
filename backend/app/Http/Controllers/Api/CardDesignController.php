<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CardDesign;
use Illuminate\Http\Request;

/**
 * Plain CRUD over a shopper's own designs — every action here scopes to
 * $request->user(), never a raw CardDesign::find(), so one user can never
 * read or overwrite another's row by guessing an id. `design` is stored
 * and returned completely opaque (see the migration's doc comment) — this
 * controller never inspects its internal shape.
 */
class CardDesignController extends Controller
{
    public function index(Request $request)
    {
        return $request->user()->cardDesigns()->latest()->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'design' => ['required', 'array'],
            'visibility' => ['sometimes', 'string', 'in:private,unlisted,public'],
        ]);

        $cardDesign = $request->user()->cardDesigns()->create($data);

        return response()->json($cardDesign, 201);
    }

    public function show(Request $request, CardDesign $cardDesign)
    {
        abort_unless($cardDesign->user_id === $request->user()->id, 403);

        return $cardDesign;
    }

    public function update(Request $request, CardDesign $cardDesign)
    {
        abort_unless($cardDesign->user_id === $request->user()->id, 403);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'design' => ['sometimes', 'array'],
            'visibility' => ['sometimes', 'string', 'in:private,unlisted,public'],
        ]);

        $cardDesign->update($data);

        return $cardDesign;
    }

    public function destroy(Request $request, CardDesign $cardDesign)
    {
        abort_unless($cardDesign->user_id === $request->user()->id, 403);

        $cardDesign->delete();

        return response()->noContent();
    }
}
