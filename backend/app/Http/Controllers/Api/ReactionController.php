<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Reaction;
use App\Support\Reactable;
use App\Support\BadgeRules;
use App\Support\PointsLedger;
use Illuminate\Http\Request;

/**
 * One endpoint, every content type — see the reactions migration. Posting
 * toggles: react if you haven't, un-react if you have, and the response
 * always describes the resulting state so a client never has to guess.
 *
 * Reacting awards the *owner* points, exactly once ever for a given
 * (content, reactor) pair — un-reacting doesn't take them back. See
 * PointsLedger for why that asymmetry is deliberate.
 */
class ReactionController extends Controller
{
    public function toggle(Request $request)
    {
        $data = $request->validate([
            'type' => ['required', 'string', Reactable::rule()],
            'id' => ['required', 'string', 'max:255'],
        ]);

        $content = Reactable::find($data['type'], $data['id']);

        // Only content the reactor could actually be looking at. A private
        // design isn't likeable by a stranger, and 404 rather than 403 so
        // this can't be used to probe which ids exist.
        abort_if(! $content || (! $content->isPubliclyReadable() && $content->user_id !== $request->user()->id), 404);

        $existing = $content->reactions()->where('user_id', $request->user()->id)->first();

        if ($existing) {
            $existing->delete();
        } else {
            $content->reactions()->create(['user_id' => $request->user()->id, 'type' => Reaction::LIKE]);
            PointsLedger::awardForReaction($content, $request->user());

            if ($content->user) {
                BadgeRules::evaluate($content->user);
            }
        }

        return response()->json([
            'reacted' => ! $existing,
            'reaction_count' => $content->reactions()->count(),
        ]);
    }
}
