<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\NotificationDigest;
use App\Support\Notifier;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use Illuminate\Support\Facades\Schema;
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
        $newestIncluded = $user->notifications()->orderBy('id')->limit(20)->get()->last();
        $this->assertSame(
            $newestIncluded->id,
            $user->fresh()->notifications_emailed_id
        );

        $this->travelTo($base->copy()->addDay());
        $this->artisan('notifications:digest');

        // The 5 leftover notifications — newer than the watermark, so
        // still ahead of it — are picked up on the next run rather than
        // silently dropped.
        NotificationFacade::assertSentToTimes($user, NotificationDigest::class, 2);
    }

    public function test_tied_created_at_at_the_boundary_are_never_dropped(): void
    {
        NotificationFacade::fake();
        $user = $this->account('tied@example.com');

        // 15 notifications a minute apart, then 10 more that all land in
        // the exact same second — created_at only has whole-second
        // precision, and this is realistic: several badges from one
        // BadgeRules::evaluate() call, or a burst of reactions, can all
        // be notified within the same request. Ordered by id (insertion
        // order), the tied group is n15..n24 — ids 16..25 — which
        // straddles the 20-item cap: n15..n19 (ids 16..20) land in the
        // first digest, n20..n24 (ids 21..25) are leftovers for the
        // next one. A watermark on created_at alone would advance to the
        // shared second and then exclude every leftover with that exact
        // timestamp forever, even though they're still unread.
        $base = now();
        for ($i = 0; $i < 15; $i++) {
            $this->travelTo($base->copy()->addMinutes($i));
            $this->newsFor($user, "n{$i}");
        }
        $this->travelTo($base->copy()->addMinutes(20));
        for ($i = 15; $i < 25; $i++) {
            $this->newsFor($user, "n{$i}");
        }
        $this->travelTo($base->copy()->addMinutes(30));

        $this->artisan('notifications:digest');
        $this->travelTo($base->copy()->addDay());
        $this->artisan('notifications:digest');
        $this->travelTo($base->copy()->addDays(2));
        $this->artisan('notifications:digest');

        // Two runs to clear the backlog (20 then 5), a third with
        // nothing left to send.
        NotificationFacade::assertSentToTimes($user, NotificationDigest::class, 2);

        // Every one of the 25 notifications — including every tied-second
        // one on either side of the boundary — reached an email exactly
        // once. Reading the digest's private $lines is the only way to
        // see what a run actually included; count() alone can't tell a
        // dropped notification from one that was simply never queued.
        $reachedInbox = NotificationFacade::sent($user, NotificationDigest::class)
            ->flatMap(fn ($notification) => (function () {
                return $this->lines;
            })->call($notification));

        $this->assertCount(25, $reachedInbox);
        $this->assertCount(25, $reachedInbox->unique());
    }

    public function test_the_backfill_never_strands_notifications_tied_with_the_old_watermark(): void
    {
        $user = $this->account('backfilled@example.com');

        // n0 is safely before the watermark second — its old-cursor
        // equivalent is unambiguous. n1 and n2 land in the exact same
        // second as the pre-existing notifications_emailed_at: under the
        // old bug this migration exists to fix, one of a tied pair could
        // have been actually sent while the other was stranded by the
        // digest's batch cap, and stored data alone can't tell which is
        // which.
        $this->newsFor($user, 'n0');
        $before = $user->notifications()->sole();

        $tiedAt = now()->addMinute();
        $this->travelTo($tiedAt);
        $this->newsFor($user, 'n1');
        $this->newsFor($user, 'n2');

        // Seed a pre-existing notifications_emailed_at sitting exactly on
        // the tie boundary, as a pre-migration production row would have
        // had, then run the migration's actual backfill statement against
        // it — exercising the same SQL this migration ran during the
        // app's real migration history, not just the fresh-null-cursor
        // path the digest command tests above cover.
        //
        // This adds notifications_emailed_at back as an extra column
        // rather than rolling the whole migration back and forward again:
        // rebuilding the notifications_emailed_id foreign key column on a
        // populated `users` table inside this test's wrapping transaction
        // triggers SQLite's implicit "DROP TABLE deletes its rows first"
        // behavior, cascading through notifications.user_id's
        // cascadeOnDelete and silently wiping every notification — a
        // quirk of the test environment, not of the migration itself.
        Schema::table('users', fn (Blueprint $table) => $table->timestamp('notifications_emailed_at')->nullable());
        DB::table('users')->where('id', $user->id)->update(['notifications_emailed_at' => $tiedAt]);

        $migration = require base_path('database/migrations/2025_01_01_000017_convert_notifications_emailed_at_to_id_cursor.php');
        $migration->backfillNotificationsEmailedId();

        // Only n0, strictly before the watermark, is safe to mark
        // covered. n1 and n2 must NOT be — advancing the cursor past
        // them would silently and permanently repeat whichever one the
        // old bug had already stranded.
        $this->assertSame($before->id, $user->fresh()->notifications_emailed_id);

        // Both tied notifications are therefore still reachable by the
        // very next digest run.
        NotificationFacade::fake();
        $this->travelTo($tiedAt->copy()->addDay());
        $this->artisan('notifications:digest');

        NotificationFacade::assertSentTo($user, NotificationDigest::class);
        $reachedInbox = NotificationFacade::sent($user, NotificationDigest::class)
            ->flatMap(fn ($notification) => (function () {
                return $this->lines;
            })->call($notification));

        // Both tied notifications (n1, distinguishable here only by its
        // distinct random actor) reached this digest — n1 possibly as a
        // redundant re-send if it was genuinely already mailed under the
        // old bug, a minor, one-time annoyance the migration deliberately
        // accepts instead of permanently losing n2, which the old bug may
        // have stranded.
        $this->assertCount(2, $reachedInbox);
        $this->assertCount(2, $reachedInbox->unique());
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
