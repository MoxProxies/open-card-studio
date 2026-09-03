<?php

namespace App\Support;

use Illuminate\Database\QueryException;

/**
 * Is this failure a unique-index collision?
 *
 * Shared by the two things that write exactly-once rows (PointsLedger,
 * Notifier). Both rely on the index rather than a read-then-write check —
 * two concurrent requests would both pass the read — so both need to tell
 * "someone already wrote this" apart from a real database error, and the
 * driver only says so in the message text.
 */
class DuplicateKey
{
    public static function matches(QueryException $e): bool
    {
        return str_contains($e->getMessage(), 'UNIQUE constraint failed')
            || str_contains($e->getMessage(), 'Duplicate entry')
            || $e->getCode() === '23000';
    }

    /**
     * Just the driver's own error text, with the query Laravel appends
     * after it (`(Connection: ..., SQL: ...)`) stripped off. Needed
     * whenever code has to tell *which* column or index a collision hit
     * by checking the message for a column name: the appended SQL names
     * every column in the statement, not just the one that actually
     * violated a constraint, so matching against the full message risks
     * a false positive on any other column that happens to share the
     * INSERT (see AuthController::saveWithUniqueUsername and
     * PostController::upsertPost, both of which register a race against
     * one column while writing others that could equally be named there).
     */
    public static function reason(QueryException $e): string
    {
        return strstr($e->getMessage(), ' (Connection:', true) ?: $e->getMessage();
    }
}
