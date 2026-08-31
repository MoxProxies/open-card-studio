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
}
