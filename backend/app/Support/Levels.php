<?php

namespace App\Support;

/**
 * Level as a pure function of cumulative points, read from
 * config('gamification.levels') — a thresholds table, not hardcoded math,
 * so "you need 100 points for level 3" stays something a person can be
 * told and a founder can retune without a deploy of new logic.
 */
class Levels
{
    /** The level entry a point total earns: the highest threshold it clears. */
    public static function for(int $points): array
    {
        $earned = config('gamification.levels')[0];

        foreach (config('gamification.levels') as $level) {
            if ($points >= $level['points']) {
                $earned = $level;
            }
        }

        return $earned;
    }

    /** The next level up, or null at the top of the table. */
    public static function next(int $points): ?array
    {
        foreach (config('gamification.levels') as $level) {
            if ($points < $level['points']) {
                return $level;
            }
        }

        return null;
    }

    /** Everything a profile needs to render "level 3, 40 points to go". */
    public static function progress(int $points): array
    {
        $current = self::for($points);
        $next = self::next($points);

        return [
            'points' => $points,
            'level' => $current['level'],
            'level_name' => $current['name'],
            'next_level_at' => $next['points'] ?? null,
            'points_to_next' => $next ? $next['points'] - $points : null,
        ];
    }
}
