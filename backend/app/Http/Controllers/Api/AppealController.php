<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appeal;
use App\Models\User;
use App\Support\DuplicateKey;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;

/**
 * The suspended account's side of an appeal.
 *
 * These two routes sit *outside* BlockSuspendedUsers, which is the whole
 * point: every other authenticated endpoint 403s for a suspended user, so
 * an appeal route inside that group could only ever be used by people who
 * don't need it. A suspension that hides both the reason and the way to
 * contest it is a black box, and this is the smallest thing that isn't
 * one.
 *
 * Staff read and resolve these in ModerationController, alongside reports.
 */
class AppealController extends Controller
{
    /** The account's most recent appeal, or null. One at a time is the
     * whole model — see store(). */
    public function show(Request $request)
    {
        return response()->json([
            'suspended' => $request->user()->moderation_state === User::SUSPENDED,
            // latest('id'), not latest(): created_at has second
            // precision, so two appeals filed in the same second tie and
            // "the most recent one" becomes whichever the database feels
            // like returning. The id is monotonic and can't tie.
            'appeal' => $request->user()->appeals()->latest('id')->first(),
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'message' => ['required', 'string', 'min:20', 'max:4000'],
        ]);

        $user = $request->user();

        // Only a suspended account has anything to appeal. Anyone else
        // asking is either confused or probing, and either way there's no
        // decision for a moderator to make.
        abort_if($user->moderation_state !== User::SUSPENDED, 422, 'There is nothing to appeal — this account is in good standing.');

        // One open appeal at a time: a queue where one person can file
        // fifty is a queue nobody reads. Re-appealing after a denial is
        // allowed — circumstances change — which is why this checks for an
        // *open* one rather than for any at all.
        abort_if(
            $user->appeals()->where('state', Appeal::OPEN)->exists(),
            422,
            'Your appeal is already with us. You will hear back on this account.',
        );

        try {
            $appeal = Appeal::create(['user_id' => $user->id, 'message' => $data['message']]);
        } catch (QueryException $e) {
            // The exists() check above and this create() aren't atomic,
            // so filing from two tabs at once (or a retried request) can
            // send two of these in before either row lands — both pass
            // the read as "no open appeal yet". The partial unique index
            // (see its migration) is the real guard; losing that race
            // means an open appeal already exists, exactly what the check
            // above would have reported had it run a moment later.
            if (! DuplicateKey::matches($e)) {
                throw $e;
            }

            abort(422, 'Your appeal is already with us. You will hear back on this account.');
        }

        // refresh() so `state` is in the response: it's a database
        // default, and a just-created model doesn't carry one. Without
        // this the client reads state as undefined and renders a
        // brand-new appeal as already decided. Same trap as Template
        // and Report — it's the third time, hence the comment.
        return response()->json($appeal->refresh(), 201);
    }
}
