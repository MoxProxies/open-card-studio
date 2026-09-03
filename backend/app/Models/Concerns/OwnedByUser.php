<?php

namespace App\Models\Concerns;

use App\Support\DuplicateKey;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
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

    /**
     * updateOrCreate() against (id, user_id), guarded against the exact
     * race abortIfOwnedByAnotherUser()'s doc comment describes: that
     * check and this write aren't atomic, so two truly-simultaneous PUTs
     * carrying the same client-generated id (a double-submit, a request
     * retried before the first one's response lands) can both pass the
     * check and then both try to INSERT the same primary key.
     *
     * The database is what actually knows which one landed first, so the
     * one that loses the race retries as the UPDATE it should have been
     * all along — the winner's row is what's actually there now — rather
     * than surfacing the collision as a raw 500. If the row that landed
     * belongs to someone else (the same id chosen twice, independently,
     * by two different accounts — astronomically unlikely with a real
     * UUID but not impossible), this reports it the same clean 409
     * abortIfOwnedByAnotherUser() would have given had it run a moment
     * later.
     */
    public static function updateOrCreateOwned(Request $request, string $id, array $data, string $label): static
    {
        try {
            return static::updateOrCreate(['id' => $id, 'user_id' => $request->user()->id], $data);
        } catch (QueryException $e) {
            if (! DuplicateKey::matches($e)) {
                throw $e;
            }

            $existing = static::find($id);

            abort_if(! $existing || $existing->user_id !== $request->user()->id, 409, "That {$label} id belongs to another account.");

            $existing->update($data);

            return $existing;
        }
    }
}
