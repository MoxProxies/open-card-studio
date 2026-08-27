<?php

namespace App\Support;

use App\Models\Badge;
use App\Models\Reaction;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The rule-based half of badges: a map of `badges.rule` value → a check
 * against a user. A badge whose `rule` is null isn't here at all — it can
 * only be granted by hand (see BadgeController::grant).
 *
 * Rules are re-evaluated after anything that could newly satisfy one
 * (a reaction, a publish). They're written to be idempotent and cheap;
 * granting is a syncWithoutDetaching, so re-running never duplicates.
 */
class BadgeRules
{
    /** @return array<string, callable(User): bool> */
    public static function all(): array
    {
        return [
            'first-template' => fn (User $user) => $user->templates()->published()->exists(),
            'first-collection' => fn (User $user) => $user->collections()->published()->exists(),
            'well-liked' => fn (User $user) => static::reactionsReceived($user) >= 25,
            'level-three' => fn (User $user) => Levels::for(PointsLedger::total($user))['level'] >= 3,
        ];
    }

    /**
     * Grants every rule-based badge this user now qualifies for. Returns
     * the ids newly awarded, so a caller can tell them about it.
     *
     * @return string[]
     */
    public static function evaluate(User $user): array
    {
        $rules = static::all();
        $held = $user->badges()->pluck('badges.id')->all();
        $awarded = [];

        foreach (Badge::whereNotNull('rule')->get() as $badge) {
            if (in_array($badge->id, $held, true)) {
                continue;
            }

            $rule = $rules[$badge->rule] ?? null;

            // A badge row naming a rule this class doesn't implement is
            // skipped rather than fatal — a badge can be seeded ahead of
            // the code that grants it.
            if ($rule && $rule($user)) {
                $user->badges()->syncWithoutDetaching([$badge->id => []]);
                $awarded[] = $badge->id;
            }
        }

        return $awarded;
    }

    /** How many reactions this user's content has received, across every type. */
    public static function reactionsReceived(User $user): int
    {
        $counts = 0;

        foreach (User::REACTABLE_OWNED as $relation => $model) {
            $ids = $user->{$relation}()->pluck('id');

            $counts += $ids->isEmpty() ? 0 : Reaction::where('reactable_type', $model)->whereIn('reactable_id', $ids)->count();
        }

        return $counts;
    }
}
