<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('card_designs', function (Blueprint $table) {
            // card_designs shipped with `visibility` but no moderation
            // column, from before a design could appear on a public
            // profile. Now that it can, it needs the same takedown target
            // every other public content type has — see the templates
            // migration for why this exists from the start rather than
            // being retrofitted after something is already public.
            $table->string('moderation_state')->default('ok');
            $table->index(['visibility', 'moderation_state']);
        });

        // card_designs called the public state "public" and templates call
        // it "published". One vocabulary now (App\Models\Concerns\Publishable),
        // so the older rows move over.
        DB::table('card_designs')->where('visibility', 'public')->update(['visibility' => 'published']);
    }

    public function down(): void
    {
        DB::table('card_designs')->where('visibility', 'published')->update(['visibility' => 'public']);

        Schema::table('card_designs', function (Blueprint $table) {
            $table->dropIndex(['visibility', 'moderation_state']);
            $table->dropColumn('moderation_state');
        });
    }
};
