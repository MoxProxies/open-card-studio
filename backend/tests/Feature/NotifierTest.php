<?php

namespace Tests\Feature;

use App\Models\Notification;
use App\Models\Template;
use App\Models\User;
use App\Support\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The two rules every caller depends on, tested here rather than through
 * one of the six places that notify — a rule proven once is a rule, and
 * proving it six times over HTTP is six chances to prove something else
 * by accident.
 */
class NotifierTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email): User
    {
        return User::create([
            'name' => str($email)->before('@')->headline()->toString(),
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
    }

    public function test_it_never_tells_someone_about_their_own_action(): void
    {
        $user = $this->account('self@example.com');

        $this->assertNull(Notifier::notify($user, 'reaction', $user));
        $this->assertDatabaseCount('notifications', 0);
    }

    public function test_a_dedupe_key_makes_it_exactly_once(): void
    {
        $owner = $this->account('owner@example.com');
        $actor = $this->account('actor@example.com');

        $first = Notifier::notify($owner, 'reaction', $actor, null, [], 'reaction:t1:2');
        $second = Notifier::notify($owner, 'reaction', $actor, null, [], 'reaction:t1:2');

        $this->assertNotNull($first);
        // The second is a no-op, not an error: un-liking and re-liking is
        // a thing people do, and it isn't a second piece of news.
        $this->assertNull($second);
        $this->assertDatabaseCount('notifications', 1);
    }

    public function test_without_a_dedupe_key_repeats_are_kept(): void
    {
        $owner = $this->account('owner2@example.com');
        $actor = $this->account('actor2@example.com');

        Notifier::notify($owner, 'comment', $actor);
        Notifier::notify($owner, 'comment', $actor);

        // Two comments really are two things to hear about.
        $this->assertDatabaseCount('notifications', 2);
    }

    public function test_a_missing_recipient_is_not_an_error(): void
    {
        // Content whose owner has since deleted their account.
        $this->assertNull(Notifier::notify(null, 'reaction', $this->account('actor3@example.com')));
    }

    public function test_it_survives_the_thing_it_was_about_being_deleted(): void
    {
        $owner = $this->account('owner4@example.com');
        $actor = $this->account('actor4@example.com');
        $template = Template::create([
            'id' => (string) Str::uuid(),
            'user_id' => $owner->id,
            'name' => 'Gone soon',
            'visibility' => 'published',
            'tags' => [],
            'design' => ['schemaVersion' => 1],
        ]);

        Notifier::notify($owner, 'reaction', $actor, $template, ['title' => $template->name]);
        $template->delete();

        // By type, not firstOrFail(): publishing a template earns a badge,
        // which is itself a notification and happens to be written first.
        $notification = Notification::where('type', 'reaction')->firstOrFail();
        $this->assertSame('Gone soon', $notification->data['title']);
        $this->assertNull($notification->subject);
    }

    public function test_the_actors_name_outlives_the_actor(): void
    {
        $owner = $this->account('owner5@example.com');
        $actor = $this->account('actor5@example.com');

        Notifier::notify($owner, 'reaction', $actor, null, []);
        $actor->delete();

        $notification = Notification::where('type', 'reaction')->firstOrFail();
        // actor_id nulls out with the account; the copied name is what
        // keeps the row readable.
        $this->assertNull($notification->fresh()->actor_id);
        $this->assertSame('Actor5', $notification->data['actor_name']);
    }
}
