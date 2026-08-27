<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\PointsLedger;
use App\Support\Levels;
use App\Support\Reactable;
use Illuminate\Http\Request;

/**
 * Featuring your own work on your profile — the one perk levels currently
 * unlock. Gated two ways, both from config/gamification.php: a minimum
 * level, and a cap on how many things can be featured at once.
 */
class FeatureController extends Controller
{
    public function update(Request $request)
    {
        $data = $request->validate([
            'type' => ['required', 'string', Reactable::rule()],
            'id' => ['required', 'string', 'max:255'],
            'featured' => ['required', 'boolean'],
        ]);

        $model = Reactable::TYPES[$data['type']];
        // Owner-scoped: featuring is something you do to your own work.
        $content = $model::where('user_id', $request->user()->id)->visibleToPublic()->find($data['id']);
        abort_if(! $content, 404);

        $progress = Levels::progress(PointsLedger::total($request->user()));
        $minimum = config('gamification.feature_min_level');

        abort_if(
            $data['featured'] && $progress['level'] < $minimum,
            403,
            "Featuring unlocks at level {$minimum} — you're level {$progress['level']}.",
        );

        $limit = config('gamification.feature_limit');

        abort_if(
            $data['featured'] && ! $content->featured_at && $this->featuredCount($request) >= $limit,
            422,
            "You can feature up to {$limit} things at once. Un-feature something first.",
        );

        // Assigned directly, not mass-assigned: `featured_at` is
        // deliberately absent from every model's $fillable so a content
        // upsert can't set it — featuring goes through this level gate or
        // it doesn't happen. (Mass-assigning it here silently did nothing,
        // which is exactly what $fillable is supposed to do.)
        $content->featured_at = $data['featured'] ? now() : null;
        $content->save();

        return response()->json(['id' => $content->getKey(), 'featured' => $content->featured_at !== null]);
    }

    /** Across every featurable type, not just the one being toggled — the
     * limit is on a profile's featured shelf as a whole. */
    private function featuredCount(Request $request): int
    {
        $total = 0;

        foreach (Reactable::TYPES as $model) {
            $total += $model::where('user_id', $request->user()->id)->featured()->count();
        }

        return $total;
    }
}
