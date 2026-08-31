<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\NotificationDigest;
use App\Support\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use Tests\TestCase;

/**
 * Who gets a digest and who doesn't. All four rules matter for the same
 * reason: each one, broken, is a way to lose a reader's trust in the mail
 * rather than merely their attention.
 */
class NotificationDigestTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email, bool $verified = true): User
    {
        $user = User::create([
            'name' => str($email)->before('@')->headline()->toString(),
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);

        if ($verified) {
            $user->email_verified_at = now();
            $user->save();
        }

        return $user;
    }

    private function newsFor(User $recipient, ?string $key = null): void
    {
        Notifier::notify($recipient, 'reaction', $this->account('actor'.uniqid().'@example.com'), null, ['title' => 'Woodgrain'], $key);
    }

    public function test_it_emails_someone_with_unread_news(): void
    {
        NotificationFacade::fake();
        $user = $this->account('reader@example.com');
        $this->newsFor($user);

        $this->artisan('notifications:digest')->assertSuccessful();

        NotificationFacade::assertSentTo($user, NotificationDigest::class);
    }

    public function test_it_does_not_send_the_same_news_twice(): void
    {
        NotificationFacade::fake();
        $user = $this->account('twice@example.com');
        $this->newsFor($user);

        $this->artisan('notifications:digest');
        $this->artisan('notifications:digest');

        // The watermark is the whole point: a digest that repeats itself
        // gets filed as spam by the reader, correctly.
        NotificationFacade::assertSentToTimes($user, NotificationDigest::class, 1);
    }

    public function test_news_arriving_after_a_digest_is_sent_next_time(): void
    {
        NotificationFacade::fake();
        $user = $this->account('again@example.com');
        $this->newsFor($user, 'first');

        $this->artisan('notifications:digest');
        $this->travel(1)->day();
        $this->newsFor($user, 'second');
        $this->artisan('notifications:digest');

        NotificationFacade::assertSentToTimes($user, NotificationDigest::class, 2);
    }

    public function test_more_than_twenty_unread_are_not_lost_to_the_watermark(): void
    {
        NotificationFacade::fake();
        $user = $this->account('overflowed@example.com');

        // 25 unread notifications, a minute apart so each has a distinct
        // created_at and `oldest()->limit(20)` keeps a predictable
        // oldest-20 (leaving the 5 *newest* as this run's leftovers).
        // Absolute timestamps rather than repeated relative travel()
        // calls, which compound against each other.
        $base = now();
        for ($i = 0; $i < 25; $i++) {
            $this->travelTo($base->copy()->addMinutes($i));
            $this->newsFor($user, "n{$i}");
        }
        $this->travelTo($base->copy()->addMinutes(30)); // run the digest after all 25 exist

        $this->artisan('notifications:digest');

        // The watermark must land on the newest notification actually
        // *sent* (the 20th-oldest), not on `now()` — otherwise the 5
        // leftover (newest, beyond the 20-item cap) would need to be
        // newer than `now()` to ever qualify, which is impossible, so
        // they'd be excluded from every future digest despite still
        // being unread.
        $newestIncluded = $user->notifications()->oldest()->limit(20)->get()->last();
        $this->assertSame(
            $newestIncluded->created_at->toDateTimeString(),
            $user->fresh()->notifications_emailed_at->toDateTimeString()
        );

        $this->travelTo($base->copy()->addDay());
        $this->artisan('notifications:digest');

        // The 5 leftover notifications — newer than the watermark, so
        // still ahead of it — are picked up on the next run rather than
        // silently dropped.
        NotificationFacade::assertSentToTimes($user, NotificationDigest::class, 2);
    }

    public function test_it_skips_news_already_read_in_the_app(): void
    {
        NotificationFacade::fake();
        $user = $this->account('read@example.com');
        $this->newsFor($user);
        $user->notifications()->update(['read_at' => now()]);

        $this->artisan('notifications:digest');

        NotificationFacade::assertNothingSent();
    }

    public function test_it_skips_an_unconfirmed_address(): void
    {
        NotificationFacade::fake();
        $user = $this->account('unconfirmed@example.com', verified: false);
        $this->newsFor($user);

        $this->artisan('notifications:digest');

        // Mailing addresses nobody proved is how a sending domain earns a
        // bounce rate and stops being delivered at all.
        NotificationFacade::assertNothingSent();
    }

    public function test_it_skips_someone_who_turned_them_off(): void
    {
        NotificationFacade::fake();
        $user = $this->account('quiet@example.com');
        $user->notification_emails = false;
        $user->save();
        $this->newsFor($user);

        $this->artisan('notifications:digest');

        NotificationFacade::assertNothingSent();
    }

    public function test_the_unsubscribe_link_works_without_signing_in(): void
    {
        $user = $this->account('unsub@example.com');

        $this->get(NotificationDigest::unsubscribeUrl($user))->assertOk();

        $this->assertFalse((bool) $user->fresh()->notification_emails);
    }

    public function test_an_unsigned_or_tampered_unsubscribe_link_is_refused(): void
    {
        $user = $this->account('tamper@example.com');
        $signed = NotificationDigest::unsubscribeUrl($user);

        $this->get("/api/notifications/unsubscribe/{$user->id}/".sha1($user->email))->assertForbidden();
        // Same signature, different account: the id is covered by the
        // signature, so this is refused before the hash is even checked.
        $this->get(str_replace("/{$user->id}/", '/999/', $signed))->assertForbidden();

        $this->assertTrue((bool) $user->fresh()->notification_emails);
    }

    public function test_turning_them_back_on_from_the_profile(): void
    {
        $user = $this->account('backon@example.com');
        $user->notification_emails = false;
        $user->save();

        $this->actingAs($user)->patchJson('/api/profile', ['notification_emails' => true])->assertOk();

        $this->assertTrue((bool) $user->fresh()->notification_emails);
        $this->actingAs($user)->getJson('/api/auth/me')->assertJson(['notification_emails' => true]);
    }
}
