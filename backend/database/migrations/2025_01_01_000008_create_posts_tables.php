<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Knowledge-base posts: the same owned-and-publishable shape as
        // designs, templates and collections (OwnedByUser + Publishable +
        // Reactable), so reactions, reports, visibility, moderation state
        // and featuring all apply with no new machinery.
        Schema::create('posts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            // The URL a post is shared by. Derived from the title but
            // stable afterwards: renaming a post mustn't break links
            // people have already posted elsewhere.
            $table->string('slug')->unique();
            // Markdown. Rendered to React elements client-side, never to
            // an HTML string — see apps/editor/src/markdown.tsx.
            $table->text('body');
            // Validated against a config shortlist, not a foreign key —
            // same free-text-with-a-shortlist call as report reasons.
            $table->string('category')->default('general');
            $table->json('tags');
            $table->string('visibility')->default('private');
            $table->string('moderation_state')->default('ok');
            $table->timestamp('featured_at')->nullable();
            $table->timestamps();

            $table->index(['visibility', 'moderation_state']);
            $table->index('category');
        });

        // Edit history. docs/PRODUCT_VISION.md calls this out specifically:
        // once content is public and community-authored, "what did this
        // look like before it was edited" is a moderation question, and
        // you can't answer it retroactively. A row is written *before*
        // each change, so it holds the superseded version.
        Schema::create('post_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('post_id')->constrained('posts')->cascadeOnDelete();
            // Who made the edit this revision was superseded by — normally
            // the author, but a moderator edit later would differ.
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title');
            $table->text('body');
            $table->timestamps();

            $table->index(['post_id', 'created_at']);
        });

        // Polymorphic like reactions and reports: comments start on posts
        // and can attach to a design or a template later without a second
        // table.
        Schema::create('comments', function (Blueprint $table) {
            $table->id();
            $table->string('commentable_type');
            $table->string('commentable_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('body');
            $table->string('moderation_state')->default('ok');
            $table->timestamps();

            $table->index(['commentable_type', 'commentable_id']);
        });

        // The badge App\Support\BadgeRules' 'first-post' rule grants. A
        // rule without its catalog row silently awards nothing, so the two
        // ship together — same reasoning as the initial catalog in the
        // gamification migration.
        DB::table('badges')->insert([
            'id' => 'first-post',
            'name' => 'Knowledge Contributor',
            'description' => 'Published a guide for the community.',
            'icon' => '📖',
            'rule' => 'first-post',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('badges')->where('id', 'first-post')->delete();
        Schema::dropIfExists('comments');
        Schema::dropIfExists('post_revisions');
        Schema::dropIfExists('posts');
    }
};
