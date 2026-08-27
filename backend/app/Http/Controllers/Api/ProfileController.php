<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Public profiles, and the endpoint an account edits its own with.
 *
 * A profile is the first genuinely public, user-authored surface in this
 * app, so two rules hold throughout: `email` never appears in one (see
 * User::$hidden / toPublicProfile), and every listing here goes through
 * the shared `published` scope (Concerns\Publishable), so a private or
 * moderator-removed design can't surface on a profile page.
 */
class ProfileController extends Controller
{
    /** Shared by register and update so a handle means the same thing either way. */
    public const USERNAME_RULES = ['min:3', 'max:30', 'regex:/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/'];

    /** Handles the app itself needs, or that would be misleading on a community profile. */
    public const RESERVED_USERNAMES = ['admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'official', 'api', 'me', 'root', 'system', 'open-card-studio'];

    /** How many of each kind of content a profile lists. */
    private const LISTING_LIMIT = 50;

    /**
     * A public profile plus everything that account has published. No auth:
     * this is the page a shared template link is meant to lead to.
     */
    public function show(string $username)
    {
        $user = User::publiclyVisible()->where('username', $username)->firstOrFail();

        return response()->json([
            'profile' => $user->toPublicProfile(),
            'templates' => $user->templates()->published()->latest('updated_at')->limit(self::LISTING_LIMIT)->get()
                ->map(fn ($template) => $template->setRelation('user', $user)->toSummary()),
            'designs' => $user->cardDesigns()->published()->latest('updated_at')->limit(self::LISTING_LIMIT)->get()
                ->map->toSummary(),
        ]);
    }

    /** Edit your own profile. Everything is optional — this is a PATCH. */
    public function update(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'username' => [
                'sometimes',
                'string',
                ...self::USERNAME_RULES,
                Rule::unique('users', 'username')->ignore($user->id),
                Rule::notIn(self::RESERVED_USERNAMES),
            ],
            'bio' => ['sometimes', 'nullable', 'string', 'max:1000'],
            // https only, and only ever rendered by the viewer's browser —
            // nothing server-side fetches it. A real upload path needs file
            // storage this backend doesn't have yet.
            'avatar_url' => ['sometimes', 'nullable', 'string', 'max:2048', 'url', 'starts_with:https://'],
        ], [
            'username.regex' => 'A username can use lowercase letters, numbers, dashes and underscores, and must start and end with a letter or number.',
        ]);

        $user->update($data);

        return response()->json($user->makeVisible('email'));
    }
}
