<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // `notifications_emailed_at` is a whole-second timestamp on a
        // column (`notifications.created_at`) that is not unique: when
        // several notifications land in the same second — several badges
        // awarded by one BadgeRules::evaluate() call, a burst of
        // reactions — and that second falls on the digest's 20-item page
        // boundary, `limit(20)` can include some of the tied rows but not
        // others. The watermark then advances to that shared second, and
        // every future run's `created_at > watermark` excludes the rest
        // of the tie forever, even though they're still unread.
        //
        // The notification's own id has none of that: it's a strict,
        // unique, monotonically increasing order (auto-increment, and
        // insertion order already matches id order here), so a cursor on
        // id can never have two rows tie for the same position.
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('notifications_emailed_id')->nullable()->after('notifications_emailed_at')
                ->constrained('notifications')->nullOnDelete();
        });

        $this->backfillNotificationsEmailedId();

        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('notifications_emailed_at'));
    }

    // Carry existing watermarks forward: for anyone who already has a
    // notifications_emailed_at, the equivalent id-cursor is the id of the
    // newest notification strictly before that second.
    //
    // Deliberately strict `<`, not `<=`: Laravel never recorded which
    // notifications a past digest actually included, only the watermark
    // second itself. If that second is tied across several notifications,
    // some of them may have been sent under the old bug this migration
    // exists to fix, and others may have been the very ones the old bug
    // stranded (see the note above `up()`). Stored data alone can't tell
    // those two groups apart, so `<=` would silently and permanently
    // re-strand the already-lost ones under the new cursor too. `<` leaves
    // every tied notification — sent or stranded — ahead of the new
    // cursor, so the very next digest run picks all of them back up. The
    // only cost is that a tied one that really was already sent may be
    // emailed one extra, redundant time, which is a minor, one-time
    // annoyance rather than permanent data loss.
    //
    // Split out from up() so a test can exercise this exact statement
    // against a seeded notifications_emailed_at without also having to
    // drop and re-add the notifications_emailed_id foreign key column —
    // rebuilding that column on a populated `users` table triggers
    // SQLite's implicit "DROP TABLE performs a DELETE first" behavior,
    // which cascades through notifications.user_id's cascadeOnDelete and
    // wipes every notification, an artifact of the test environment
    // rather than anything about this backfill.
    public function backfillNotificationsEmailedId(): void
    {
        DB::statement(<<<'SQL'
            UPDATE users
            SET notifications_emailed_id = (
                SELECT MAX(notifications.id)
                FROM notifications
                WHERE notifications.user_id = users.id
                AND notifications.created_at < users.notifications_emailed_at
            )
            WHERE users.notifications_emailed_at IS NOT NULL
        SQL);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('notifications_emailed_at')->nullable();
        });

        DB::statement(<<<'SQL'
            UPDATE users
            SET notifications_emailed_at = (
                SELECT notifications.created_at
                FROM notifications
                WHERE notifications.id = users.notifications_emailed_id
            )
            WHERE users.notifications_emailed_id IS NOT NULL
        SQL);

        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('notifications_emailed_id');
        });
    }
};
