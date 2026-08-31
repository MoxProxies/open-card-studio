<?php

namespace App\Support;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;

/**
 * The only thing that writes notifications.
 *
 * Two rules, both borrowed from PointsLedger because they turned out to
 * be the same problems:
 *
 *  - **Exactly-once via a dedupe key.** Unliking and re-liking something
 *    must not produce a second notification, and a retried request must
 *    not either. The unique index is the guard rather than a
 *    read-then-write check, which two concurrent requests would both pass.
 *  - **Never tell someone about their own action.** Liking your own
 *    template, commenting on your own guide, remixing your own layout —
 *    all legitimate, none of them news.
 *
 * `data` carries enough to render the row on its own: a notification
 * outlives the thing it points at (a deleted template, a suspended
 * account), and a feed full of rows that can't say what they were about
 * is worse than no feed.
 */
class Notifier
{
    public static function notify(
        ?User $recipient,
        string $type,
        ?User $actor = null,
        ?Model $subject = null,
        array $data = [],
        ?string $dedupeKey = null,
    ): ?Notification {
        // No recipient happens legitimately — content whose owner has
        // since deleted their account.
        if (! $recipient) {
            return null;
        }

        if ($actor && $actor->id === $recipient->id) {
            return null;
        }

        try {
            return Notification::create([
                'user_id' => $recipient->id,
                'type' => $type,
                'actor_id' => $actor?->id,
                'subject_type' => $subject ? $subject::class : null,
                'subject_id' => $subject?->getKey(),
                'data' => $data + array_filter(['actor_name' => $actor?->name]),
                'dedupe_key' => $dedupeKey,
            ]);
        } catch (QueryException $e) {
            if ($dedupeKey && DuplicateKey::matches($e)) {
                return null;
            }

            throw $e;
        }
    }
}
