<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * "One open appeal at a time" (AppealController::store()'s doc
     * comment) has never actually been backed by a database constraint —
     * the check-then-create in store() is a read-then-write race exactly
     * like the ones DuplicateKey/PointsLedger/Notifier guard elsewhere,
     * except there was no unique index behind it to lose that race
     * against at all. This adds one.
     *
     * sqlite and pgsql support a partial/conditional unique index
     * directly. MySQL doesn't allow a WHERE clause on an index, so it
     * gets a generated column instead: NULL except when state is 'open',
     * in which case it holds the user_id — and every one of these
     * databases treats two NULLs as distinct, never as a duplicate, so a
     * plain unique index on that column enforces "at most one open
     * appeal per user" the same way a partial index would.
     */
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE appeals ADD COLUMN open_user_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN state = 'open' THEN user_id END) STORED");
            DB::statement('CREATE UNIQUE INDEX appeals_one_open_per_user ON appeals (open_user_id)');
        } else {
            DB::statement("CREATE UNIQUE INDEX appeals_one_open_per_user ON appeals (user_id) WHERE state = 'open'");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            Schema::table('appeals', function ($table) {
                $table->dropIndex('appeals_one_open_per_user');
                $table->dropColumn('open_user_id');
            });
        } else {
            DB::statement('DROP INDEX appeals_one_open_per_user');
        }
    }
};
