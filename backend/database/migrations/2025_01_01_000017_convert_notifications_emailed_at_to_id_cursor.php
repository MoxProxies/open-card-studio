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

        // Carry existing watermarks forward: for anyone who already has a
        // notifications_emailed_at, the equivalent id-cursor is the id of
        // the newest notification at or before that second — the same
        // notification the old watermark was already pointing past.
        DB::statement(<<<'SQL'
            UPDATE users
            SET notifications_emailed_id = (
                SELECT MAX(notifications.id)
                FROM notifications
                WHERE notifications.user_id = users.id
                AND notifications.created_at <= users.notifications_emailed_at
            )
            WHERE users.notifications_emailed_at IS NOT NULL
        SQL);

        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('notifications_emailed_at'));
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
