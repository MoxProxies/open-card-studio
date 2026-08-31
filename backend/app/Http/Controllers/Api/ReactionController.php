<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Reaction;
use App\Support\BadgeRules;
use App\Support\DuplicateKey;
use App\Support\Notifier;
use App\Support\PointsLedger;
use App\Support\Reactable;
use Illuminate\Database\QueryException;
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

            return response()->json([
                'reacted' => false,
                'reaction_count' => $content->reactions()->count(),
            ]);
        }

        try {
            $content->reactions()->create(['user_id' => $request->user()->id, 'type' => Reaction::LIKE]);
        } catch (QueryException $e) {
            // The read above and this create aren't atomic, so a
            // double-tap (or a retried request) can send two of these in
            // before either row lands — both pass the read as "no
            // existing reaction". The unique (reactable, user) index is
            // the real guard; losing that race just means we're already
            // reacted, which this endpoint promises is a harmless no-op,
            // not a 500 — and the request that won the race already ran
            // the effects below, so this one skips them rather than
            // double-firing.
            if (! DuplicateKey::matches($e)) {
                throw $e;
            }

            return response()->json([
                'reacted' => true,
                'reaction_count' => $content->reactions()->count(),
            ]);
        }

        PointsLedger::awardForReaction($content, $request->user());

        // Deduped on (content, reactor) exactly like the point award
        // above: unliking and re-liking is not a second piece of news.
        Notifier::notify(
            $content->user,
            'reaction',
            $request->user(),
            $content,
            ['title' => $content->name ?? $content->title ?? null],
            "reaction:{$data['type']}:{$data['id']}:{$request->user()->id}",
        );

        if ($content->user) {
            BadgeRules::evaluate($content->user);
        }

        return response()->json([
            'reacted' => true,
            'reaction_count' => $content->reactions()->count(),
        ]);
    }
}
