<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // The public handle a profile URL is built from — distinct from
            // `name`, which stays a free-text display name a user can
            // change to anything (including something another user already
            // uses). Nullable rather than NOT NULL because rows predating
            // this migration exist; every row gets one backfilled below and
            // registration has assigned one since, so treat "no username"
            // as legacy, not as a supported state.
            $table->string('username')->nullable()->unique()->after('name');
            $table->text('bio')->nullable()->after('username');
            // A URL, not an upload: there's no file storage in this backend
            // yet (see the root README's "Not built yet"). Validated as
            // https-only in ProfileController; nothing server-side ever
            // fetches it, the viewer's browser renders it.
            $table->string('avatar_url')->nullable()->after('bio');
            // ok | suspended. The account-level half of the moderation
            // groundwork — see the reports table migration.
            $table->string('moderation_state')->default('ok')->after('avatar_url');
        });

        foreach (DB::table('users')->select('id', 'name')->get() as $user) {
            DB::table('users')->where('id', $user->id)->update([
                'username' => static::backfillUsername($user->name, $user->id),
            ]);
        }
    }

    /** Deterministic and guaranteed-unique: a slug of the display name, suffixed with the row id. */
    private static function backfillUsername(string $name, int $id): string
    {
        $slug = Str::limit(Str::slug($name, '-'), 24, '');

        return ($slug === '' ? 'user' : $slug).'-'.$id;
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['username', 'bio', 'avatar_url', 'moderation_state']);
        });
    }
};
