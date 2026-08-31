<?php

namespace App\Support;

use App\Models\PointEvent;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;

/**
 * The only thing that writes point_events. Append-only: there is no
 * update and no delete here, and a correction would be a further row with
 * a negative amount.
 *
 * **Awards are exactly-once, and are never taken back.** Every award
 * carries a dedupe_key, so unliking and re-liking a template can't farm
 * points and a retried request can't double-award — and unliking
 * deliberately doesn't subtract. That's a real decision, not an
 * oversight: reversing would mean anyone who reacted to your work could
 * later drain the points it earned you, and "your total can go down
 * because a stranger changed their mind" is a worse property than "an
 * early like still counts". Moderation *can* reverse, by appending a
 * negative row — the column is signed for exactly that.
 */
class PointsLedger
{
    /**
     * Appends an award, or does nothing if `$dedupeKey` already landed one.
     * Returns the row it wrote, or null when it was a no-op.
     */
    public static function award(User $user, string $reason, ?Model $source = null, ?string $dedupeKey = null): ?PointEvent
    {
        $amount = config("gamification.points.{$reason}");

        // An unknown reason is a bug in the caller, not a zero-point event
        // to record silently.
        if ($amount === null) {
            throw new \InvalidArgumentException("No configured point value for reason [{$reason}].");
        }

        try {
            return PointEvent::create([
                'user_id' => $user->id,
                'amount' => $amount,
                'reason' => $reason,
                'source_type' => $source ? $source::class : null,
                'source_id' => $source?->getKey(),
                'dedupe_key' => $dedupeKey,
            ]);
        } catch (QueryException $e) {
            // The unique index on dedupe_key is the guard, not a
            // read-then-write check: two concurrent requests would both
            // pass the read. Losing the race means the award already
            // exists, which is the desired end state either way.
            if ($dedupeKey && DuplicateKey::matches($e)) {
                return null;
            }

            throw $e;
        }
    }

    /**
     * Awards the owner of some content for a reaction to it. Reacting to
     * your own work is worth nothing — otherwise the cheapest way to level
     * up would be to like everything you own.
     */
    public static function awardForReaction(Model $content, User $reactor): ?PointEvent
    {
        $owner = $content->user;

        if (! $owner || $owner->id === $reactor->id) {
            return null;
        }

        return static::award(
            $owner,
            'reaction_received',
            $content,
            "reaction:{$content->getMorphClass()}:{$content->getKey()}:{$reactor->id}",
        );
    }

    /**
     * Cancels out everything a piece of content earned, by appending the
     * negative of each award that names it as its source. The reversal
     * this class's doc comment says moderation can do — used when content
     * is taken down, so a removed template stops paying its author.
     *
     * Deduped like any other award: taking the same thing down twice
     * doesn't double-subtract, and restoring then re-removing doesn't
     * either.
     */
    public static function reverseFor(Model $source): void
    {
        $awards = PointEvent::where('source_type', $source::class)
            ->where('source_id', $source->getKey())
            ->where('amount', '>', 0)
            ->get();

        foreach ($awards as $award) {
            PointEvent::firstOrCreate(
                ['dedupe_key' => "reversal:{$award->id}"],
                [
                    'user_id' => $award->user_id,
                    'amount' => -$award->amount,
                    'reason' => $award->reason,
                    'source_type' => $award->source_type,
                    'source_id' => $award->source_id,
                ],
            );
        }
    }

    public static function total(User $user): int
    {
        return (int) $user->pointEvents()->sum('amount');
    }
}
