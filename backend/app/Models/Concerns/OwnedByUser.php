<?php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

/**
 * Shared behaviour for the app's user-owned, client-UUID-keyed, upserted-
 * by-id tables (card_designs, templates). Both follow the same shape: the
 * frontend mints the id, so PUT is the only write verb, and every read or
 * write is scoped to the requesting user.
 */
trait OwnedByUser
{
    /** Primary key is a client-supplied UUID, not an auto-increment int.
     * Overriding the getters rather than redeclaring $incrementing/$keyType:
     * a trait can't redeclare a property the parent class already defines
     * with a different default (fatal error). Same approach Laravel's own
     * HasUuids takes. */
    public function getIncrementing(): bool
    {
        return false;
    }

    public function getKeyType(): string
    {
        return 'string';
    }

    /**
     * Rejects a PUT whose id already belongs to somebody else with a clean
     * 409 instead of the duplicate-key 500 that updateOrCreate would
     * otherwise produce: its (id, user_id) WHERE wouldn't match that row,
     * so it would try to INSERT a second one with the same primary key.
     * Vanishingly unlikely with a real UUID, but trivial to send on purpose.
     */
    public static function abortIfOwnedByAnotherUser(Request $request, string $id, string $label): ?Model
    {
        $existing = static::find($id);

        abort_if($existing && $existing->user_id !== $request->user()->id, 409, "That {$label} id belongs to another account.");

        return $existing;
    }
}
