<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One reactions table for every content type — designs, templates,
        // collections today, knowledge-base posts in Phase 5 — rather than
        // a likes table per type. Same polymorphic shape as `reports`,
        // including the string reactable_id (UUID keys on one side,
        // auto-increment ints on the other).
        Schema::create('reactions', function (Blueprint $table) {
            $table->id();
            $table->string('reactable_type');
            $table->string('reactable_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Only 'like' today. The column exists so adding a second
            // reaction later isn't a migration of live data.
            $table->string('type')->default('like');
            $table->timestamps();

            $table->unique(['reactable_type', 'reactable_id', 'user_id']);
            $table->index(['reactable_type', 'reactable_id']);
        });

        // The points ledger: append-only rows, never a mutable integer on
        // `users`. Same reasoning moxproxies-website uses for AI credits —
        // an auditable history beats a number you have to trust, and
        // "why am I level 3" is answerable by reading rows.
        Schema::create('point_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Signed: a correction or a moderation reversal is a new
            // negative row, never an edit or a delete.
            $table->integer('amount');
            // A key into config('gamification.points') — and the human
            // explanation, stored per row so retuning the config later
            // doesn't rewrite what already happened.
            $table->string('reason');
            // What caused it, when there is a specific thing: the template
            // that was used, the design that was liked.
            $table->string('source_type')->nullable();
            $table->string('source_id')->nullable();
            // Makes awarding exactly-once. Unliking and re-liking the same
            // template can't farm points, and a retried request can't
            // double-award. Nullable: some events (a manual grant) have no
            // natural key.
            $table->string('dedupe_key')->nullable()->unique();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });

        // Badges are their own entity, awardable two ways: a `rule` key
        // the system evaluates, or null for founder-granted ones like
        // "Pillar". Modelling both from the start rather than assuming
        // every badge is automatable.
        Schema::create('badges', function (Blueprint $table) {
            // A slug, not an int — badge ids appear in config, rules and
            // seed data, where 'first-template' beats 7.
            $table->string('id')->primary();
            $table->string('name');
            $table->string('description');
            // An emoji, so a badge needs no asset pipeline to exist.
            $table->string('icon')->default('🏅');
            // A BadgeRules key, or null for manual-grant-only.
            $table->string('rule')->nullable();
            $table->timestamps();
        });

        Schema::create('badge_user', function (Blueprint $table) {
            $table->id();
            $table->string('badge_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Null for a rule-based grant; the granting account for a
            // manual one, so a hand-awarded badge has an audit trail.
            $table->foreignId('awarded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign('badge_id')->references('id')->on('badges')->cascadeOnDelete();
            $table->unique(['badge_id', 'user_id']);
        });

        // The starting badge catalog, seeded here rather than in a seeder
        // so `php artisan migrate` stays the whole setup step. These are
        // reference rows the rules in App\Support\BadgeRules key off, not
        // sample data — a deployment without them has badges that can
        // never be awarded. `rule` null means manual-grant-only.
        DB::table('badges')->insert([
            ['id' => 'first-template', 'name' => 'Template Author', 'description' => 'Published a community template.', 'icon' => '🧩', 'rule' => 'first-template', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 'first-collection', 'name' => 'Curator', 'description' => 'Published a collection.', 'icon' => '📚', 'rule' => 'first-collection', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 'well-liked', 'name' => 'Well Liked', 'description' => 'Received 25 reactions across your work.', 'icon' => '⭐', 'rule' => 'well-liked', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 'level-three', 'name' => 'Regular', 'description' => 'Reached level 3.', 'icon' => '🎖️', 'rule' => 'level-three', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 'community-contributor', 'name' => 'Community Contributor', 'description' => 'Recognised for helping the community.', 'icon' => '🤝', 'rule' => null, 'created_at' => now(), 'updated_at' => now()],
            ['id' => 'pillar', 'name' => 'Pillar', 'description' => 'Awarded by the team for outstanding contribution.', 'icon' => '🏛️', 'rule' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);

        // "Featured" is a per-item flag its owner sets once their level
        // clears a threshold (config gamification.feature_min_level). A
        // timestamp rather than a boolean so the profile can order by when
        // something was featured.
        foreach (['card_designs', 'templates', 'collections'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->timestamp('featured_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (['card_designs', 'templates', 'collections'] as $table) {
            Schema::table($table, fn (Blueprint $blueprint) => $blueprint->dropColumn('featured_at'));
        }

        Schema::dropIfExists('badge_user');
        Schema::dropIfExists('badges');
        Schema::dropIfExists('point_events');
        Schema::dropIfExists('reactions');
    }
};
