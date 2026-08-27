<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * What the user-owned content controllers (card designs, templates —
 * collections next) share: the same relation-scoped listing, the same
 * visibility-only publish action, the same delete. Subclasses supply the
 * relation and their own read/write endpoints; nothing here ever touches
 * a row the requesting user doesn't own.
 */
abstract class OwnedContentController extends Controller
{
    /** e.g. $request->user()->cardDesigns() */
    abstract protected function owned(Request $request): HasMany;

    /** Model class of the owned relation, for its Publishable constants. */
    abstract protected static function model(): string;

    /**
     * Visibility on its own, so flipping something between private and
     * published from a list row doesn't mean re-uploading its whole design
     * blob just to change one string.
     */
    public function publish(Request $request, string $id)
    {
        $data = $request->validate([
            'visibility' => ['required', Rule::in(static::model()::VISIBILITIES)],
        ]);

        $record = $this->owned($request)->visibleToPublic()->findOrFail($id);
        $record->update($data);

        return response()->json($record->toSummary());
    }

    public function destroy(Request $request, string $id)
    {
        $this->owned($request)->where('id', $id)->delete();

        return response()->noContent();
    }
}
