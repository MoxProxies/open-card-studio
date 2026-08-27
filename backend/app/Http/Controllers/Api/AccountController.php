<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ModerationAction;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Data rights: take everything with you, or close the account.
 *
 * docs/PRODUCT_VISION.md asks for these as hooks a Terms of Service can
 * plug into later — the legal text is a human's job, but "there is a
 * working export and a working delete" is an engineering one, and
 * retrofitting either onto a live community is much harder than building
 * it now.
 */
class AccountController extends Controller
{
    /**
     * Everything this account owns, as one JSON document.
     *
     * Deliberately the raw rows rather than the trimmed shapes the API
     * serves elsewhere: an export that quietly drops columns isn't an
     * export. It's the account's own data, so there's nothing here to
     * hide from it — but equally nothing about anyone else, which is why
     * reactions are listed as "what you reacted to" and not as who else
     * did.
     */
    public function export(Request $request)
    {
        $user = $request->user();

        $payload = [
            'exported_at' => now()->toIso8601String(),
            'account' => $user->makeVisible('email')->toArray(),
            'designs' => $user->cardDesigns()->get(),
            'templates' => $user->templates()->get(),
            'collections' => $user->collections()->with('cardDesigns:id')->get()->map(fn ($collection) => $collection->toArray() + [
                'design_ids' => $collection->cardDesigns->pluck('id'),
            ]),
            'posts' => $user->posts()->get(),
            // The rows, not the bytes: an export is JSON, and the images
            // are already downloadable one URL at a time.
            'uploads' => $user->uploads()->get(),
            'comments' => $user->comments()->get(),
            'reactions' => $user->reactions()->get(['reactable_type', 'reactable_id', 'created_at']),
            'point_events' => $user->pointEvents()->get(),
            'badges' => $user->badges()->get(),
            'reports_you_filed' => $user->reports()->get(),
            'appeals' => $user->appeals()->get(),
            // Decisions taken *about* this account. The moderator's
            // identity isn't part of it — what was done and why is the
            // account's business; who did it is staff's.
            'moderation_actions_about_you' => ModerationAction::where('target_type', User::class)
                ->where('target_id', (string) $user->id)
                ->get(['action', 'reason', 'created_at']),
        ];

        return response()->json($payload)
            ->header('Content-Disposition', 'attachment; filename="open-card-studio-export.json"');
    }

    /**
     * Close the account for good.
     *
     * Re-authentication is required — a delete button that works from an
     * unattended logged-in browser is a way to lose someone's work, not a
     * feature. A social-only account has no password to re-enter, so it
     * confirms by typing its own username instead: the point is proving
     * intent, not proving identity a second time.
     *
     * Everything owned goes with it (database cascades): designs,
     * templates, collections, posts, comments, reactions, points, badges,
     * appeals. That means a published template disappears for everyone —
     * but "new design from template" copies the layers at the time it's
     * used, so designs already made from it keep working. Anonymising
     * instead of deleting is a product decision nobody has made.
     */
    public function destroy(Request $request)
    {
        $user = $request->user();

        // A staff account's rows in moderation_actions cascade with it,
        // which would tear holes in the audit trail. Deleting one is a
        // deliberate act for a founder at the console, not a button.
        abort_if($user->is_staff, 422, 'Staff accounts cannot be deleted through this endpoint.');

        if ($user->hasPassword()) {
            $data = $request->validate(['password' => ['required', 'string']]);

            if (! Hash::check($data['password'], $user->password)) {
                throw ValidationException::withMessages(['password' => ['That password is incorrect.']]);
            }
        } else {
            $data = $request->validate(['confirm_username' => ['required', 'string']]);

            if ($data['confirm_username'] !== $user->username) {
                throw ValidationException::withMessages(['confirm_username' => ['Type your username exactly to confirm.']]);
            }
        }

        $user->tokens()->delete();

        // One at a time through the model, because the file on disk goes
        // with the row (see Upload::delete) — a cascading foreign key
        // deletes rows and leaves the bytes behind forever.
        $user->uploads()->get()->each->delete();

        $user->delete();

        return response()->json(['message' => 'Your account and everything in it has been deleted.']);
    }
}
