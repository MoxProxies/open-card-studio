<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Levels;
use App\Support\PointsLedger;
use App\Support\Reactable;
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
    public function show(Request $request, string $username)
    {
        $user = User::publiclyVisible()->where('username', $username)->firstOrFail();
        $viewer = $request->user('sanctum');

        return response()->json([
            'profile' => $user->toPublicProfile(),
            // Points/level/badges are public: they're the visible part of
            // the point of having them.
            'stats' => Levels::progress(PointsLedger::total($user)) + ['reactions_received' => \App\Support\BadgeRules::reactionsReceived($user)],
            'badges' => $user->badges->map->toArray(),
            'featured' => $this->featured($user, $viewer),
            'templates' => $user->templates()->published()->withCount('reactions')->latest('updated_at')->limit(self::LISTING_LIMIT)->get()
                ->map(fn ($template) => $template->setRelation('user', $user)->toSummary() + $template->reactionState($viewer)),
            'designs' => $user->cardDesigns()->published()->withCount('reactions')->latest('updated_at')->limit(self::LISTING_LIMIT)->get()
                ->map(fn ($design) => $design->toSummary() + $design->reactionState($viewer)),
            // Counting only what a visitor could actually open: an
            // unfiltered count would tell them how many private designs
            // the collection holds.
            'posts' => $user->posts()->published()->withCount(['reactions', 'comments'])
                ->latest('updated_at')->limit(self::LISTING_LIMIT)->get()
                ->map(fn ($post) => $post->setRelation('user', $user)->toSummary() + $post->reactionState($viewer)),
            'collections' => $user->collections()->published()
                ->withCount(['cardDesigns as design_count' => fn ($query) => $query->publiclyReadable()])
                ->withCount('reactions')->latest('updated_at')->limit(self::LISTING_LIMIT)->get()
                ->map(fn ($collection) => $collection->setRelation('user', $user)->toSummary() + $collection->reactionState($viewer)),
        ]);
    }

    /**
     * The owner's featured shelf: published items they've picked out,
     * newest-featured first, across every type. Only published ones — an
     * item featured and then made private shouldn't reappear here.
     *
     * @return array<int, array<string, mixed>>
     */
    private function featured(User $user, ?User $viewer): array
    {
        $items = [];

        foreach (Reactable::TYPES as $type => $model) {
            foreach ($model::where('user_id', $user->id)->published()->featured()->withCount('reactions')->get() as $item) {
                $items[] = ['type' => $type] + $item->toSummary() + $item->reactionState($viewer);
            }
        }

        usort($items, fn ($a, $b) => strcmp((string) $b['updated_at'], (string) $a['updated_at']));

        return $items;
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
